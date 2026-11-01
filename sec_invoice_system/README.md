# نظام مستخلصات العقد الموحد — الشركة السعودية للكهرباء

نظام داخلي (RTL بالكامل) لإدارة مهام الفنيين اليومية وتجميعها في مستخلصات شهرية
معتمدة، مع مسار تدقيق غير قابل للتلاعب وتصدير PDF / Excel.

---

## التشغيل السريع (للتطوير)

```bash
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt          # WeasyPrint يحتاج مكتبات نظام — انظر أدناه

python manage.py migrate
python manage.py setup_roles             # إنشاء المجموعات والصلاحيات
python manage.py seed_demo               # بيانات تجريبية (اختياري)
python manage.py runserver 0.0.0.0:8000
```

حسابات `seed_demo` — كلمة المرور للجميع `Demo-Passw0rd!2025`:

| اسم المستخدم | التخصص | يستطيع |
|---|---|---|
| `manager` | مدير العقود | العقود، بنود الأسعار، الفنيون، العطل، المستخدمون |
| `entry` | مدخل بيانات | إدخال/استيراد المهام |
| `accountant` | محاسب | إنشاء المستخلص، تسجيل الصرف |
| `branch` | مدير الفرع | المراجعة، الحذف |
| `approver` | معتمد المستخلص | الاعتماد |

لإنشاء مدير أعلى بدل البيانات التجريبية:
`python manage.py createsuperuser` — يُنشأ له ملف شخصي تلقائياً، ثم الدخول إلى
`/secure-admin-x7k/`.

> **مكتبات WeasyPrint** (تصدير PDF) ليست مكتبات بايثون فقط؛ تحتاج `pango` على
> النظام. على Debian/Ubuntu:
> `apt-get install libpango-1.0-0 libpangocairo-1.0-0 libgdk-pixbuf-2.0-0 shared-mime-info fonts-amiri`
> صورة Dockerfile تثبّتها تلقائياً. إذا كانت ناقصة، صفحة المستخلص تعرض رسالة
> واضحة بدل أن ينهار الطلب.

## الاختبارات

```bash
python manage.py test core
```

148 اختباراً تغطي: تحويل المبالغ للحروف، حساب أيام العمل، دورة حياة المستخلص
(إنشاء → مراجعة → اعتماد → صرف → حذف)، فصل المهام، سلسلة البصمات واكتشاف
العبث، استيراد Excel، التصدير، الصلاحيات، والمصادقة الثنائية عبر HTTP فعلياً.

## التشغيل بـ Docker

```bash
cp .env.example .env                     # وعدّل القيم — DJANGO_SECRET_KEY إلزامي
mkdir -p nginx/ssl && openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout nginx/ssl/key.pem -out nginx/ssl/cert.pem -subj "/CN=localhost"
docker compose up -d --build
docker compose exec web python manage.py migrate
docker compose exec web python manage.py setup_roles
docker compose exec web python manage.py createsuperuser
```

---

## التعديلات على المواصفة الأصلية

الكود المُسلَّم في المواصفة كان يحتوي أخطاء تمنع التشغيل أو تُنتج سلوكاً خاطئاً.
كل تعديل أدناه مُثبت باختبار.

### أخطاء تمنع التشغيل

| المشكلة | الأثر | المعالجة |
|---|---|---|
| `from django.core.exceptions import ... PermissionError` | `ImportError` عند الإقلاع — التطبيق لا يعمل إطلاقاً | `PermissionError` دالة مدمجة في بايثون، أُزيلت من الاستيراد |
| `LOGIN_REDIRECT_URL` غير معرّف | بعد الدخول يُحوَّل إلى `/accounts/profile/` → 404 | ضُبط على `dashboard` مع `LOGIN_URL` و`LOGOUT_REDIRECT_URL` |
| الخروج برابط `<a href="{% url 'logout' %}">` | Django 5 يقبل POST فقط → `405` | نموذج POST بزر في `base.html` |
| `verify_2fa` لا يستدعي `django_otp.login()` | حلقة تحويل لا تنتهي: كل الأدوار الحساسة تُعاد إلى `/2fa/setup/` للأبد | استدعاء `otp_login()` بعد التحقق + فصل مسار «تسجيل جهاز» عن مسار «تحدي الدخول» |
| `setup_2fa` يحوّل إلى `dashboard` إذا وُجد جهاز مؤكَّد | الحلقة نفسها من الجهة الأخرى | التحويل إلى `verify_2fa` (إدخال الرمز) بدل عرض QR جديد |
| `SECURE_PROXY_SSL_HEADER` مفقود مع `SECURE_SSL_REDIRECT=True` | حلقة HTTPS لا تنتهي خلف nginx | إضافة الرأس + `USE_X_FORWARDED_HOST` + `CSRF_TRUSTED_ORIGINS` |
| `django-csp>=3.8` بلا سقف | v4 يتجاهل `CSP_DEFAULT_SRC` فيُعطَّل CSP بصمت | التثبيت على `>=3.8,<4` |
| `SECURE_BROWSER_XSS_FILTER` | أُزيل في Django 5.0 — إعداد ميت | حُذف |
| ملفات ناقصة | `manage.py`، حزم `__init__.py`، `statement_pdf.html`، `contract_form.html`، ملف `chart.min.js` | أُنشئت (Chart.js v4.4.9 من npm) |

