"""إعدادات نظام مستخلصات العقد الموحد - الشركة السعودية للكهرباء."""

import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent

SECRET_KEY = os.environ.get('DJANGO_SECRET_KEY', 'change-me-in-production-to-random-50-chars')

DEBUG = os.environ.get('DJANGO_DEBUG', '0') == '1'

ALLOWED_HOSTS = os.environ.get('DJANGO_ALLOWED_HOSTS', 'localhost,127.0.0.1').split(',')

# نطاقات موثوق بها لـ CSRF (مطلوبة في Django 4+ عند العمل خلف وكيل HTTPS)
CSRF_TRUSTED_ORIGINS = [
    origin.strip()
    for origin in os.environ.get('CSRF_TRUSTED_ORIGINS', '').split(',')
    if origin.strip()
]

# ──────────── النشر على Vercel ────────────
# Vercel يعطي كل نشر نطاقاً فريداً (project-branch-hash.vercel.app) لا يمكن
# معرفته مسبقاً، فنتبنّى نطاق *.vercel.app كاملاً. هذا مقبول هنا لأن كل
# نطاقات vercel.app تُخدم عبر HTTPS إلزامياً ولا يمكن لمهاجم انتحال نطاق
# فرعي لنا. عند النشر الداخلي النهائي تُضبط القيمتان صراحةً عبر متغيرات
# البيئة وتُحذف هذه الفقرة.
if os.environ.get('VERCEL'):
    if '.vercel.app' not in ALLOWED_HOSTS:
        ALLOWED_HOSTS.append('.vercel.app')
    for _origin in ('https://*.vercel.app',):
        if _origin not in CSRF_TRUSTED_ORIGINS:
            CSRF_TRUSTED_ORIGINS.append(_origin)

INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    'axes',
    'django_otp',
    'django_otp.plugins.otp_totp',
    'django_otp.plugins.otp_static',
    'core',
]

MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    # يخدم الملفات الثابتة مباشرة في النشر serverless (Vercel) حيث لا يوجد
    # nginx. في نشر Docker يمرّ nginx أولاً فلا يتأثر الأداء.
    'whitenoise.middleware.WhiteNoiseMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django_otp.middleware.OTPMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
    'csp.middleware.CSPMiddleware',
    'axes.middleware.AxesMiddleware',
    'core.middleware.ForcePasswordChangeMiddleware',
    'core.middleware.Force2FAMiddleware',
]

AUTHENTICATION_BACKENDS = [
    'axes.backends.AxesStandaloneBackend',
    'django.contrib.auth.backends.ModelBackend',
]

ROOT_URLCONF = 'config.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.debug',
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'config.wsgi.application'

# ──────────── قاعدة البيانات ────────────
def _parse_database_url(url):
    """
    تحليل DATABASE_URL إلى مكونات Django.

    مكتوبة يدوياً بدل إضافة حزمة dj-database-url: الصيغة محدودة ومعروفة،
    وتجنّب الحزمة يبقي سلسلة التوريد أصغر في نظام مالي.
    """
    from urllib.parse import urlparse, unquote
    parsed = urlparse(url)
    return {
        'ENGINE': 'django.db.backends.postgresql',
        'NAME': (parsed.path or '/').lstrip('/'),
        'USER': unquote(parsed.username or ''),
        'PASSWORD': unquote(parsed.password or ''),
        'HOST': parsed.hostname or '',
        'PORT': str(parsed.port or 5432),
        # الاتصالات serverless قصيرة العمر؛ عدم إبقائها يمنع استنفاد
        # اتصالات قاعدة البيانات عند توسّع عدد النسخ.
        'CONN_MAX_AGE': 0,
        'OPTIONS': {'connect_timeout': 10},
    }


_database_url = os.environ.get('DATABASE_URL')

if _database_url:
    DATABASES = {'default': _parse_database_url(_database_url)}
elif os.environ.get('DB_HOST'):
    DATABASES = {
        'default': {
            'ENGINE': 'django.db.backends.postgresql',
            'NAME': os.environ.get('DB_NAME', 'sec_db'),
            'USER': os.environ.get('DB_USER', 'sec_user'),
            'PASSWORD': os.environ.get('DB_PASSWORD', ''),
            'HOST': os.environ.get('DB_HOST', 'db'),
            'PORT': os.environ.get('DB_PORT', '5432'),
        }
    }
else:
    DATABASES = {
        'default': {
            'ENGINE': 'django.db.backends.sqlite3',
            'NAME': BASE_DIR / 'db.sqlite3',
        }
    }

# ──────────── كلمة المرور ────────────
AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator'},
    {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator',
     'OPTIONS': {'min_length': 12}},
    {'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator'},
    {'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator'},
]

# ──────────── التوطين ────────────
LANGUAGE_CODE = 'ar'
TIME_ZONE = 'Asia/Riyadh'
USE_I18N = True
USE_TZ = True

# صيغة الأرقام: وحدة الصيغة المدمجة للغة العربية تضبط NUMBER_GROUPING=0 وفاصلة
# عشرية «,» فيظهر المبلغ «1500,00» وهو مُلبس في مستند مالي. نتجاوز ذلك عبر
# FORMAT_MODULE_PATH (الإعدادات العادية لا تكفي لأن وحدة اللغة تُقرأ أولاً)
# لتصبح الصيغة 1,500.00 ر.س كما هو معتاد في المستندات المالية السعودية.
USE_THOUSAND_SEPARATOR = True
FORMAT_MODULE_PATH = ['config.formats']

# ──────────── مسارات الدخول ────────────
LOGIN_URL = 'login'
LOGIN_REDIRECT_URL = 'dashboard'
LOGOUT_REDIRECT_URL = 'login'

# ──────────── الملفات ────────────
STATIC_URL = '/static/'


