"""اختبارات استيراد المهام من Excel"""

import io
from datetime import date, datetime
from decimal import Decimal

import openpyxl
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from django.urls import reverse

from core.models import Task, Statement
from .factories import (
    make_user, make_contract, make_price_item, make_technician,
    mark_otp_verified
)

XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'


def build_workbook(rows, header=('رقم الفني', 'كود البند', 'التاريخ', 'الكمية', 'الموقع')):
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(list(header))
    for row in rows:
        ws.append(list(row))
    buffer = io.BytesIO()
    wb.save(buffer)
    return SimpleUploadedFile('tasks.xlsx', buffer.getvalue(), content_type=XLSX_MIME)


class TaskImportTests(TestCase):

    def setUp(self):
        self.entry = make_user('data_entry')
        self.contract = make_contract(make_user('contract_manager'), contract_number='303')
        self.item = make_price_item(self.contract, code='IT-100', unit_price='75.50')
        self.tech = make_technician(employee_number='T10001')

        self.client.force_login(self.entry)

    def post_import(self, uploaded):
        return self.client.post(reverse('task_import'), {
            'contract': self.contract.pk,
            'excel_file': uploaded,
        })

    def test_valid_file_creates_tasks_with_computed_totals(self):
        response = self.post_import(build_workbook([
            ('T10001', 'IT-100', date(2025, 6, 2), 4, 'الرياض'),
            ('T10001', 'IT-100', date(2025, 6, 3), '2.5', 'جدة'),
        ]))

        self.assertEqual(response.status_code, 302)
        self.assertEqual(response['Location'], reverse('tasks'))

        tasks = list(Task.objects.order_by('task_date'))
        self.assertEqual(len(tasks), 2)
        self.assertEqual(tasks[0].total_cost, Decimal('302.00'))   # 4 × 75.50
        self.assertEqual(tasks[1].total_cost, Decimal('188.75'))   # 2.5 × 75.50
        self.assertEqual(tasks[0].location, 'الرياض')
        self.assertEqual(tasks[0].unit_price_snapshot, Decimal('75.50'))
        self.assertEqual(tasks[0].created_by, self.entry)

    def test_string_dates_are_parsed(self):
        self.post_import(build_workbook([
            ('T10001', 'IT-100', '2025-06-02', 1, ''),
            ('T10001', 'IT-100', '03/06/2025', 1, ''),
        ]))
        dates = sorted(Task.objects.values_list('task_date', flat=True))
        self.assertEqual(dates, [date(2025, 6, 2), date(2025, 6, 3)])

    def test_datetime_cells_are_accepted(self):
        self.post_import(build_workbook([
            ('T10001', 'IT-100', datetime(2025, 6, 4, 9, 30), 1, ''),
        ]))
        self.assertEqual(Task.objects.get().task_date, date(2025, 6, 4))

    def test_blank_rows_are_ignored(self):
        self.post_import(build_workbook([
            ('T10001', 'IT-100', date(2025, 6, 2), 1, ''),
            (None, None, None, None, None),
            ('', '', '', '', ''),
        ]))
        self.assertEqual(Task.objects.count(), 1)

    def test_unknown_technician_blocks_whole_import(self):
        response = self.post_import(build_workbook([
            ('T10001', 'IT-100', date(2025, 6, 2), 1, ''),
            ('NOPE', 'IT-100', date(2025, 6, 3), 1, ''),
        ]))
        self.assertEqual(response.status_code, 302)
        self.assertEqual(Task.objects.count(), 0, 'الاستيراد يجب أن يكون كله أو لا شيء')

    def test_unknown_price_item_blocks_whole_import(self):
        self.post_import(build_workbook([
            ('T10001', 'IT-100', date(2025, 6, 2), 1, ''),
            ('T10001', 'GHOST', date(2025, 6, 3), 1, ''),
        ]))
        self.assertEqual(Task.objects.count(), 0)

    def test_invalid_quantity_blocks_import(self):
        self.post_import(build_workbook([
            ('T10001', 'IT-100', date(2025, 6, 2), 'abc', ''),
        ]))
        self.assertEqual(Task.objects.count(), 0)

    def test_zero_quantity_rejected(self):
        self.post_import(build_workbook([
            ('T10001', 'IT-100', date(2025, 6, 2), 0, ''),
        ]))
        self.assertEqual(Task.objects.count(), 0)

    def test_bad_date_blocks_import(self):
        self.post_import(build_workbook([
            ('T10001', 'IT-100', 'ليس تاريخاً', 1, ''),
        ]))
        self.assertEqual(Task.objects.count(), 0)

    def test_locked_month_is_rejected(self):
        # مستخلص نشط يقفل يونيو 2025
        Statement.objects.create(
            statement_number='ST-202506-303',
            contract=self.contract, year=2025, month=6,
            created_by=self.entry,
        )
        self.post_import(build_workbook([
            ('T10001', 'IT-100', date(2025, 6, 2), 1, ''),
            ('T10001', 'IT-100', date(2025, 7, 2), 1, ''),
        ]))
        self.assertEqual(Task.objects.count(), 0)

    def test_price_item_from_another_contract_is_rejected(self):
        other_contract = make_contract(self.entry, contract_number='404')
        foreign_item = make_price_item(other_contract, code='FOREIGN', unit_price='10.00')
        self.post_import(build_workbook([
            ('T10001', foreign_item.code, date(2025, 6, 2), 1, ''),
        ]))
        self.assertEqual(Task.objects.count(), 0)

    def test_non_excel_file_is_rejected_gracefully(self):
        fake = SimpleUploadedFile('evil.xlsx', b'not a real xlsx file', content_type=XLSX_MIME)
        response = self.post_import(fake)
        self.assertEqual(response.status_code, 302)
        self.assertEqual(Task.objects.count(), 0)

    def test_missing_file_shows_form_errors(self):
        response = self.client.post(reverse('task_import'), {'contract': self.contract.pk})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(Task.objects.count(), 0)

    def test_get_renders_instructions(self):
        response = self.client.get(reverse('task_import'))
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, 'استيراد مهام من Excel')

    def test_import_is_audited(self):
        from core.models import AuditLog
        self.post_import(build_workbook([
            ('T10001', 'IT-100', date(2025, 6, 2), 1, ''),
        ]))
        entry = AuditLog.objects.filter(action='import_tasks').first()
        self.assertIsNotNone(entry)
        self.assertIn('303', entry.details)

    def test_accountant_cannot_import(self):
        accountant = make_user('accountant')
        self.client.force_login(accountant)
        mark_otp_verified(self.client, accountant)
        response = self.client.post(reverse('task_import'), {
            'contract': self.contract.pk,
            'excel_file': build_workbook([('T10001', 'IT-100', date(2025, 6, 2), 1, '')]),
        })
        self.assertEqual(response.status_code, 403)
        self.assertEqual(Task.objects.count(), 0)
