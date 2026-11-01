"""أدوات مساعدة"""

import os
import io
import base64
import uuid
import calendar
import logging
from datetime import date, timedelta
from decimal import Decimal

from django.conf import settings
from django.utils import timezone

from PIL import Image

from .models import Holiday

logger = logging.getLogger(__name__)


def get_working_days(start_date, end_date):
    """حساب أيام العمل بين تاريخين باستثناء الجمعة والسبت والعطل"""
    if end_date < start_date:
        return 0

    holidays = set(
        Holiday.objects.filter(
            date__range=[start_date, end_date]
        ).values_list('date', flat=True)
    )

    count = 0
    current = start_date
    while current <= end_date:
        # الجمعة = 4, السبت = 5
        if current.weekday() not in (4, 5) and current not in holidays:
            count += 1
        current += timedelta(days=1)
    return count


def get_remaining_working_days(from_date=None):
    """أيام العمل المتبقية في الشهر الحالي"""
    if from_date is None:
        from_date = timezone.localdate()
    last_day = date(
        from_date.year, from_date.month,
        calendar.monthrange(from_date.year, from_date.month)[1]
    )
    if from_date >= last_day:
        return 0
    return get_working_days(from_date + timedelta(days=1), last_day)


def forecast_monthly(accumulated, elapsed_working_days, remaining_working_days):
    """التنبؤ بتكلفة نهاية الفترة على أساس متوسط يوم العمل"""
    accumulated = Decimal(str(accumulated))
    if elapsed_working_days == 0:
        return accumulated
    daily_avg = accumulated / Decimal(str(elapsed_working_days))
    return (accumulated + daily_avg * Decimal(str(remaining_working_days))).quantize(
        Decimal('0.01')
    )


def vat_rate_factor():
    """معامل ضريبة القيمة المضافة من الإعدادات"""
    return Decimal(str(settings.VAT_RATE)) / Decimal('100')


def get_client_ip(request):
    """استخراج IP العميل"""
    x_forwarded = request.META.get('HTTP_X_FORWARDED_FOR')
    if x_forwarded:
        return x_forwarded.split(',')[0].strip()
    return request.META.get('REMOTE_ADDR')


def log_audit(request, action, details=''):
    """تسجيل حدث في سجل التدقيق"""
    from .models import AuditLog
    AuditLog.objects.create(
        user=request.user if request.user.is_authenticated else None,
        action=action,
        details=details,
        ip_address=get_client_ip(request),
    )


def create_statement_event(statement, event_type, user, details=''):
    """إنشاء حدث في سجل المستخلص مع لقطة من توقيع المنفذ"""
    from .models import StatementEvent

    # اللقطة تُقرأ من قاعدة البيانات لا من القرص: النشر serverless بلا قرص
    # دائم، ولأن البصمة يجب أن تحمل الصورة نفسها التي وُقّع بها الإجراء.
    signature_b64 = ''
    try:
        signature_b64 = user.profile.signature_data or ''
    except Exception:  # noqa: BLE001 - غياب التوقيع لا يجب أن يوقف الإجراء
        pass

    role = ''
    try:
        role = user.profile.get_specialty_display()
    except Exception:  # noqa: BLE001
        pass

    event = StatementEvent(
        statement=statement,
        event_type=event_type,
        performed_by=user,
        performed_by_name=user.get_full_name() or user.username,
        performed_by_role=role,
        details=details,
        signature_snapshot=signature_b64,
    )
    event.save()
    return event


def verify_event_chain(statement):
    """التحقق من سلامة سلسلة أحداث مستخلص: كل بصمة وكل رابط بالسابق"""
    events = list(statement.events.all())
    expected_previous = None
    for event in events:
        if not event.verify_chain():
            return False
        if expected_previous is not None and event.previous_hash != expected_previous:
            return False
        expected_previous = event.event_hash
    return True


def process_signature_upload(uploaded_file, user):
    """
    معالجة صورة التوقيع وحفظها بأمان.

    تُعاد معالجتها بالكامل (لا يُخزَّن الملف المرفوع كما هو) لإسقاط أي
    بيانات مخفية مثل Exif أو نصوص مضمّنة، ثم تُخزَّن PNG في قاعدة البيانات.
    التخزين في القاعدة لا على القرص لأن النشر serverless بلا قرص دائم.
    """
    if uploaded_file.size > settings.MAX_SIGNATURE_SIZE_MB * 1024 * 1024:
        raise ValueError(f'حجم الصورة يتجاوز {settings.MAX_SIGNATURE_SIZE_MB} ميغابايت')

    img = Image.open(uploaded_file)
    if img.format not in ('PNG', 'JPEG', 'JPG'):
        raise ValueError('صيغة الصورة غير مدعومة. استخدم PNG أو JPEG')

    clean_img = Image.new('RGBA', img.size, (255, 255, 255, 0))
    clean_img.paste(img)

    buffer = io.BytesIO()
    clean_img.save(buffer, format='PNG')
    encoded = base64.b64encode(buffer.getvalue()).decode('ascii')

    # حد أعلى حتى لا تتضخّم قاعدة البيانات بصورة كبيرة
    if len(encoded) > settings.MAX_SIGNATURE_BASE64_CHARS:
        raise ValueError('الصورة كبيرة جداً بعد المعالجة. استخدم صورة أصغر')

    user.profile.signature_data = encoded
    user.profile.signature_image = f"signature_{uuid.uuid4().hex[:8]}.png"
    user.profile.save()
    return user.profile.signature_image


def sanitize_excel_value(value):
    """حماية من حقن الصيغ في Excel"""
    if isinstance(value, str):
        if value and value[0] in ('=', '+', '-', '@', '\t', '\r'):
            return f"'{value}"
    return value


def build_statement_pdf_html(statement):
    """
    توليد HTML المستخلص الجاهز للتحويل إلى PDF.
    دالة مستقلة حتى تُستخدم من العرض ومن الاختبارات على حد سواء.
    """
    from django.template.loader import render_to_string

    events = list(statement.events.all())
    return render_to_string('core/statement_pdf.html', {
        'statement': statement,
        'lines': list(statement.lines.all()),
        'events_with_sig': [
            {'event': event, 'signature_b64': event.signature_snapshot or ''}
            for event in events
        ],
        'chain_valid': verify_event_chain(statement),
        'is_draft': statement.status == 'draft',
        'vat_rate': settings.VAT_RATE,
    })
