"""
إنشاء/تحديث حساب «الإدارة الفنية».

هذا الحساب مقصود أن يكون واحداً ولا يستطيع أحد إنشاء مثيله من الواجهة:
دور technical_admin مدرج في UserProfile.PROTECTED_SPECIALTIES، وشاشة إدارة
المستخدمين ترفض إنشاؤه أو تعيينه لغير إدارة فنية. لذلك يُنشأ من سطر الأوامر
فقط، حيث يملك المشغّل وصولاً للخادم أصلاً.

الاستخدام:
    python manage.py setup_technical_admin --username techadmin
    python manage.py setup_technical_admin --username techadmin --password '...'
    python manage.py setup_technical_admin --username techadmin --reset-password
"""

import getpass

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from core.models import UserProfile

User = get_user_model()


class Command(BaseCommand):
    help = 'إنشاء أو تحديث حساب الإدارة الفنية (الدور المحمي)'

    def add_arguments(self, parser):
        parser.add_argument('--username', default='techadmin')
        parser.add_argument('--password', help='كلمة المرور؛ تُطلب تفاعلياً إن غابت')
        parser.add_argument('--employee-id', default='TECH-0001')
        parser.add_argument('--full-name', default='الإدارة الفنية')
        parser.add_argument('--reset-password', action='store_true',
                            help='تغيير كلمة مرور حساب قائم')

    @transaction.atomic
    def handle(self, *args, **opts):
        username = opts['username'].strip()
        if not username:
            raise CommandError('اسم المستخدم مطلوب')

        user = User.objects.filter(username=username).first()
        created = user is None

        if created:
            user = User.objects.create_user(
                username=username,
                password=None,  # تُضبط أدناه
            )
            user.is_staff = True
            user.is_active = True
            # Django يحفظ الاسم في first_name/last_name، وget_full_name()
            # يجمعهما، لذا يكفي first_name لعرض الاسم كاملاً في الواجهة.
            user.first_name = opts['full_name']
            user.save()

        profile, _ = UserProfile.objects.get_or_create(
            user=user,
            defaults={'employee_id': opts['employee_id']},
        )
        profile.specialty = 'technical_admin'
        # كلمة المرور من اختيار المشغّل لا مؤقتة، فلا يُجبر على تغييرها
        profile.must_change_password = False
        profile.save()

        password = opts['password']
        if password is None and (created or opts['reset_password']):
            password = getpass.getpass('كلمة المرور: ')
            confirm = getpass.getpass('تأكيد كلمة المرور: ')
            if password != confirm:
                raise CommandError('كلمتا المرور غير متطابقتين')

        if password:
            if len(password) < 12:
                raise CommandError('كلمة المرور يجب ألا تقل عن 12 حرفاً')
            user.set_password(password)
            user.save()

        self.stdout.write(self.style.SUCCESS(
            f'{"أُنشئ" if created else "حُدّث"} حساب الإدارة الفنية: {username}'
        ))
        if created and not password:
            self.stdout.write(self.style.WARNING(
                'لم تُضبط كلمة مرور. استخدم --reset-password لضبطها.'
            ))
