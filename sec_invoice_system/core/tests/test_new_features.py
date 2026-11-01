"""اختبارات الميزات المضافة: الإدارة الفنية، إعدادات الموقع، Excel، نتائج الأيام."""

import io

from decimal import Decimal

from django.core.exceptions import ValidationError
from django.test import TestCase
from django.urls import reverse
from django.utils import timezone
from openpyxl import Workbook, load_workbook

from .factories import (make_contract, make_price_item, make_task,
                        make_technician, make_user, mark_otp_verified)
from ..models import SiteSettings
from ..views import _resolve_price_item


def _items_xlsx(rows):
    """بناء ملف xlsx في الذاكرة بأعمدة بنود الأسعار"""
    wb = Workbook()
    ws = wb.active
    ws.append(['كود البند', 'وصف البند', 'الوحدة', 'سعر الوحدة', 'نشط'])
    for row in rows:
        ws.append(row)
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    buf.name = 'items.xlsx'
    return buf


class SiteSettingsTests(TestCase):

    def test_singleton_is_created_once(self):
        first = SiteSettings.load()
        second = SiteSettings.load()
        self.assertEqual(first.pk, second.pk)
        self.assertEqual(SiteSettings.objects.count(), 1)

    def test_invalid_color_is_rejected(self):
        site = SiteSettings.load()
        site.primary_color = 'red'
        with self.assertRaises(ValidationError):
            site.full_clean()

    def test_unknown_nav_key_is_rejected(self):
        site = SiteSettings.load()
        site.nav_order = 'dashboard,bogus'
        with self.assertRaises(ValidationError):
            site.full_clean()

    def test_duplicate_nav_key_is_rejected(self):
        site = SiteSettings.load()
        site.nav_order = 'tasks,tasks'
        with self.assertRaises(ValidationError):
            site.full_clean()

    def test_nav_keys_appends_missing_keys_at_end(self):
        site = SiteSettings.load()
        site.nav_order = 'tasks'
        keys = site.nav_keys()
        self.assertEqual(keys[0], 'tasks')
        self.assertIn('dashboard', keys)
        self.assertEqual(len(keys), len(set(keys)))

    def test_defaults_are_sane(self):
        site = SiteSettings.load()
        self.assertTrue(site.site_name)
        self.assertTrue(site.org_name)
        self.assertEqual(site.primary_color, '#0B6E4F')


class TechnicalAdminGuardTests(TestCase):
    """الدور المحمي لا يُنشأ ولا يُعيَّن إلا بواسطة إدارة فنية"""

    def setUp(self):
        self.manager = make_user('contract_manager')

    def test_contract_manager_cannot_create_technical_admin(self):
        self.client.force_login(self.manager)
        mark_otp_verified(self.client, self.manager)
        response = self.client.post(reverse('user_create'), {
            'username': 'sneaky', 'first_name': 'س', 'last_name': 'ص',
            'email': 's@example.com', 'employee_id': 'EMP-999',
            'specialty': 'technical_admin',
        })
        # المهم أن الحساب لم يُنشأ، سواء رفضه النموذج (200) أو الحارس (302)
        self.assertIn(response.status_code, (200, 302))
        from django.contrib.auth.models import User
        self.assertFalse(User.objects.filter(username='sneaky').exists())

    def test_contract_manager_can_still_create_normal_user(self):
        self.client.force_login(self.manager)
        mark_otp_verified(self.client, self.manager)
        response = self.client.post(reverse('user_create'), {
            'username': 'normal', 'first_name': 'ع', 'last_name': 'ادي',
            'email': 'n@example.com', 'employee_id': 'EMP-888',
            'specialty': 'data_entry',
        })
        self.assertEqual(response.status_code, 302)
        from django.contrib.auth.models import User
        self.assertTrue(User.objects.filter(username='normal').exists())

    def test_contract_manager_cannot_promote_existing_user(self):
        target = make_user('data_entry')
        self.client.force_login(self.manager)
        mark_otp_verified(self.client, self.manager)
        response = self.client.post(reverse('user_edit', args=[target.pk]), {
            'username': target.username, 'first_name': 'ا', 'last_name': 'ب',
            'email': 't@example.com', 'employee_id': target.profile.employee_id,
            'specialty': 'technical_admin',
        })
        self.assertIn(response.status_code, (200, 302))
        target.profile.refresh_from_db()
        self.assertEqual(target.profile.specialty, 'data_entry')

    def test_contract_manager_cannot_demote_a_technical_admin(self):
        """تجريد الإدارة الفنية من دورها محمي أيضاً"""
        tech = make_user('technical_admin')
        self.client.force_login(self.manager)
        mark_otp_verified(self.client, self.manager)
        response = self.client.post(reverse('user_edit', args=[tech.pk]), {
            'username': tech.username, 'first_name': 'ا', 'last_name': 'ب',
            'email': 'x@example.com', 'employee_id': tech.profile.employee_id,
            'specialty': 'data_entry',
        })
        self.assertEqual(response.status_code, 302)
        tech.profile.refresh_from_db()
        self.assertEqual(tech.profile.specialty, 'technical_admin')


class CanManageRoleTests(TestCase):
    """منطق الحارس مباشرة، بغضّ النظر عن رفض النموذج"""

    def test_normal_role_is_allowed_for_everyone(self):
        from ..views_users import _can_manage_role
        manager = make_user('contract_manager')
        self.assertTrue(_can_manage_role(manager, 'data_entry'))
        self.assertTrue(_can_manage_role(manager, 'contract_manager'))

    def test_protected_role_requires_technical_admin(self):
        from ..views_users import _can_manage_role
        manager = make_user('contract_manager')
        tech = make_user('technical_admin')
        self.assertFalse(_can_manage_role(manager, 'technical_admin'))
        self.assertTrue(_can_manage_role(tech, 'technical_admin'))


