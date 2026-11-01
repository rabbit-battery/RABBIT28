"""اختبارات التصدير (Excel) وتوليد HTML الخاص بـ PDF"""

import io
from datetime import date

import openpyxl
from django.test import TestCase
from django.urls import reverse

from core.models import Statement, StatementEvent
from core.utils import build_statement_pdf_html
from .factories import (
    make_user, make_contract, make_price_item, make_technician, make_task,
    mark_otp_verified
)


class ExportBase(TestCase):

    def setUp(self):
        self.accountant = make_user('accountant')
        self.manager = make_user('branch_manager')
        self.entry = make_user('data_entry')

        self.contract = make_contract(self.accountant, contract_number='505')
        self.item = make_price_item(self.contract, code='IT-200', unit_price='100.00')
        self.tech = make_technician()
        make_task(self.contract, self.tech, self.item, date(2025, 6, 2), 10, self.entry)
        make_task(self.contract, self.tech, self.item, date(2025, 6, 3), 5, self.entry)

        self.client.force_login(self.accountant)
        mark_otp_verified(self.client, self.accountant)
        self.client.post(reverse('statement_generate'), {
            'contract': self.contract.pk, 'year': 2025, 'month': 6,
        })
        self.stmt = Statement.objects.get()


class ExcelExportTests(ExportBase):

    def load_workbook(self):
        response = self.client.get(reverse('statement_xlsx', args=[self.stmt.pk]))
        self.assertEqual(response.status_code, 200)
        self.assertIn('spreadsheetml', response['Content-Type'])
        return openpyxl.load_workbook(io.BytesIO(response.content))

    def test_export_returns_a_readable_workbook(self):
        wb = self.load_workbook()
        ws = wb.active
        self.assertEqual(ws.title, 'المستخلص')
        self.assertTrue(ws.sheet_view.rightToLeft)

    def test_header_and_metadata(self):
        ws = self.load_workbook().active
        self.assertIn('ST-202506-505', ws['A1'].value)
        self.assertEqual(ws['B4'].value, '6/2025')

    def test_line_values_and_totals(self):
        ws = self.load_workbook().active
        # بند واحد يبدأ من الصف 8، والإجماليات تليه
        self.assertEqual(ws.cell(row=8, column=1).value, 'IT-200')
        self.assertEqual(ws.cell(row=8, column=4).value, 100.00)
        self.assertEqual(ws.cell(row=8, column=5).value, 15.0)
        self.assertEqual(ws.cell(row=8, column=6).value, 1500.00)

        self.assertEqual(ws.cell(row=9, column=6).value, 1500.00)    # قبل الضريبة
        self.assertEqual(ws.cell(row=10, column=6).value, 225.00)    # الضريبة
        self.assertEqual(ws.cell(row=11, column=6).value, 1725.00)   # الإجمالي

    def test_amount_in_words_is_written(self):
        ws = self.load_workbook().active
        self.assertEqual(ws.cell(row=13, column=2).value,
                         'ألف وسبعمائة وخمسة وعشرون ريال سعودي')

    def test_formula_injection_is_neutralized(self):
        # بند يبدأ بـ = يجب أن يُصدَّر بقيمة معطّلة لا بصيغة حيّة
        from core.models import StatementLine
        StatementLine.objects.filter(statement=self.stmt).update(item_code='=1+1')

        ws = self.load_workbook().active
        self.assertEqual(ws.cell(row=8, column=1).value, "'=1+1")

    def test_export_is_audited(self):
        from core.models import AuditLog
        self.client.get(reverse('statement_xlsx', args=[self.stmt.pk]))
        self.assertTrue(AuditLog.objects.filter(action='export_excel').exists())


class PdfHtmlTests(ExportBase):
    """
    WeasyPrint يحتاج مكتبات نظام (pango) غير متوفرة في بيئة الاختبار،
    لذا نختبر مسار توليد HTML الذي يستخدمه العرض فعلياً عبر build_statement_pdf_html.
    """

    def html(self):
        return build_statement_pdf_html(self.stmt)

    def test_contains_statement_number_and_totals(self):
        html = self.html()
        self.assertIn('ST-202506-505', html)
        self.assertIn('ألف وسبعمائة وخمسة وعشرون ريال سعودي', html)
        self.assertIn('IT-200', html)

    def test_draft_watermark_present_on_draft(self):
        self.assertIn('مسودة — غير معتمد', self.html())

    def test_draft_watermark_absent_after_approval(self):
        self.stmt.status = 'approved'
        self.stmt.save()
        self.assertNotIn('مسودة — غير معتمد', self.html())

    def test_chain_status_is_reported(self):
        self.assertIn('سلسلة البصمات الرقمية سليمة', self.html())

        StatementEvent.objects.filter(statement=self.stmt).update(details='عبث')
        self.assertIn('سلسلة البصمات الرقمية غير سليمة', self.html())

    def test_vat_rate_comes_from_settings(self):
        self.assertIn('ضريبة القيمة المضافة (15%)', self.html())

    def test_html_escapes_user_content(self):
        self.stmt.notes = '<script>alert(1)</script>'
        self.stmt.save()
        html = self.html()
        self.assertNotIn('<script>alert(1)</script>', html)
        self.assertIn('&lt;script&gt;', html)

    def test_pdf_view_reports_missing_engine_instead_of_crashing(self):
        import builtins

        real_import = builtins.__import__

        def blocked_import(name, *args, **kwargs):
            if name == 'weasyprint':
                raise ImportError('libpango missing (محاكاة بيئة بلا pango)')
            return real_import(name, *args, **kwargs)

        builtins.__import__ = blocked_import
        try:
            response = self.client.get(reverse('statement_pdf', args=[self.stmt.pk]))
        finally:
            builtins.__import__ = real_import

        self.assertEqual(response.status_code, 302)
        self.assertEqual(response['Location'],
                         reverse('statement_detail', args=[self.stmt.pk]))

    def test_signature_is_embedded_as_data_uri(self):
        # التوقيع مخزّن في قاعدة البيانات (لا على القرص) لأن النشر serverless
        self.accountant.profile.signature_data = (
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg=='
        )
        self.accountant.profile.save()

        from core.utils import create_statement_event
        create_statement_event(self.stmt, 'edited', self.accountant, 'اختبار التوقيع')

        event = self.stmt.events.filter(event_type='edited').first()
        self.assertTrue(event.signature_snapshot.startswith('iVBORw0KGgo'))
        self.assertIn('data:image/png;base64,iVBORw0KGgo', build_statement_pdf_html(self.stmt))
