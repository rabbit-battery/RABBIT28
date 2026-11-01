خطوط PDF
═════════

تقرير PDF يستخدم حزمة الخطوط المثبّتة في النظام عبر fontconfig:

    font-family: 'Amiri', 'Noto Naskh Arabic', 'DejaVu Sans', serif;

صورة Dockerfile تثبّت الحزمة `fonts-amiri`، لذا لا حاجة لوضع ملف الخط هنا.

إن أردت تضمين الخط يدوياً (مثلاً عند التشغيل بدون Docker):
1. حمّل خط Amiri من https://github.com/aliftype/amiri
2. ضع `Amiri-Regular.ttf` و `Amiri-Bold.ttf` في هذا المجلد.
3. أضف قاعدة `@font-face` في `core/templates/core/statement_pdf.html` تشير إلى الملف
   عبر `{% static 'core/fonts/Amiri-Regular.ttf' %}`.
