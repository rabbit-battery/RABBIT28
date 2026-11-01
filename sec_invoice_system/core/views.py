import base64
import io
import logging
import secrets
from datetime import date, datetime, timedelta
from decimal import Decimal, InvalidOperation

from django.shortcuts import render, redirect, get_object_or_404
from django.contrib.auth.decorators import login_required
from django.contrib import messages
from django.core.exceptions import ValidationError
from django.http import JsonResponse
from django.db.models import Sum
from django.utils import timezone

import openpyxl
import qrcode
from django.conf import settings
from django_otp import login as otp_login
from django_otp.plugins.otp_totp.models import TOTPDevice
from django_otp.plugins.otp_static.models import StaticDevice, StaticToken

from .models import (
    Contract, PriceItem, Technician, Holiday, Task, Statement
)
from .forms import (
    ContractForm, PriceItemForm, TechnicianForm, HolidayForm,
    TaskForm, TaskImportForm, PasswordChangeForm
)
from .utils import (
    get_working_days, get_remaining_working_days, forecast_monthly,
    log_audit
)
from .decorators import role_required

logger = logging.getLogger(__name__)


# ═══════════════════════════════════════════
#  لوحة المتابعة
# ═══════════════════════════════════════════
@login_required
def dashboard(request):
    today = timezone.localdate()
    first_of_month = date(today.year, today.month, 1)
    first_of_year = date(today.year, 1, 1)

    contract_id = request.GET.get('contract')
    contracts = Contract.objects.filter(is_active=True)

    task_qs = Task.objects.all()
    if contract_id:
        task_qs = task_qs.filter(contract_id=contract_id)

    # تكلفة اليوم
    daily_cost = task_qs.filter(task_date=today).aggregate(
        total=Sum('total_cost'))['total'] or Decimal('0')

    # المتراكم الشهري
    monthly_acc = task_qs.filter(
        task_date__gte=first_of_month, task_date__lte=today
    ).aggregate(total=Sum('total_cost'))['total'] or Decimal('0')

    # المتراكم السنوي
    yearly_acc = task_qs.filter(
        task_date__gte=first_of_year, task_date__lte=today
    ).aggregate(total=Sum('total_cost'))['total'] or Decimal('0')

    # التنبؤ الشهري
    elapsed_days = get_working_days(first_of_month, today)
    remaining_days = get_remaining_working_days(today)
    monthly_forecast = forecast_monthly(monthly_acc, elapsed_days, remaining_days)

    # التنبؤ السنوي
    elapsed_year_days = get_working_days(first_of_year, today)
    last_of_year = date(today.year, 12, 31)
    remaining_year_days = get_working_days(today + timedelta(days=1), last_of_year)
    yearly_forecast = forecast_monthly(yearly_acc, elapsed_year_days, remaining_year_days)

    context = {
        'contracts': contracts,
        'selected_contract': contract_id,
        'daily_cost': daily_cost,
        'monthly_accumulated': monthly_acc,
        'monthly_forecast': monthly_forecast,
        'yearly_accumulated': yearly_acc,
        'yearly_forecast': yearly_forecast,
        'today': today,
    }
    return render(request, 'core/dashboard.html', context)


@login_required
def api_daily_costs(request):
    """API لبيانات الرسم البياني اليومي"""
    today = timezone.localdate()
    first_of_month = date(today.year, today.month, 1)

    contract_id = request.GET.get('contract')
    task_qs = Task.objects.filter(task_date__gte=first_of_month, task_date__lte=today)
    if contract_id:
        task_qs = task_qs.filter(contract_id=contract_id)

    daily_data = task_qs.values('task_date').annotate(
        total=Sum('total_cost')
    ).order_by('task_date')

    labels = []
    costs = []
    accumulated = []
    running_total = Decimal('0')

    daily_map = {d['task_date']: d['total'] for d in daily_data}

    current = first_of_month
    while current <= today:
        labels.append(current.strftime('%d/%m'))
        day_cost = daily_map.get(current, Decimal('0'))
        costs.append(float(day_cost))
        running_total += day_cost
        accumulated.append(float(running_total))
        current += timedelta(days=1)

    return JsonResponse({
        'labels': labels,
        'costs': costs,
        'accumulated': accumulated,
    })