### أخطاء منطقية وأمنية

| المشكلة | المعالجة |
|---|---|
| `role_required` يلتقط `AttributeError` فقط، فحساب بلا ملف شخصي (مدير أعلى أُنشئ بـ `createsuperuser`) يُرفض بـ 403 في كل الصفحات | التقاط `ObjectDoesNotExist` + مرور المدير الأعلى دائماً + إشارة تُنشئ ملفاً شخصياً للمدير الأعلى |
| `{% if m.change is not None %}` في `statement_compare.html` | `None` يُقارن بنص فارغ في قوالب Django فيظهر تغيير خاطئ؛ أُعيدت الكتابة بـ `is None` |
| بصمة الحدث لا تشمل `signature_snapshot` | استبدال صورة التوقيع في قاعدة البيانات كان يمر بلا كشف؛ أُدخلت في البصمة |
| ربط الأحداث يُرتَّب بـ `-timestamp` وحده | حدثان في نفس الميكروثانية قد يُربطان بترتيب خاطئ؛ أُضيف `-id` |
| ضريبة القيمة المضافة مثبّتة على `0.15` في الكود | تُقرأ من `settings.VAT_RATE` |
| `statement_notes` كان رابط GET لعرض يعالج POST فقط | الرابط لم يكن يفعل شيئاً؛ صار يعرض نموذج تعديل |
| حدود الاستيراد مكتوبة بأرقام ثابتة (5MB / 5000) | تُقرأ من `settings.MAX_EXCEL_SIZE_MB` و`MAX_EXCEL_ROWS` |
| `except (ValueError, Exception)` في الاستيراد، ورسالة خطأ قد تستخدم متغيراً غير معرَّف | استثناءات محددة + `_coerce_task_date` يقبل خلية تاريخ Excel و`YYYY-MM-DD` و`DD/MM/YYYY` + تجاهل الأسطر الفارغة |
| صلاحيات `add_user`/`change_user`/`view_user` لمجموعة مدير العقود | تتيح الدخول لإدارة المستخدمين عبر `/secure-admin-x7k/`؛ حُذفت (الشاشات المخصصة محمية بـ `role_required` أصلاً) |
| `StatementAdmin` يستخدم المدير الافتراضي | المستخلصات المحذوفة منطقياً كانت مخفية عن المدير الأعلى؛ `get_queryset` يعرضها |
| `CSP` يمنع `unsafe-inline` مع `onchange="..."` و`style="..."` داخل القوالب | الفلتر والرسم البياني يعملان بلا سكربت مضمّن؛ `style` استُبدلت بخاصية `hidden` |
| رقم المستخلص في `TrackStatementForm` لا يقبل سوى `[\w\-]+` | عقود بأرقام تحوي `/` أو `.` كانت تُرفض؛ وُسِّع النمط |
| صيغة الأرقام: وحدة اللغة `ar` في Django تضبط `NUMBER_GROUPING=0` وفاصلة عشرية `,` فيظهر المبلغ `1500,00` | `FORMAT_MODULE_PATH = ['config.formats']` يضبط `1,500.00 ر.س` مع بقاء صيغ التواريخ العربية (`1 يونيو، 2025`) |
| `amount_to_arabic` يُنتج `'مليون و ألف'` لمليون، و`' ريال سعودي و...'` لمبلغ أقل من ريال | المجموعات الصفرية تُهمل، والمبلغ دون الريال يذكر الهللة فقط |

### إضافات

- `config/formats/ar/formats.py` — تجاوز صيغة الأرقام.
- `core/tests/` — 148 اختباراً.
- `core/management/commands/seed_demo.py` — بيانات تجريبية.
- `core/signals.py` — ملف شخصي تلقائي للمدير الأعلى.
- `utils.verify_event_chain()` — يتحقق من البصمة **ومن صحة الربط** بين الأحداث.
- `Dockerfile`: `HEALTHCHECK`، ومستخدم بلا صلاحيات، و`collectstatic` بلا إخفاء للأخطاء.
- `docker-compose.yml`: `DJANGO_SECRET_KEY` إلزامي (`:?`)، وحذف `version` المهجورة.
- `nginx.conf`: `http2 on;` بدل الصيغة المهجورة داخل `listen`.

---

## بنية النظام

