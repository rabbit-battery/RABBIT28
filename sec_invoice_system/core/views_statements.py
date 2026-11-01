import io
import logging
from datetime import date
from decimal import Decimal

from django.conf import settings
from django.shortcuts import render, redirect, get_object_or_404
from django.contrib.auth.decorators import login_required
from django.contrib import messages
from django.db import transaction
from django.db.models import Sum
from django.http import HttpResponse
from django.utils import timezone

from .models import Contract, Task, Statement, StatementLine
from .forms import (
    GenerateStatementForm, StatementNotesForm, POForm, DeleteStatementForm
)
from .utils import (
    log_audit, create_statement_event, sanitize_excel_value,
    verify_event_chain, build_statement_pdf_html, vat_rate_factor
)
from .arabic_amount import amount_to_arabic
from .decorators import role_required

logger = logging.getLogger(__name__)

MONTH_NAMES = {
    1: 'يناير', 2: 'فبراير', 3: 'مارس', 4: 'أبريل', 5: 'مايو', 6: 'يونيو',
    7: 'يوليو', 8: 'أغسطس', 9: 'سبتمبر', 10: 'أكتوبر', 11: 'نوفمبر', 12: 'ديسمبر',
}


@login_required
def statement_list(request):
    statements = Statement.objects.select_related('contract', 'created_by').all()
    return render(request, 'core/statements.html', {'statements': statements})


@login_required
@role_required('accountant', 'contract_manager')
def statement_generate(request):
    if request.method != 'POST':
        today = timezone.localdate()
        form = GenerateStatementForm(initial={'year': today.year, 'month': today.month})
        return render(request, 'core/statement_generate.html', {'form': form})

    form = GenerateStatementForm(request.POST)
    if not form.is_valid():
        return render(request, 'core/statement_generate.html', {'form': form})

    contract = form.cleaned_data['contract']
    year = form.cleaned_data['year']
    month = form.cleaned_data['month']

    if Statement.objects.filter(contract=contract, year=year, month=month).exists():
        messages.error(request, 'يوجد مستخلص نشط لهذا الشهر')
        return redirect('statement_generate')

    tasks = Task.objects.filter(
        contract=contract,
        task_date__year=year,
        task_date__month=month,
        is_locked=False,
    )
    if not tasks.exists():
        messages.error(request, 'لا توجد مهام لهذا الشهر')
        return redirect('statement_generate')

    # رقم الإصدار: كل المستخلصات السابقة (بما فيها المحذوفة) لنفس الشهر
    revision = Statement.all_objects.filter(
        contract=contract, year=year, month=month
    ).count() + 1
    stmt_number = Statement.generate_number(contract, year, month, revision)

    grouped = list(
        tasks.values(
            'price_item__code',
            'price_item__description',
            'price_item__unit',
            'unit_price_snapshot',
        ).annotate(
            total_qty=Sum('quantity'),
            total_cost=Sum('total_cost'),
        ).order_by('price_item__code')
    )

    with transaction.atomic():
        stmt = Statement.objects.create(
            statement_number=stmt_number,
            contract=contract,
            year=year,
            month=month,
            revision=revision,
            created_by=request.user,
            status='draft',
        )

        subtotal = Decimal('0')
        lines = []
        for g in grouped:
            line_total = Decimal(g['total_cost']).quantize(Decimal('0.01'))
            lines.append(StatementLine(
                statement=stmt,
                item_code=g['price_item__code'],
                item_description=g['price_item__description'],
                unit=g['price_item__unit'],
                unit_price=g['unit_price_snapshot'],
                total_quantity=g['total_qty'],
                line_total=line_total,
            ))
            subtotal += line_total
        StatementLine.objects.bulk_create(lines)

        vat = (subtotal * vat_rate_factor()).quantize(Decimal('0.01'))
        total = subtotal + vat

        stmt.subtotal = subtotal
        stmt.vat_amount = vat
        stmt.total_with_vat = total
        stmt.total_in_words = amount_to_arabic(total)
        stmt.save()

        # قفل المهام التي دخلت المستخلص
        tasks.update(is_locked=True)

        create_statement_event(stmt, 'created', request.user,
                               f'إنشاء مستخلص {stmt_number}')

    messages.success(request, f'تم إنشاء المستخلص {stmt_number}')
    return redirect('statement_detail', pk=stmt.pk)


def _statement_detail_context(stmt, extra=None):
    context = {
        'statement': stmt,
        'lines': list(stmt.lines.all()),
        'events': list(stmt.events.all()),
        'chain_valid': verify_event_chain(stmt),
    }
    if extra:
        context.update(extra)
    return context


@login_required
def statement_detail(request, pk):
    stmt = get_object_or_404(Statement.all_objects, pk=pk)
    return render(request, 'core/statement_detail.html', _statement_detail_context(stmt))