# ═══════════════════════════════════════════
#  العقود
# ═══════════════════════════════════════════
@login_required
@role_required('contract_manager')
def contract_list(request):
    contracts = Contract.objects.all()
    return render(request, 'core/contracts.html', {'contracts': contracts})


@login_required
@role_required('contract_manager')
def contract_form(request, pk=None):
    instance = get_object_or_404(Contract, pk=pk) if pk else None

    if request.method == 'POST':
        form = ContractForm(request.POST, request.FILES, instance=instance)
        if form.is_valid():
            contract = form.save(commit=False)
            if not pk:
                contract.created_by = request.user
            try:
                contract.full_clean(exclude=['pdf_file'] if not contract.pdf_file else None)
            except ValidationError as exc:
                for field, errs in exc.message_dict.items():
                    for err in errs:
                        form.add_error(field if field != '__all__' else None, err)
                return render(request, 'core/contract_form.html',
                              {'form': form, 'editing': pk is not None})
            contract.save()
            if request.FILES.get('pdf_file'):
                log_audit(request, 'upload', f'رفع ملف عقد: {contract.contract_number}')
            messages.success(request, 'تم حفظ العقد بنجاح')
            return redirect('contracts')
    else:
        form = ContractForm(instance=instance)

    return render(request, 'core/contract_form.html', {'form': form, 'editing': pk is not None})


# ═══════════════════════════════════════════
#  بنود الأسعار
# ═══════════════════════════════════════════
@login_required
@role_required('contract_manager')
def price_items(request, contract_id):
    contract = get_object_or_404(Contract, pk=contract_id)
    items = contract.price_items.all()
    return render(request, 'core/contracts.html', {
        'contract': contract, 'items': items, 'show_items': True
    })


@login_required
@role_required('contract_manager')
def price_item_form(request, contract_id):
    contract = get_object_or_404(Contract, pk=contract_id)

    if request.method == 'POST':
        form = PriceItemForm(request.POST)
        if form.is_valid():
            item = form.save(commit=False)
            item.contract = contract
            item.save()
            messages.success(request, 'تم إضافة البند')
            return redirect('price_items', contract_id=contract.pk)
    else:
        form = PriceItemForm()

    return render(request, 'core/contract_form.html', {
        'form': form, 'contract': contract, 'is_item': True
    })


# ═══════════════════════════════════════════
#  الفنيون
# ═══════════════════════════════════════════
@login_required
@role_required('contract_manager', 'data_entry')
def technician_list(request):
    technicians = Technician.objects.all()
    return render(request, 'core/contracts.html', {
        'technicians': technicians, 'show_technicians': True
    })


@login_required
@role_required('contract_manager')
def technician_form(request):
    if request.method == 'POST':
        form = TechnicianForm(request.POST)
        if form.is_valid():
            form.save()
            messages.success(request, 'تم إضافة الفني')
            return redirect('technicians')
    else:
        form = TechnicianForm()
    return render(request, 'core/contract_form.html', {'form': form, 'is_technician': True})


# ═══════════════════════════════════════════
#  العطل
# ═══════════════════════════════════════════
@login_required
@role_required('contract_manager')
def holiday_list(request):
    holidays = Holiday.objects.all()
    return render(request, 'core/contracts.html', {'holidays': holidays, 'show_holidays': True})


@login_required
@role_required('contract_manager')
def holiday_form(request):
    if request.method == 'POST':
        form = HolidayForm(request.POST)
        if form.is_valid():
            form.save()
            messages.success(request, 'تم إضافة العطلة')
            return redirect('holidays')
    else:
        form = HolidayForm()
    return render(request, 'core/contract_form.html', {'form': form, 'is_holiday': True})


