"""
نقطة دخول Vercel Serverless.

Vercel يشغّل كل ملف داخل api/ كدالة serverless مستقلة. نعرض هنا تطبيق WSGI
كامل (Django) باسم `app` فيوجّه vercel.json كل الطلبات إليه.

ملاحظة: البيئة serverless بلا حالة دائمة ولا قرص قابل للكتابة عدا /tmp،
لذلك:
  - قاعدة البيانات خارجية (Postgres/Supabase) وليست SQLite.
  - صور التوقيع محفوظة في قاعدة البيانات لا في private_media/.
  - تصدير PDF يعتذر برسالة واضحة لأن مكتبات pango غير متوفرة هنا.
"""

import os
import sys

# Vercel يشغّل الملف من جذر المشروع، لكن نضمن أن حزمة config قابلة للاستيراد
# مهما كان مجلد العمل الفعلي.
_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _PROJECT_ROOT not in sys.path:
    sys.path.insert(0, _PROJECT_ROOT)

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')

from config.wsgi import application  # noqa: E402

# Vercel يبحث عن كائن WSGI بهذا الاسم
app = application