@login_required
@role_required('branch_manager')
def statement_review(request, pk):
    stmt = get_object_or_404(Statement, pk=pk, status='draft')

    if request.method != 'POST':
        return redirect('statement_detail', pk=pk)

    if stmt.created_by == request.user:
        messages.error(request, 'لا يمكن مراجعة مستخلص أنشأته بنفسك')
        return redirect('statement_detail', pk=pk)

    stmt.status = 'reviewed'
    stmt.reviewed_by = request.user
    stmt.reviewed_at = timezone.now()
    stmt.save()

    create_statement_event(stmt, 'reviewed', request.user, 'تمت المراجعة')
    messages.success(request, 'تمت مراجعة المستخلص')
    return redirect('statement_detail', pk=pk)


@login_required
@role_required('approver')
def statement_approve(request, pk):
    stmt = get_object_or_404(Statement, pk=pk, status='reviewed')

    if request.method != 'POST':
        return redirect('statement_detail', pk=pk)

    if request.user in (stmt.created_by, stmt.reviewed_by):
        messages.error(request, 'لا يمكن اعتماد مستخلص شاركت في إنشائه أو مراجعته')
        return redirect('statement_detail', pk=pk)

    stmt.status = 'approved'
    stmt.approved_by = request.user
    stmt.approved_at = timezone.now()
    stmt.save()

    create_statement_event(stmt, 'approved', request.user, 'تم الاعتماد')
    messages.success(request, 'تم اعتماد المستخلص')
    return redirect('statement_detail', pk=pk)


@login_required
@role_required('accountant')
def statement_pay(request, pk):
    stmt = get_object_or_404(Statement, pk=pk, status='approved')

    if request.method == 'POST':
        form = POForm(request.POST)
        if form.is_valid():
            po = form.cleaned_data['po_number'].upper()
            stmt.po_number = po
            stmt.status = 'paid'
            stmt.paid_by = request.user
            stmt.paid_at = timezone.now()
            stmt.save()

            create_statement_event(stmt, 'paid', request.user, f'تم الصرف - رقم PO: {po}')
            messages.success(request, 'تم تسجيل الصرف وإقفال المستخلص')
            return redirect('statement_detail', pk=pk)
    else:
        form = POForm()

    return render(request, 'core/statement_detail.html',
                  _statement_detail_context(stmt, {'po_form': form, 'paying': True}))


@login_required
def statement_notes(request, pk):
    """عرض نموذج الملاحظات (GET) وحفظها (POST) - المسودات فقط"""
    stmt = get_object_or_404(Statement, pk=pk, status='draft')

    if request.method == 'POST':
        form = StatementNotesForm(request.POST)
        if form.is_valid():
            stmt.notes = form.cleaned_data['notes']
            stmt.save()
            create_statement_event(stmt, 'edited', request.user, 'تعديل الملاحظات')
            messages.success(request, 'تم حفظ الملاحظات')
            return redirect('statement_detail', pk=pk)
    else:
        form = StatementNotesForm(initial={'notes': stmt.notes})

    return render(request, 'core/statement_detail.html',
                  _statement_detail_context(stmt, {'notes_form': form, 'editing_notes': True}))


@login_required
@role_required('branch_manager', 'accountant')
def statement_delete(request, pk):
    stmt = get_object_or_404(Statement.all_objects, pk=pk)

    if stmt.is_deleted:
        messages.error(request, 'المستخلص محذوف مسبقاً')
        return redirect('statements')

    if stmt.status == 'paid':
        messages.error(request, 'لا يمكن حذف مستخلص تم صرفه')
        return redirect('statement_detail', pk=pk)

    # المحاسب يحذف المسودات فقط
    try:
        if request.user.profile.specialty == 'accountant' and stmt.status != 'draft':
            messages.error(request, 'يمكنك حذف المسودات فقط')
            return redirect('statement_detail', pk=pk)
    except Exception:  # noqa: BLE001
        pass

    if request.method == 'POST':
        form = DeleteStatementForm(request.POST)
        if form.is_valid():
            reason = form.cleaned_data['reason']

            with transaction.atomic():
                # تحرير المهام
                Task.objects.filter(
                    contract=stmt.contract,
                    task_date__year=stmt.year,
                    task_date__month=stmt.month,
                    is_locked=True,
                ).update(is_locked=False)

                # الحذف المنطقي
                stmt.is_deleted = True
                stmt.deleted_by = request.user
                stmt.deleted_at = timezone.now()
                stmt.delete_reason = reason
                stmt.save()

                create_statement_event(stmt, 'deleted', request.user, f'حذف: {reason}')

            messages.success(request, 'تم حذف المستخلص')
            return redirect('statements')
    else:
        form = DeleteStatementForm()

    return render(request, 'core/statement_detail.html',
                  _statement_detail_context(stmt, {'delete_form': form, 'deleting': True}))