# ═══════════════════════════════════════════
#  المهام
# ═══════════════════════════════════════════
@login_required
@role_required('data_entry', 'contract_manager')
def task_list(request):
    tasks = Task.objects.select_related('contract', 'technician', 'price_item')

    contract_id = request.GET.get('contract')
    date_from = request.GET.get('date_from')
    date_to = request.GET.get('date_to')

    if contract_id:
        tasks = tasks.filter(contract_id=contract_id)
    if date_from:
        tasks = tasks.filter(task_date__gte=date_from)
    if date_to:
        tasks = tasks.filter(task_date__lte=date_to)

    contracts = Contract.objects.filter(is_active=True)
    return render(request, 'core/tasks.html', {
        'tasks': tasks[:500],
        'contracts': contracts,
    })


@login_required
@role_required('data_entry', 'contract_manager')
def task_form(request, pk=None):
    instance = get_object_or_404(Task, pk=pk) if pk else None

    if instance and instance.is_locked:
        messages.error(request, 'هذه المهمة مقفلة في مستخلص')
        return redirect('tasks')

    if request.method == 'POST':
        form = TaskForm(request.POST, instance=instance)
        if form.is_valid():
            task = form.save(commit=False)

            month_locked = Statement.objects.filter(
                contract=task.contract,
                year=task.task_date.year,
                month=task.task_date.month,
            ).exists()

            if month_locked:
                messages.error(request, 'الشهر مقفل بمستخلص نشط')
                return redirect('tasks')

            if task.price_item.contract_id != task.contract_id:
                messages.error(request, 'البند المختار لا يتبع العقد المحدد')
                return redirect('tasks')

            if not pk:
                task.created_by = request.user
                task.unit_price_snapshot = task.price_item.unit_price
            task.save()
            messages.success(request, 'تم حفظ المهمة')
            return redirect('tasks')
    else:
        form = TaskForm(instance=instance)

    return render(request, 'core/task_form.html', {'form': form, 'editing': pk is not None})


@login_required
@role_required('data_entry', 'contract_manager')
def task_delete(request, pk):
    task = get_object_or_404(Task, pk=pk)

    if task.is_locked:
        messages.error(request, 'لا يمكن حذف مهمة مقفلة')
        return redirect('tasks')

    if request.method == 'POST':
        task.delete()
        messages.success(request, 'تم حذف المهمة')
    return redirect('tasks')


def _coerce_task_date(raw):
    """تحويل خلية التاريخ في Excel إلى date أو إرجاع None"""
    if isinstance(raw, datetime):
        return raw.date()
    if isinstance(raw, date):
        return raw
    if isinstance(raw, str):
        for fmt in ('%Y-%m-%d', '%d/%m/%Y', '%Y/%m/%d'):
            try:
                return datetime.strptime(raw.strip(), fmt).date()
            except ValueError:
                continue
    return None


