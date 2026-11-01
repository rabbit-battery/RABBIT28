"""اختبارات الأمان: المصادقة الثنائية، تغيير كلمة المرور الإجباري، حماية الجلسة"""

import time

from django.test import TestCase
from django.urls import reverse
from django_otp.oath import TOTP
from django_otp.plugins.otp_totp.models import TOTPDevice
from django_otp.plugins.otp_static.models import StaticToken

from .factories import PASSWORD, make_user, mark_otp_verified


def current_token(device, offset_seconds=0):
    """
    توليد رمز TOTP صالح - بنفس طريقة verify_token.
    offset_seconds يتيح توليد رمز للنافذة الزمنية التالية، لأن django-otp يرفض
    إعادة استخدام نفس النافذة (حماية من إعادة التشغيل).
    """
    totp = TOTP(device.bin_key, device.step, device.t0, device.digits, device.drift)
    totp.time = time.time() + offset_seconds
    return str(totp.token())


class TwoFactorFlowTests(TestCase):
    """
    التدفق الحقيقي عبر HTTP: الدخول → التحويل إلى الإعداد → تفعيل → وصول للوحة.
    قبل إصلاح django_otp.login كان هذا يدخل في حلقة تحويل لا تنتهي.
    """

    def setUp(self):
        self.accountant = make_user('accountant', must_change_password=False)

    def test_sensitive_role_is_redirected_to_2fa_setup(self):
        self.client.force_login(self.accountant)
        response = self.client.get(reverse('dashboard'))
        self.assertEqual(response.status_code, 302)
        self.assertEqual(response['Location'], reverse('setup_2fa'))

    def test_data_entry_is_not_forced_into_2fa(self):
        entry = make_user('data_entry')
        self.client.force_login(entry)
        self.assertEqual(self.client.get(reverse('dashboard')).status_code, 200)

    def test_setup_page_shows_qr_and_secret(self):
        self.client.force_login(self.accountant)
        response = self.client.get(reverse('setup_2fa'))
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, 'data:image/png;base64,')
        self.assertTrue(TOTPDevice.objects.filter(user=self.accountant, confirmed=False).exists())

    def test_full_activation_then_dashboard_is_reachable(self):
        self.client.force_login(self.accountant)
        self.client.get(reverse('setup_2fa'))
        device = TOTPDevice.objects.get(user=self.accountant, confirmed=False)

        response = self.client.post(reverse('verify_2fa'), {'token': current_token(device)})
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, 'تم تفعيل المصادقة الثنائية')

        device.refresh_from_db()
        self.assertTrue(device.confirmed)

        # الجلسة أصبحت موثّقة → لا حلقة تحويل
        dashboard = self.client.get(reverse('dashboard'))
        self.assertEqual(dashboard.status_code, 200)

    def test_backup_codes_are_issued_once(self):
        self.client.force_login(self.accountant)
        self.client.get(reverse('setup_2fa'))
        device = TOTPDevice.objects.get(user=self.accountant, confirmed=False)
        self.client.post(reverse('verify_2fa'), {'token': current_token(device)})

        tokens = list(StaticToken.objects.filter(device__user=self.accountant))
        self.assertEqual(len(tokens), 8)
        self.assertEqual(len({t.token for t in tokens}), 8, 'الرموز يجب أن تكون فريدة')

    def test_wrong_token_is_rejected_and_loop_is_not_entered(self):
        self.client.force_login(self.accountant)
        self.client.get(reverse('setup_2fa'))
        device = TOTPDevice.objects.get(user=self.accountant, confirmed=False)

        response = self.client.post(reverse('verify_2fa'), {'token': '000000'})
        self.assertContains(response, 'الرمز غير صحيح')
        device.refresh_from_db()
        self.assertFalse(device.confirmed)

        # ما زال غير موثّق، فيبقى داخل /2fa/ لا في حلقة بين الصفحات
        self.assertEqual(
            self.client.get(reverse('dashboard'))['Location'], reverse('setup_2fa')
        )

    def test_second_login_asks_for_token_again_not_re_enrolment(self):
        # تفعيل الجهاز أول مرة
        self.client.force_login(self.accountant)
        self.client.get(reverse('setup_2fa'))
        device = TOTPDevice.objects.get(user=self.accountant, confirmed=False)
        self.client.post(reverse('verify_2fa'), {'token': current_token(device)})

        # دخول جديد بجلسة جديدة
        self.client.logout()
        self.client.force_login(self.accountant)
        self.assertEqual(
            self.client.get(reverse('dashboard'))['Location'], reverse('setup_2fa')
        )

        # صفحة الإعداد تحوّل إلى إدخال الرمز بدل عرض QR جديد (منع الحلقة)
        redirected = self.client.get(reverse('setup_2fa'))
        self.assertEqual(redirected.status_code, 302)
        self.assertEqual(redirected['Location'], reverse('verify_2fa'))

        challenge = self.client.get(reverse('verify_2fa'))
        self.assertEqual(challenge.status_code, 200)
        self.assertContains(challenge, 'إدخال رمز المصادقة')

        # نافذة زمنية جديدة: django-otp يرفض إعادة استخدام النافذة المستهلكة
        self.client.post(reverse('verify_2fa'), {
            'token': current_token(device, offset_seconds=device.step)
        })
        self.assertEqual(self.client.get(reverse('dashboard')).status_code, 200)

        # لم يُنشأ جهاز ثانٍ
        self.assertEqual(TOTPDevice.objects.filter(user=self.accountant).count(), 1)

    def test_2fa_pages_are_exempt_from_the_guard(self):
        self.client.force_login(self.accountant)
        for url in (reverse('setup_2fa'), reverse('verify_2fa'), reverse('logout')):
            response = self.client.get(url, follow=False)
            self.assertNotEqual(response.status_code, 302, f'{url} حُوّل بشكل غير متوقع')