@login_required
def statement_pdf(request, pk):
    """تصدير المستخلص كـ PDF"""
    stmt = get_object_or_404(Statement.all_objects, pk=pk)
    html = build_statement_pdf_html(stmt)

    try:
        from weasyprint import HTML
    except Exception as exc:  # noqa: BLE001 - مكتبات النظام (pango) غير متوفرة
        logger.critical('WeasyPrint غير متاح، تعذّر توليد PDF: %s', exc)
        messages.error(request, 'خدمة توليد PDF غير متوفرة على هذا الخادم (مكتبات WeasyPrint ناقصة)')
        return redirect('statement_detail', pk=pk)

    pdf_bytes = HTML(string=html, base_url=str(settings.STATIC_ROOT)).write_pdf()
    log_audit(request, 'export_pdf', f'تصدير PDF: {stmt.statement_number}')

    response = HttpResponse(pdf_bytes, content_type='application/pdf')
    response['Content-Disposition'] = f'attachment; filename="{stmt.statement_number}.pdf"'
    return response


@login_required
def statement_xlsx(request, pk):
    """تصدير المستخلص كـ Excel"""
    import openpyxl
    from openpyxl.styles import Font, Alignment

    stmt = get_object_or_404(Statement.all_objects, pk=pk)
    lines = list(stmt.lines.all())

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = 'المستخلص'
    ws.sheet_view.rightToLeft = True

    ws.merge_cells('A1:F1')
    ws['A1'] = sanitize_excel_value(f'مستخلص رقم {stmt.statement_number}')
    ws['A1'].font = Font(size=16, bold=True)
    ws['A1'].alignment = Alignment(horizontal='center')

    ws['A3'] = 'العقد:'
    ws['B3'] = sanitize_excel_value(str(stmt.contract))
    ws['A4'] = 'الفترة:'
    ws['B4'] = f'{stmt.month}/{stmt.year}'
    ws['A5'] = 'الحالة:'
    ws['B5'] = stmt.get_status_display()

    headers = ['كود البند', 'الوصف', 'الوحدة', 'سعر الوحدة', 'الكمية', 'الإجمالي']
    for col, header in enumerate(headers, 1):
        ws.cell(row=7, column=col, value=header).font = Font(bold=True)

    for row_idx, line in enumerate(lines, 8):
        ws.cell(row=row_idx, column=1, value=sanitize_excel_value(line.item_code))
        ws.cell(row=row_idx, column=2, value=sanitize_excel_value(line.item_description))
        ws.cell(row=row_idx, column=3, value=sanitize_excel_value(line.unit))
        ws.cell(row=row_idx, column=4, value=float(line.unit_price))
        ws.cell(row=row_idx, column=5, value=float(line.total_quantity))
        ws.cell(row=row_idx, column=6, value=float(line.line_total))

    last_row = 8 + len(lines)
    ws.cell(row=last_row, column=5, value='الإجمالي قبل الضريبة:').font = Font(bold=True)
    ws.cell(row=last_row, column=6, value=float(stmt.subtotal))
    ws.cell(row=last_row + 1, column=5,
            value=f'ضريبة القيمة المضافة {settings.VAT_RATE}%:').font = Font(bold=True)
    ws.cell(row=last_row + 1, column=6, value=float(stmt.vat_amount))
    ws.cell(row=last_row + 2, column=5, value='الإجمالي شامل الضريبة:').font = Font(bold=True)
    ws.cell(row=last_row + 2, column=6, value=float(stmt.total_with_vat))

    ws.cell(row=last_row + 4, column=1, value='المبلغ بالحروف:').font = Font(bold=True)
    ws.cell(row=last_row + 4, column=2, value=sanitize_excel_value(stmt.total_in_words))

    log_audit(request, 'export_excel', f'تصدير Excel: {stmt.statement_number}')

    buffer = io.BytesIO()
    wb.save(buffer)
    buffer.seek(0)

    response = HttpResponse(
        buffer.getvalue(),
        content_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    )
    response['Content-Disposition'] = f'attachment; filename="{stmt.statement_number}.xlsx"'
    return response


@login_required
def statement_compare(request):
    """مقارنة شهرية لسنة كاملة"""
    try:
        year = int(request.GET.get('year', timezone.localdate().year))
    except (TypeError, ValueError):
        year = timezone.localdate().year
    contract_id = request.GET.get('contract')

    contracts = Contract.objects.filter(is_active=True)

    months_data = []
    for m in range(1, 13):
        stmt = Statement.objects.filter(year=year, month=m)
        if contract_id:
            stmt = stmt.filter(contract_id=contract_id)

        total = stmt.aggregate(total=Sum('subtotal'))['total'] or Decimal('0')
        months_data.append({
            'month': m,
            'month_name': MONTH_NAMES[m],
            'total': total,
            'change': None,
        })

    for i in range(1, len(months_data)):
        prev = months_data[i - 1]['total']
        curr = months_data[i]['total']
        if prev > 0:
            months_data[i]['change'] = round(float((curr - prev) / prev) * 100, 1)

    years = sorted({date.today().year - 1, date.today().year, date.today().year + 1})

    return render(request, 'core/statement_compare.html', {
        'months_data': months_data,
        'year': year,
        'years': years,
        'contracts': contracts,
        'selected_contract': contract_id,
    })
