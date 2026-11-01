# هجرة بيانات: إنشاء حساب «الإدارة الفنية» الحصري.
#
# لماذا هجرة لا أمر إدارة؟ لأن النشر على Vercel يلتقط buildCommand من لقطة
# إعدادات سابقة؛ تبيّن من سجل البناء مرتين أن setup_technical_admin لم يُنفَّذ
# رغم تحديث إعداد المشروع. أما `migrate --noinput` فهو في أمر البناء منذ
# البداية ويُنفَّذ فعلياً في كل نشر، فجعلنا الإنشاء هنا لضمان التنفيذ.
import os

from django.contrib.auth.hashers import make_password
from django.db import migrations

USERNAME = os.environ.get('TECH_ADMIN_USERNAME', 'techadmin')
EMPLOYEE_ID = 'TECH-ADMIN'


def create_technical_admin(apps, schema_editor):
    User = apps.get_model('auth', 'User')
    UserProfile = apps.get_model('core', 'UserProfile')

    if User.objects.filter(username=USERNAME).exists():
        return

    password = os.environ.get('TECH_ADMIN_PASSWORD', '')
    user = User.objects.create(
        username=USERNAME,
        first_name='الإدارة الفنية',
        last_name='',
        email='',
        is_staff=True,
        is_superuser=False,
        # make_password(None) يُنتج علامة «كلمة مرور غير صالحة»: لا يمكن الدخول
        # بها إطلاقاً، فيُجبَر المستخدم على تعيين كلمة مرور قبل أي وصول.
        password=make_password(password or None),
    )
    UserProfile.objects.create(
        user=user,
        specialty='technical_admin',
        employee_id=EMPLOYEE_ID,
        must_change_password=not password,
    )


def remove_technical_admin(apps, schema_editor):
    # لا نحذف الحساب عند التراجع: سجلّه مرتبط بسجل تدقيق بقيد PROTECT،
    # فالحذف قد يفشل أو يمحو أثراً تدقيقياً يجب أن يبقى.
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0004_alter_auditlog_action'),
    ]

    operations = [
        migrations.RunPython(create_technical_admin, remove_technical_admin),
    ]