class ForcedPasswordChangeTests(TestCase):

    def test_temporary_password_blocks_every_page(self):
        user = make_user('accountant', must_change_password=True)
        self.client.force_login(user)

        for url_name in ('dashboard', 'statements', 'tasks'):
            response = self.client.get(reverse(url_name))
            self.assertEqual(response.status_code, 302, url_name)
            self.assertEqual(response['Location'], reverse('password_change'), url_name)

    def test_password_change_page_itself_is_reachable(self):
        user = make_user('accountant', must_change_password=True)
        self.client.force_login(user)
        self.assertEqual(self.client.get(reverse('password_change')).status_code, 200)

    def test_changing_password_clears_the_flag_and_forces_relogin(self):
        user = make_user('accountant', must_change_password=True)
        self.client.force_login(user)

        response = self.client.post(reverse('password_change'), {
            'old_password': PASSWORD,
            'new_password': 'N3w-Str0nger-Pass!',
            'confirm_password': 'N3w-Str0nger-Pass!',
        })
        self.assertEqual(response.status_code, 302)
        self.assertEqual(response['Location'], reverse('login'))

        user.refresh_from_db()
        self.assertFalse(user.profile.must_change_password)
        self.assertTrue(user.check_password('N3w-Str0nger-Pass!'))

    def test_wrong_current_password_is_rejected(self):
        user = make_user('accountant', must_change_password=True)
        self.client.force_login(user)
        self.client.post(reverse('password_change'), {
            'old_password': 'not-the-password-1',
            'new_password': 'N3w-Str0nger-Pass!',
            'confirm_password': 'N3w-Str0nger-Pass!',
        })
        user.refresh_from_db()
        self.assertTrue(user.profile.must_change_password)

    def test_mismatched_confirmation_is_rejected(self):
        user = make_user('accountant', must_change_password=True)
        self.client.force_login(user)
        self.client.post(reverse('password_change'), {
            'old_password': PASSWORD,
            'new_password': 'N3w-Str0nger-Pass!',
            'confirm_password': 'Different-Pass-123',
        })
        user.refresh_from_db()
        self.assertTrue(user.profile.must_change_password)

    def test_short_password_is_rejected_by_validators(self):
        from core.forms import PasswordChangeForm
        form = PasswordChangeForm({
            'old_password': PASSWORD,
            'new_password': 'short',
            'confirm_password': 'short',
        })
        self.assertFalse(form.is_valid())