class PriceItemExcelTests(TestCase):

    def setUp(self):
        self.manager = make_user('contract_manager')
        self.contract = make_contract(self.manager)
        make_price_item(self.contract, code='1.1', unit_price='100.00')
        self.client.force_login(self.manager)
        mark_otp_verified(self.client, self.manager)

    def test_export_returns_readable_workbook(self):
        response = self.client.get(
            reverse('price_items_export', args=[self.contract.pk]))
        self.assertEqual(response.status_code, 200)
        self.assertIn('spreadsheetml', response['Content-Type'])
        ws = load_workbook(io.BytesIO(response.content)).active
        self.assertEqual(ws['A1'].value, 'كود البند')
        self.assertEqual(ws['A2'].value, '1.1')
        self.assertEqual(ws['D2'].value, 100.0)

    def test_template_download_works(self):
        response = self.client.get(
            reverse('price_items_template', args=[self.contract.pk]))
        self.assertEqual(response.status_code, 200)
        ws = load_workbook(io.BytesIO(response.content)).active
        self.assertEqual(ws['A2'].value, '1.1.1')

    def test_import_creates_new_and_updates_existing(self):
        existing = self.contract.price_items.get(code='1.1')
        upload = _items_xlsx([
            ['1.1', 'صيانة لوحة محدثة', 'وحدة', 150.00, 'نعم'],
            ['2.2', 'بند جديد', 'ساعة', 80.00, 'نعم'],
        ])
        response = self.client.post(
            reverse('price_items_import', args=[self.contract.pk]),
            {'excel_file': upload})
        self.assertEqual(response.status_code, 302)

        existing.refresh_from_db()
        self.assertEqual(existing.unit_price, Decimal('150.00'))
        self.assertEqual(existing.description, 'صيانة لوحة محدثة')
        self.assertTrue(self.contract.price_items.filter(code='2.2').exists())

    def test_import_rejects_invalid_price(self):
        upload = _items_xlsx([['9.9', 'بند', 'وحدة', 'ليس رقماً', 'نعم']])
        response = self.client.post(
            reverse('price_items_import', args=[self.contract.pk]),
            {'excel_file': upload})
        self.assertEqual(response.status_code, 302)
        self.assertFalse(self.contract.price_items.filter(code='9.9').exists())

    def test_import_deactivates_when_marked_no(self):
        upload = _items_xlsx([['1.1', 'بند', 'وحدة', 100.00, 'لا']])
        self.client.post(reverse('price_items_import', args=[self.contract.pk]),
                         {'excel_file': upload})
        self.assertFalse(self.contract.price_items.get(code='1.1').is_active)


class PriceItemAutoMatchTests(TestCase):
    """البند يُطبَّق تلقائياً من كود أو من نوع العمل"""

    def setUp(self):
        self.manager = make_user('contract_manager')
        self.contract = make_contract(self.manager)
        self.item = make_price_item(self.contract, code='1.1',
                                    unit_price='100.00')
        self.item.description = 'صيانة لوحة جهد منخفض'
        self.item.save()

    def test_matches_by_code(self):
        self.assertEqual(
            _resolve_price_item(self.contract, '1.1').pk, self.item.pk)

    def test_matches_by_work_type_description(self):
        self.assertEqual(
            _resolve_price_item(self.contract, 'صيانة لوحة جهد منخفض').pk,
            self.item.pk)

    def test_matches_ignoring_extra_spaces(self):
        self.assertEqual(
            _resolve_price_item(self.contract, '  صيانة   لوحة جهد منخفض ').pk,
            self.item.pk)

    def test_ambiguous_description_is_rejected(self):
        other = make_price_item(self.contract, code='1.2', unit_price='200.00')
        other.description = 'صيانة لوحة جهد منخفض'
        other.save()
        self.assertIsNone(
            _resolve_price_item(self.contract, 'صيانة لوحة جهد منخفض'))

    def test_unknown_value_returns_none(self):
        self.assertIsNone(_resolve_price_item(self.contract, 'غير موجود'))

    def test_empty_value_returns_none(self):
        self.assertIsNone(_resolve_price_item(self.contract, ''))
        self.assertIsNone(_resolve_price_item(self.contract, None))


class DailyReportTests(TestCase):

    def setUp(self):
        self.entry = make_user('data_entry')
        self.manager = make_user('contract_manager')
        self.contract = make_contract(self.manager)
        self.item = make_price_item(self.contract, unit_price='100.00')
        self.tech = make_technician()

    def test_page_renders_for_any_logged_in_user(self):
        self.client.force_login(self.entry)
        response = self.client.get(reverse('daily_report'))
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, 'نتائج الأيام')

    def test_totals_are_computed(self):
        today = timezone.localdate()
        make_task(self.contract, self.tech, self.item, today,
                  Decimal('2'), self.entry)

        self.client.force_login(self.entry)
        response = self.client.get(
            reverse('daily_report'),
            {'year': today.year, 'month': today.month})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.context['month_total'], Decimal('200.00'))
        self.assertGreater(response.context['forecast'], Decimal('0'))

    def test_bad_month_falls_back_to_current(self):
        self.client.force_login(self.entry)
        response = self.client.get(reverse('daily_report'), {'month': '99'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.context['month'], timezone.localdate().month)

    def test_anonymous_is_redirected(self):
        response = self.client.get(reverse('daily_report'))
        self.assertEqual(response.status_code, 302)
        self.assertIn('/login/', response['Location'])