@login_required
@role_required('data_entry', 'contract_manager')
def task_import(request):
    if request.method != 'POST':
        return render(request, 'core/task_import.html', {'form': TaskImportForm()})

    form = TaskImportForm(request.POST, request.FILES)
    if not form.is_valid():
        return render(request, 'core/task_import.html', {'form': form})

    contract = form.cleaned_data['contract']
    excel_file = form.cleaned_data['excel_file']

    if excel_file.size > settings.MAX_EXCEL_SIZE_MB * 1024 * 1024:
        messages.error(request, f'حجم الملف يتجاوز {settings.MAX_EXCEL_SIZE_MB} ميغابايت')
        return redirect('task_import')

    try:
        wb = openpyxl.load_workbook(excel_file, read_only=True, data_only=True)
        ws = wb.active
        rows = list(ws.iter_rows(min_row=2, values_only=True))
    except Exception as exc:  # noqa: BLE001 - ملف تالف أو غير xlsx
        logger.warning('فشل قراءة ملف استيراد المهام: %s', exc)
        messages.error(request, 'تعذّر قراءة الملف. تأكد أنه بصيغة xlsx سليمة')
        return redirect('task_import')

    if len(rows) > settings.MAX_EXCEL_ROWS:
        messages.error(request, f'عدد الأسطر يتجاوز {settings.MAX_EXCEL_ROWS}')
        return redirect('task_import')

    # الأشهر المقفلة لهذا العقد (تُجلب مرة واحدة بدل استعلام لكل سطر)
    locked_months = set(
        Statement.objects.filter(contract=contract).values_list('year', 'month')
    )

    errors = []
    tasks_to_create = []

    for i, row in enumerate(rows, start=2):
        if row is None or all(cell is None or cell == '' for cell in row):
            continue  # تجاهل الأسطر الفارغة

        if len(row) < 4:
            errors.append(f'السطر {i}: أعمدة ناقصة')
            continue

        tech_num, item_code, raw_date, qty = row[0], row[1], row[2], row[3]
        location = row[4] if len(row) > 4 else ''

        tech = Technician.objects.filter(
            employee_number=str(tech_num).strip(), is_active=True
        ).first()
        if tech is None:
            errors.append(f'السطر {i}: فني غير موجود: {tech_num}')
            continue

        item = PriceItem.objects.filter(
            contract=contract, code=str(item_code).strip(), is_active=True
        ).first()
        if item is None:
            errors.append(f'السطر {i}: بند غير موجود: {item_code}')
            continue

        task_date = _coerce_task_date(raw_date)
        if task_date is None:
            errors.append(f'السطر {i}: تاريخ غير صحيح: {raw_date}')
            continue

        if (task_date.year, task_date.month) in locked_months:
            errors.append(f'السطر {i}: الشهر {task_date.month}/{task_date.year} مقفل')
            continue

        try:
            qty = Decimal(str(qty).strip())
            if qty <= 0:
                raise InvalidOperation('الكمية يجب أن تكون أكبر من صفر')
        except (InvalidOperation, ValueError, TypeError, AttributeError):
            errors.append(f'السطر {i}: كمية غير صحيحة: {qty}')
            continue

        tasks_to_create.append(Task(
            contract=contract,
            technician=tech,
            price_item=item,
            task_date=task_date,
            quantity=qty,
            unit_price_snapshot=item.unit_price,
            total_cost=(qty * item.unit_price).quantize(Decimal('0.01')),
            location=str(location or '').strip(),
            created_by=request.user,
        ))

        if len(errors) >= 20:
            errors.append('... تم إيقاف الفحص بعد 20 خطأ')
            break

    if errors:
        for err in errors:
            messages.error(request, err)
        return redirect('task_import')

    if not tasks_to_create:
        messages.warning(request, 'الملف لا يحتوي على أسطر صالحة')
        return redirect('task_import')

    # كل شيء أو لا شيء
    Task.objects.bulk_create(tasks_to_create)
    log_audit(request, 'import_tasks',
              f'استيراد {len(tasks_to_create)} مهمة للعقد {contract.contract_number}')
    messages.success(request, f'تم استيراد {len(tasks_to_create)} مهمة بنجاح')
    return redirect('tasks')


# ═══════════════════════════════════════════
#  كلمة المرور
# ═══════════════════════════════════════════
@login_required
def password_change_view(request):
    if request.method == 'POST':
        form = PasswordChangeForm(request.POST)
        if form.is_valid():
            if not request.user.check_password(form.cleaned_data['old_password']):
                messages.error(request, 'كلمة المرور الحالية غير صحيحة')
            else:
                request.user.set_password(form.cleaned_data['new_password'])
                request.user.save()
                try:
                    request.user.profile.must_change_password = False
                    request.user.profile.save()
                except Exception:  # noqa: BLE001
                    pass
                messages.success(request, 'تم تغيير كلمة المرور. سجّل دخولك مجدداً')
                return redirect('login')
    else:
        form = PasswordChangeForm()

    return render(request, 'core/password_change.html', {'form': form})