class SignatureUploadTests(TestCase):

    def setUp(self):
        self.user = make_user('branch_manager')
        self.client.force_login(self.user)
        mark_otp_verified(self.client, self.user)

    def png(self, width=8, height=8):
        import io
        from PIL import Image
        buf = io.BytesIO()
        Image.new('RGBA', (width, height), (0, 0, 0, 255)).save(buf, format='PNG')
        return buf.getvalue()

    def upload(self, content, name='sig.png', content_type='image/png'):
        from django.core.files.uploadedfile import SimpleUploadedFile
        f = SimpleUploadedFile(name, content, content_type=content_type)
        return self.client.post(reverse('signature_upload'), {'signature': f})

    def stored_path(self):
        self.user.profile.refresh_from_db()
        return self.user.profile.signature_image

    def stored_data(self):
        self.user.profile.refresh_from_db()
        return self.user.profile.signature_data

    def test_valid_png_is_saved_and_recorded(self):
        response = self.upload(self.png())
        self.assertEqual(response.status_code, 302)
        self.assertTrue(self.stored_data(), 'يجب تخزين صورة التوقيع في قاعدة البيانات')

        # الصورة تُعاد معالجتها فيجب أن تبقى PNG صالحة بعد فك الترميز
        import base64
        from PIL import Image
        import io
        with Image.open(io.BytesIO(base64.b64decode(self.stored_data()))) as img:
            self.assertEqual(img.format, 'PNG')

    def test_reupload_replaces_the_old_data(self):
        self.upload(self.png(width=4))
        first = self.stored_data()
        self.assertTrue(first)

        self.upload(self.png(width=6))
        second = self.stored_data()

        self.assertTrue(second)
        self.assertNotEqual(first, second, 'الرفع الجديد يجب أن يستبدل الصورة السابقة')
        self.assertNotEqual(self.stored_path(), '')

    def test_non_image_is_rejected_by_the_form(self):
        response = self.upload(b'\x89PNG fake content', name='evil.png')
        # النموذج يرفض الملف ويعيد عرض الصفحة بالأخطاء
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.stored_path(), '')

    def test_oversized_image_is_rejected(self):
        from django.conf import settings
        from django.core.files.uploadedfile import SimpleUploadedFile
        from core.utils import process_signature_upload

        limit = settings.MAX_SIGNATURE_SIZE_MB * 1024 * 1024
        fake = SimpleUploadedFile('big.png', self.png(), content_type='image/png')
        fake.size = limit + 1   # حجم مُعلن يتجاوز الحد

        with self.assertRaises(ValueError) as ctx:
            process_signature_upload(fake, self.user)
        self.assertIn('ميغابايت', str(ctx.exception))
        self.assertEqual(self.stored_path(), '')

    def test_oversized_upload_shows_error_message(self):
        from unittest import mock
        from core import views_users

        with mock.patch.object(views_users, 'process_signature_upload',
                               side_effect=ValueError('حجم الصورة يتجاوز 1 ميغابايت')):
            response = self.upload(self.png())

        self.assertEqual(response.status_code, 302)
        self.assertEqual(self.stored_path(), '')



class SessionAndHeaderTests(TestCase):

    def test_security_headers_present_in_production_mode(self):
        entry = make_user('data_entry')
        self.client.force_login(entry)
        response = self.client.get(reverse('dashboard'))
        self.assertEqual(response['X-Frame-Options'], 'DENY')
        self.assertIn("default-src 'self'", response['Content-Security-Policy'])

    def test_session_expires_on_browser_close(self):
        from django.conf import settings
        self.assertEqual(settings.SESSION_COOKIE_AGE, 1800)
        self.assertTrue(settings.SESSION_EXPIRE_AT_BROWSER_CLOSE)
        self.assertTrue(settings.SESSION_SAVE_EVERY_REQUEST)

    def test_admin_url_is_not_the_default(self):
        response = self.client.get('/admin/', follow=False)
        self.assertEqual(response.status_code, 404)
        self.assertEqual(self.client.get('/secure-admin-x7k/login/').status_code, 200)

    def test_private_media_is_not_served_by_django(self):
        # لا يوجد مسار /media/ في urlpatterns، فالملفات الخاصة غير قابلة للتحميل عبر الويب
        self.assertEqual(self.client.get('/media/signatures/x.png').status_code, 404)
        self.assertEqual(self.client.get('/private_media/signatures/x.png').status_code, 404)