def _resolve_path(value, default):
    """مسار مطلق كما هو، أو نسبي فيُحلّ تحت BASE_DIR."""
    p = Path(value)
    return p if p.is_absolute() else (BASE_DIR / p)


# STATIC_ROOT قابل للتحديد بمتغير بيئة: على Vercel يوضع تحت public/static
# لأن Vercel يخدم مجلد الإخراج من حافة الشبكة، فيُطلب الملف من
# /static/core/css/style.css ويقابله public/static/core/css/style.css.
STATIC_ROOT = _resolve_path(os.environ.get('STATIC_ROOT', 'staticfiles'),
                            BASE_DIR / 'staticfiles')
MEDIA_URL = '/media/'

# المسارات قابلة للتحديد بمتغيرات بيئة: النشر serverless (Vercel) قرصُه
# للقراءة فقط عدا /tmp، فيُوجَّه الرفع إليه. (الصور الموقّعة محفوظة في قاعدة
# البيانات فلا تتأثر؛ هذا خاص بمرفقات العقود المؤقتة.)
MEDIA_ROOT = _resolve_path(os.environ.get('MEDIA_ROOT', 'media'), BASE_DIR / 'media')
PRIVATE_MEDIA_ROOT = _resolve_path(os.environ.get('PRIVATE_MEDIA_ROOT', 'private_media'),
                                   BASE_DIR / 'private_media')

# WhiteNoise يخدم الملفات الثابتة. خلفية الملفات الثابتة قابلة للتحديد
# بمتغير بيئة DJANGO_STATIC_STORAGE لأن المعالجة اللاحقة (ضغط gzip/brotli +
# تجزئة الأسماء) تحتاج كتابة ملفات وسيطة، وقد لا تتوفر في كل بيئات البناء.
#
# الافتراضي:
#   - الإنتاج (nginx/Docker): CompressedManifestStaticFilesStorage
#     → كاش دائم في المتصفح لأن الأسماء تتغير مع المحتوى.
#   - التطوير/الاختبارات: StaticFilesStorage
#     → ManifestStaticFilesStorage يرفع ValueError لأي مرجع غير موجود في
#       staticfiles.json، فيُفشل الاختبارات.
STATICFILES_BACKEND = os.environ.get(
    'DJANGO_STATIC_STORAGE',
    'whitenoise.storage.CompressedManifestStaticFilesStorage' if not DEBUG
    else 'django.contrib.staticfiles.storage.StaticFilesStorage',
)

STORAGES = {
    'default': {'BACKEND': 'django.core.files.storage.FileSystemStorage'},
    'staticfiles': {'BACKEND': STATICFILES_BACKEND},
}
WHITENOISE_ALLOW_ALL_ORIGINS = False
WHITENOISE_MAX_AGE = 31536000  # سنة

DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

# ──────────── الأمان ────────────
if not DEBUG:
    SECURE_SSL_REDIRECT = True
    SECURE_HSTS_SECONDS = 31536000
    SECURE_HSTS_INCLUDE_SUBDOMAINS = True
    SECURE_HSTS_PRELOAD = True
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    SECURE_CONTENT_TYPE_NOSNIFF = True
    X_FRAME_OPTIONS = 'DENY'
    # nginx ينهي TLS ويمرّر X-Forwarded-Proto؛ بدون هذا السطر تبقى Django ترى
    # الطلب HTTP فتعيد توجيهه إلى HTTPS في حلقة لا تنتهي.
    SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')
    USE_X_FORWARDED_HOST = True
    # HEALTHCHECK في Dockerfile يستدعي gunicorn على http://127.0.0.1:8000
    # مباشرة دون nginx، فلا تصله ترويسة X-Forwarded-Proto. ومع ضبط
    # SECURE_PROXY_SSL_HEADER أعلاه تتجاهل Django مخطط الاتصال وتعتمد
    # الترويسة وحدها، فيرجع الفحص 301 دائماً وتُعلَّم الحاوية غير سليمة.
    SECURE_REDIRECT_EXEMPT = [r'^health/$']

SESSION_COOKIE_AGE = 1800  # 30 دقيقة
SESSION_SAVE_EVERY_REQUEST = True
SESSION_EXPIRE_AT_BROWSER_CLOSE = True

# ──────────── CSP ────────────
CSP_DEFAULT_SRC = ("'self'",)
CSP_SCRIPT_SRC = ("'self'",)
CSP_STYLE_SRC = ("'self'",)
CSP_IMG_SRC = ("'self'", "data:")
CSP_FONT_SRC = ("'self'",)

# ──────────── Axes ────────────
AXES_FAILURE_LIMIT = 5
AXES_COOLOFF_TIME = 1  # ساعة
AXES_LOCKOUT_PARAMETERS = ['username']

# ──────────── السجلات ────────────
LOGGING = {
    'version': 1,
    'disable_existing_loggers': False,
    'formatters': {
        'simple': {'format': '{levelname} {asctime} {name} {message}', 'style': '{'},
    },
    'handlers': {
        'console': {
            'class': 'logging.StreamHandler',
            'formatter': 'simple',
        },
    },
    'root': {
        'handlers': ['console'],
        'level': os.environ.get('DJANGO_LOG_LEVEL', 'INFO'),
    },
}

# ──────────── ثوابت المشروع ────────────
VAT_RATE = 15
MAX_UPLOAD_SIZE_MB = 20
MAX_EXCEL_SIZE_MB = 5
MAX_EXCEL_ROWS = 5000
MAX_SIGNATURE_SIZE_MB = 1
# الحد الأعلى لحجم التوقيع بعد معالجته وترميزه base64 (≈ 750KB صورة أصلية)
MAX_SIGNATURE_BASE64_CHARS = 1_000_000
