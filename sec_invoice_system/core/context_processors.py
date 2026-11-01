"""معالجات سياق: تجعل إعدادات الموقع متاحة لكل قالب."""

from .models import SiteSettings


def site_settings(request):
    """
    يعرّض إعدادات الموقع لكل القوالب.

    يُخزَّن الصف في ذاكرة الطلب لأن القالب يستدعيه عدة مرات (العنوان،
    الألوان، ترتيب القائمة)، ولأن load() قد تُنشئ الصف عند أول استدعاء.
    """
    cached = getattr(request, '_site_settings', None)
    if cached is None:
        cached = SiteSettings.load()
        request._site_settings = cached
    return {
        'site': cached,
        'nav_keys': cached.nav_keys(),
        # يُستخدم في base.html لعرض روابط الإدارة الفنية لمن يملكها فقط
        'is_technical_admin': (
            request.user.is_authenticated
            and (request.user.is_superuser
                 or getattr(getattr(request.user, 'profile', None),
                            'specialty', None) == 'technical_admin')
        ),
    }