```
المهمة (Task)  ──تجميع شهري──▶  المستخلص (Statement)  ──▶  بنود ثابتة (StatementLine)
                                     │
                                     └─▶ سجل أحداث (StatementEvent) — بصمات SHA-256 متسلسلة
```

- **اللقطة الثابتة**: بنود المستخلص نسخة مجمّدة؛ تغيير سعر البند لاحقاً لا يغيّر
  مستخلصاً صادراً.
- **القفل**: مهام الشهر المقفَل بمستخلص نشط لا تُعدَّل ولا تُحذف، والحذف المنطقي
  للمستخلص يحرّرها.
- **سلسلة البصمات**: كل حدث يحمل `previous_hash` للحدث السابق، فأي تعديل مباشر في
  قاعدة البيانات يظهر في صفحة التتبع وفي PDF.
- **الحذف المنطقي**: المستخلص لا يُحذف فيزيائياً؛ يُخفى عن القوائم ويظهر في التتبع
  مع من حذفه ومتى ولماذا. ورقم الإصدار يزيد عند إعادة التوليد (`-R2`).
- **فصل المهام**: المنشئ لا يراجع، والمراجع لا يعتمد.

## الملفات الخاصة

`private_media/` خارج مسار الملفات الثابتة ولا يُخدَم عبر الويب:
العقود PDF والنسخ الاحتياطية. nginx يرفض `/private_media/` صراحةً.

**صور التوقيعات تُخزَّن في قاعدة البيانات** (`UserProfile.signature_data`) لا على
القرص، لسببين:

1. بصمة الحدث يجب أن تحمل الصورة نفسها التي وُقّع بها الإجراء لحظة توقيعه، لا
   نسخة قد تُستبدل لاحقاً برفع جديد.
2. النشر serverless (Vercel) بلا قرص دائم؛ التخزين على القرص كان سيفقد التوقيعات
   عند كل إعادة تشغيل.

يُعاد معالجة الصورة المرفوعة بالكامل (PNG نظيف) قبل التخزين لإسقاط أي بيانات
مخفية مثل Exif، ويُرفض ما يتجاوز `MAX_SIGNATURE_BASE64_CHARS` بعد الترميز.

---

## النشر على Vercel (تجريبي)

ملفات النشر:

| الملف | الوظيفة |
|-------|---------|
| `api/index.py` | نقطة الدخول: يعرّض تطبيق WSGI باسم `app` |
| `vercel.json` | إعادة كتابة كل المسارات إلى الدالة + أوامر البناء |
| `requirements-vercel.txt` | الاعتماديات بلا WeasyPrint |

متغيرات البيئة المطلوبة:

```
DJANGO_SECRET_KEY      مفتاح عشوائي ≥ 50 حرفاً
DATABASE_URL           postgresql://user:pass@host:5432/db
DJANGO_DEBUG           0
DJANGO_ALLOWED_HOSTS   .vercel.app
CSRF_TRUSTED_ORIGINS   https://*.vercel.app
DJANGO_STATIC_STORAGE  django.contrib.staticfiles.storage.StaticFilesStorage
STATIC_ROOT            public/static
MEDIA_ROOT             /tmp/media
PRIVATE_MEDIA_ROOT     /tmp/private_media
```

أمر البناء ينفّذ `collectstatic` ثم `migrate` ثم `setup_roles` ثم `seed_demo`،
فلا حاجة لأي خطوة يدوية بعد النشر.

### قيود النشر serverless (مهمة)

- **تصدير PDF غير متاح**: WeasyPrint يحتاج `libpango` وهي غير موجودة على Vercel.
  النظام يعرض رسالة عربية واضحة بدل أن ينكسر. **في نشر Docker الداخلي يعمل PDF
  كاملاً** لأن `Dockerfile` يثبّت مكتبات النظام.
- **مرفقات العقود مؤقتة**: `/tmp` يُمسح عند إعادة تشغيل النسخة. التوقيعات لا
  تتأثر لأنها في قاعدة البيانات.
- **الحماية من الإغلاق (Axes) تعمل بشكل سليم عبر النسخ**: المعالج الافتراضي هو
  `AxesDatabaseHandler` (تحقّق فعلي: `AXES_HANDLER =
  axes.handlers.database.AxesDatabaseHandler`)، أي أن المحاولات الفاشلة تُخزَّن في
  جدول `axes_accessattempt` في قاعدة البيانات لا في ذاكرة النسخة، فيُحسب العدّاد
  بصورة صحيحة مهما تعددت النسخ أو أعيد تشغيلها.
- `ALLOWED_HOSTS` يتبنى `*.vercel.app` كاملاً عند وجود متغير `VERCEL`. هذا مقبول
  للتجربة لأن كل نطاقات vercel.app تُخدم عبر HTTPS إلزامياً، لكن **يجب ضبطه
  صراحةً بالنطاق الداخلي النهائي** قبل الإنتاج.
