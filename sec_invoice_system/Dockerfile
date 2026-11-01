FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

# المكتبات النظامية لـ WeasyPrint
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libpangoft2-1.0-0 \
    libgdk-pixbuf-2.0-0 \
    libffi8 \
    shared-mime-info \
    fonts-amiri \
    libpq5 \
    postgresql-client \
    && rm -rf /var/lib/apt/lists/*

# مستخدم غير جذري
RUN groupadd -r appuser && useradd -r -g appuser -d /app -s /sbin/nologin appuser

WORKDIR /app

# المتطلبات (طبقة مستقلة لتسريع البناء)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# الكود
COPY . .

# المجلدات المطلوبة قبل جمع الملفات الثابتة
RUN mkdir -p /app/private_media/contracts \
             /app/private_media/signatures \
             /app/private_media/backups \
             /app/staticfiles

# الملفات الثابتة
RUN python manage.py collectstatic --noinput

RUN chown -R appuser:appuser /app

USER appuser

EXPOSE 8000

# /health/ تنفّذ استعلاماً حقيقياً على قاعدة البيانات، فتُظهر فشل الاتصال
# بدل أن يمرّ الفحص كاذباً كما كان يحدث مع /login/ التي تُرسم دون لمس القاعدة.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health/', timeout=4).status == 200 else 1)"

CMD ["gunicorn", "config.wsgi:application", \
     "--bind", "0.0.0.0:8000", \
     "--workers", "3", \
     "--timeout", "120"]
