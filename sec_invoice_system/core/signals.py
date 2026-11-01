"""إشارات التطبيق: إنشاء ملف شخصي تلقائي لحسابات الإدارة."""

from django.conf import settings
from django.db.models.signals import post_save


def ensure_profile_for_admins(sender, instance, created, **kwargs):
    """
    حسابات المدير الأعلى (superuser) تُنشأ عبر createsuperuser بلا ملف شخصي،
    وهذا يجعلها بلا تخصص فتفشل فحوص الصلاحية. ننشئ لها ملفاً تلقائياً كمدير
    عقود، مع إبقاء علم «يجب تغيير كلمة المرور» مطفأً لأن كلمة المرور من
    اختيار المدير أصلاً وليست مؤقتة.

    المستخدمون العاديون يُنشَون عبر شاشة إدارة المستخدمين التي تنشئ الملف
    الشخصي صراحةً، لذا لا تتدخل الإشارة معهم.
    """
    if not created or not instance.is_superuser:
        return

    from .models import UserProfile

    UserProfile.objects.get_or_create(
        user=instance,
        defaults={
            'specialty': 'contract_manager',
            'employee_id': f"ADMIN-{instance.pk}",
            'must_change_password': False,
        },
    )


def register():
    """توصيل مستقبلات الإشارات - يُستدعى من CoreConfig.ready()"""
    post_save.connect(
        ensure_profile_for_admins,
        sender=settings.AUTH_USER_MODEL,
        dispatch_uid='core.ensure_profile_for_admins',
    )