# ═══════════════════════════════════════════
#  المصادقة الثنائية (2FA)
# ═══════════════════════════════════════════
@login_required
def setup_2fa(request):
    """عرض رمز QR لتسجيل الجهاز، أو تحويل من لديه جهاز مؤكد إلى التحدي"""
    if TOTPDevice.objects.filter(user=request.user, confirmed=True).exists():
        # الجهاز مسجّل مسبقاً: المطلوب إدخال الرمز لا تسجيل جهاز جديد،
        # وإلا دخلنا في حلقة تحويل لا تنتهي.
        return redirect('verify_2fa')

    device, _created = TOTPDevice.objects.get_or_create(
        user=request.user, name='default', defaults={'confirmed': False}
    )

    qr = qrcode.make(device.config_url)
    buffer = io.BytesIO()
    qr.save(buffer, format='PNG')
    qr_b64 = base64.b64encode(buffer.getvalue()).decode()

    return render(request, 'core/setup_2fa.html', {
        'qr_code': qr_b64,
        'secret': device.key,
    })


@login_required
def verify_2fa(request):
    """
    تأكيد الجهاز الجديد (أول مرة) أو التحقق من رمز جهاز مؤكَّد (كل دخول).
    في الحالتين نستدعي django_otp.login حتى تُعتبر الجلسة موثّقة،
    وإلا أعادت Force2FAMiddleware توجيه المستخدم إلى هنا للأبد.
    """
    pending = TOTPDevice.objects.filter(user=request.user, confirmed=False).first()
    confirmed = TOTPDevice.objects.filter(user=request.user, confirmed=True).first()

    if request.method == 'POST':
        token = (request.POST.get('token') or '').strip()

        if pending and pending.verify_token(token):
            pending.confirmed = True
            pending.save()
            otp_login(request, pending)

            backup_codes = _issue_backup_codes(request.user)

            messages.success(request, 'تم تفعيل المصادقة الثنائية')
            return render(request, 'core/verify_2fa.html', {
                'backup_codes': backup_codes,
                'success': True,
            })

        if confirmed and confirmed.verify_token(token):
            otp_login(request, confirmed)
            messages.success(request, 'تم التحقق من هويتك')
            return redirect(request.GET.get('next') or 'dashboard')

        messages.error(request, 'الرمز غير صحيح')

    if pending is None and confirmed is None:
        return redirect('setup_2fa')

    return render(request, 'core/verify_2fa.html', {
        'registering': pending is not None,
    })


def health_check(request):
    """
    نقطة فحص صحي: تقوم بجولة فعلية على قاعدة البيانات.

    بلا مصادقة لأن مُنسّق الحاويات (Docker HEALTHCHECK / Kubernetes probes)
    يستدعيها قبل توفر أي جلسة. لا تكشف أي معلومة حساسة: حالة فقط.

    الفرق عن فحص صفحة الدخول: صفحة الدخول تُرسم دون لمس قاعدة البيانات،
    فنجاة التطبيق لا تعني اتصاله بها. هذه النقطة تنفّذ استعلاماً حقيقياً
    فتُظهر فشل الاتصال أو الترحيلات الناقصة بدل أن يمرّ الفحص كاذباً.
    """
    from django.db import connection

    payload = {'status': 'ok', 'database': 'ok'}
    status_code = 200
    try:
        with connection.cursor() as cursor:
            cursor.execute('SELECT 1')
            cursor.fetchone()
    except Exception:  # noqa: BLE001 - أي فشل اتصال يُبلَّغ كحالة لا كاستثناء
        logger.critical('فحص الصحة: تعذّر الاتصال بقاعدة البيانات', exc_info=True)
        payload = {'status': 'error', 'database': 'unavailable'}
        status_code = 503

    return JsonResponse(payload, status=status_code)


def _issue_backup_codes(user, count=8):
    """إنشاء رموز احتياطية تُستخدم مرة واحدة"""
    static_device, _ = StaticDevice.objects.get_or_create(user=user, name='backup')
    codes = []
    for _ in range(count):
        code = secrets.token_hex(4)
        StaticToken.objects.create(device=static_device, token=code)
        codes.append(code)
    return codes
