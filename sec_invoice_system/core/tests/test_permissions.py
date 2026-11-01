"""اختبارات الصلاحيات وفصل المهام"""

from django.contrib.auth.models import User
from django.core.management import call_command
from django.test import TestCase
from django.urls import reverse

from core.decorators import role_required
from core.models import UserProfile
from django.core.exceptions import PermissionDenied
from .factories import PASSWORD, make_user, make_contract, mark_otp_verified


class AnonymousAccessTests(TestCase):

    def test_dashboard_requires_login(self):
        response = self.client.get(reverse('dashboard'))
        self.assertEqual(response.status_code, 302)
        self.assertIn(reverse('login'), response['Location'])

    def test_login_page_is_public(self):
        response = self.client.get(reverse('login'))
        self.assertEqual(response.status_code, 200)

    def test_valid_credentials_log_in_and_land_on_dashboard(self):
        user = make_user('data_entry')
        response = self.client.post(reverse('login'), {
            'username': user.username, 'password': PASSWORD
        })
        self.assertEqual(response.status_code, 302)
        self.assertEqual(response['Location'], reverse('dashboard'))

    def test_wrong_password_is_rejected(self):
        user = make_user('data_entry')
        response = self.client.post(reverse('login'), {
            'username': user.username, 'password': 'wrong-password-1234'
        })
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, 'غير صحيحة')

    def test_logout_requires_post(self):
        user = make_user('data_entry')
        self.client.force_login(user)
        self.assertEqual(self.client.get(reverse('logout')).status_code, 405)
        self.assertEqual(self.client.post(reverse('logout')).status_code, 302)
        self.assertFalse('_auth_user_id' in self.client.session)


class RoleMatrixTests(TestCase):
    """جدول صلاحيات: أي تخصص يصل إلى أي صفحة"""

    def setUp(self):
        self.admin = make_user('contract_manager')
        self.contract = make_contract(self.admin, contract_number='202')
        self.users = {
            'data_entry': make_user('data_entry'),
            'accountant': make_user('accountant'),
            'branch_manager': make_user('branch_manager'),
            'approver': make_user('approver'),
            'contract_manager': self.admin,
        }

    def hit(self, specialty, url_name, *args):
        user = self.users[specialty]
        self.client.force_login(user)
        mark_otp_verified(self.client, user)
        return self.client.get(reverse(url_name, args=args) if args else reverse(url_name))

    def test_contract_pages_are_for_contract_manager_only(self):
        for specialty in self.users:
            response = self.hit(specialty, 'contracts')
            expected = 200 if specialty == 'contract_manager' else 403
            self.assertEqual(response.status_code, expected, f'{specialty} → contracts')

    def test_user_management_is_for_contract_manager_only(self):
        for specialty in self.users:
            response = self.hit(specialty, 'users')
            expected = 200 if specialty == 'contract_manager' else 403
            self.assertEqual(response.status_code, expected, f'{specialty} → users')

    def test_tasks_are_open_to_data_entry_and_contract_manager(self):
        allowed = {'data_entry', 'contract_manager'}
        for specialty in self.users:
            response = self.hit(specialty, 'tasks')
            expected = 200 if specialty in allowed else 403
            self.assertEqual(response.status_code, expected, f'{specialty} → tasks')

    def test_technician_list_allows_data_entry(self):
        self.assertEqual(self.hit('data_entry', 'technicians').status_code, 200)
        self.assertEqual(self.hit('approver', 'technicians').status_code, 403)

    def test_every_role_sees_statements_and_tracking(self):
        for specialty in self.users:
            self.assertEqual(self.hit(specialty, 'statements').status_code, 200,
                             f'{specialty} → statements')
            self.assertEqual(self.hit(specialty, 'statement_track').status_code, 200,
                             f'{specialty} → track')

    def test_generate_is_for_accountant_and_contract_manager(self):
        allowed = {'accountant', 'contract_manager'}
        for specialty in self.users:
            response = self.hit(specialty, 'statement_generate')
            expected = 200 if specialty in allowed else 403
            self.assertEqual(response.status_code, expected,
                             f'{specialty} → generate')


