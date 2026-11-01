from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import path, include

urlpatterns = [
    path('secure-admin-x7k/', admin.site.urls),
    path('', include('core.urls')),
]

# في التطوير فقط (عند التشغيل عبر gunicorn بدل runserver) تُخدَم الملفات
# الثابتة من STATIC_ROOT بعد collectstatic. في الإنتاج يخدمها nginx و DEBUG=0.
if settings.DEBUG:
    urlpatterns += static(settings.STATIC_URL, document_root=settings.STATIC_ROOT)