class SuperuserTests(TestCase):

    def test_superuser_bypasses_role_checks(self):
        admin = User.objects.create_superuser(
            username='root', password=PASSWORD, email='root@example.com'
        )
        self.client.force_login(admin)
        # مدير العقود تخصص حساس، فيُطلب منه 2FA قبل الوصول للصفحات
        mark_otp_verified(self.client, admin)
        for url_name in ('dashboard', 'contracts', 'users', 'tasks', 'statements'):
            response = self.client.get(reverse(url_name))
            self.assertEqual(response.status_code, 200, f'superuser → {url_name}')

    def test_superuser_gets_a_profile_automatically(self):
        admin = User.objects.create_superuser(
            username='root2', password=PASSWORD, email='root2@example.com'
        )
        profile = UserProfile.objects.get(user=admin)
        self.assertEqual(profile.specialty, 'contract_manager')
        self.assertFalse(profile.must_change_password)

    def test_superuser_without_profile_is_not_locked_out(self):
        # حساب مدير قديم أُنشئ قبل إضافة الإشارة: يجب ألا يفشل بـ 403
        admin = User.objects.create_superuser(
            username='legacy', password=PASSWORD, email='legacy@example.com'
        )
        UserProfile.objects.filter(user=admin).delete()
        self.client.force_login(admin)
        self.assertEqual(self.client.get(reverse('contracts')).status_code, 200)

    def test_superuser_is_hidden_from_user_management_list(self):
        admin = User.objects.create_superuser(
            username='root3', password=PASSWORD, email='root3@example.com'
        )
        manager = make_user('contract_manager')
        self.client.force_login(manager)
        mark_otp_verified(self.client, manager)
        response = self.client.get(reverse('users'))
        self.assertContains(response, manager.username)
        self.assertNotContains(response, admin.username)

    def test_superuser_account_cannot_be_edited_or_reset(self):
        manager = make_user('contract_manager')
        admin = User.objects.create_superuser(
            username='root4', password=PASSWORD, email='root4@example.com'
        )
        self.assertIsNotNone(admin)  # الحساب المستهدف موجود
        self.client.force_login(manager)
        mark_otp_verified(self.client, manager)
        self.client.post(reverse('user_edit', args=[admin.pk]), {
            'username': 'root4', 'first_name': 'X', 'last_name': 'Y',
            'email': 'x@example.com', 'employee_id': 'EMP00001',
            'specialty': 'data_entry',
        })
        admin.refresh_from_db()
        self.assertEqual(admin.first_name, '')
        self.assertTrue(admin.is_superuser)


class UserManagementTests(TestCase):

    def setUp(self):
        self.manager = make_user('contract_manager')
        call_command('setup_roles', verbosity=0)
        self.client.force_login(self.manager)
        mark_otp_verified(self.client, self.manager)

    def test_create_user_issues_temporary_password_and_profile(self):
        response = self.client.post(reverse('user_create'), {
            'username': 'new_accountant',
            'first_name': 'سارة',
            'last_name': 'الحربي',
            'email': 'sara@example.com',
            'employee_id': 'EMP99001',
            'specialty': 'accountant',
        })
        self.assertEqual(response.status_code, 302)

        user = User.objects.get(username='new_accountant')
        self.assertTrue(user.profile.must_change_password)
        self.assertEqual(user.profile.specialty, 'accountant')
        self.assertEqual(user.profile.employee_id, 'EMP99001')
        self.assertTrue(user.groups.filter(name='محاسب').exists())

        messages = [m.message for m in response.wsgi_request._messages]
        self.assertTrue(any('كلمة المرور المؤقتة' in m for m in messages))

    def test_duplicate_username_rejected(self):
        make_user('data_entry', username='taken_name')
        self.client.post(reverse('user_create'), {
            'username': 'taken_name', 'first_name': 'أ', 'last_name': 'ب',
            'email': 'a@example.com', 'employee_id': 'EMP99002',
            'specialty': 'data_entry',
        })
        self.assertEqual(User.objects.filter(username='taken_name').count(), 1)

    def test_duplicate_employee_id_rejected(self):
        existing = make_user('data_entry')
        self.client.post(reverse('user_create'), {
            'username': 'other_name', 'first_name': 'أ', 'last_name': 'ب',
            'email': 'a@example.com',
            'employee_id': existing.profile.employee_id,
            'specialty': 'data_entry',
        })
        self.assertFalse(User.objects.filter(username='other_name').exists())

    def test_cannot_edit_own_account(self):
        self.client.post(reverse('user_edit', args=[self.manager.pk]), {
            'username': self.manager.username, 'first_name': 'معدَّل',
            'last_name': 'ب', 'email': 'x@example.com',
            'employee_id': 'EMP88001', 'specialty': 'data_entry',
        })
        self.manager.refresh_from_db()
        self.assertNotEqual(self.manager.first_name, 'معدَّل')

    def test_reset_password_forces_change_on_next_login(self):
        target = make_user('data_entry')
        target.profile.must_change_password = False
        target.profile.save()

        self.client.post(reverse('user_reset_password', args=[target.pk]))
        target.refresh_from_db()
        self.assertTrue(target.profile.must_change_password)
        self.assertFalse(target.check_password(PASSWORD))


class RoleRequiredDecoratorTests(TestCase):
    """اختبار مباشر للمزخرف"""

    def _call(self, user):
        from django.test import RequestFactory

        @role_required('accountant')
        def view(request):
            from django.http import HttpResponse
            return HttpResponse('ok')

        request = RequestFactory().get('/')
        request.user = user
        return view(request)

    def test_matching_specialty_passes(self):
        user = make_user('accountant')
        self.assertEqual(self._call(user).status_code, 200)

    def test_other_specialty_denied(self):
        user = make_user('data_entry')
        with self.assertRaises(PermissionDenied):
            self._call(user)

    def test_superuser_passes(self):
        admin = User.objects.create_superuser(
            username='su_dec', password=PASSWORD, email='su@example.com'
        )
        self.assertEqual(self._call(admin).status_code, 200)

    def test_missing_profile_denied_for_regular_user(self):
        user = make_user('data_entry')
        UserProfile.objects.filter(user=user).delete()
        with self.assertRaises(PermissionDenied):
            self._call(user)
