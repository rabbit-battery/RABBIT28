import uuid
import hashlib
from decimal import Decimal

from django.conf import settings
from django.db import models
from django.core.validators import (
    MinValueValidator, MaxValueValidator, FileExtensionValidator
)
from django.core.exceptions import ValidationError

# ملاحظة: PermissionError دالة مدمجة في بايثون وليست في django.core.exceptions


# ═══════════════════════════════════════════
#  الملف الشخصي
# ═══════════════════════════════════════════
class UserProfile(models.Model):
    """ملف شخصي مرتبط بكل مستخدم"""

    SPECIALTY_CHOICES = [
        ('data_entry', 'مدخل بيانات'),
        ('accountant', 'محاسب'),
        ('branch_manager', 'مدير الفرع'),
        ('approver', 'معتمد المستخلص'),
        ('contract_manager', 'مدير العقود'),
    ]

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='profile'
    )
    specialty = models.CharField('التخصص', max_length=30, choices=SPECIALTY_CHOICES)
    employee_id = models.CharField('الرقم الوظيفي', max_length=20, unique=True)
    must_change_password = models.BooleanField('يجب تغيير كلمة المرور', default=True)
    signature_image = models.CharField(
        'مسار صورة التوقيع', max_length=255, blank=True
    )
    # صورة التوقيع مُخزّنة في قاعدة البيانات لا على القرص: النشر serverless
    # (Vercel) بلا قرص دائم، ولأن البصمة الرقمية للحدث تحتاج الصورة نفسها
    # التي وُقّع بها لحظة الإجراء — لا نسخة قد تُستبدل لاحقاً.
    signature_data = models.TextField('صورة التوقيع (base64)', blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = 'ملف شخصي'
        verbose_name_plural = 'ملفات شخصية'

    def __str__(self):
        return f"{self.user.get_full_name()} - {self.get_specialty_display()}"


# ═══════════════════════════════════════════
#  العقد
# ═══════════════════════════════════════════
def contract_upload_path(instance, filename):
    return f"contracts/{uuid.uuid4().hex}.pdf"


class Contract(models.Model):
    """عقد موحد مع الشركة السعودية للكهرباء"""

    contract_number = models.CharField('رقم العقد', max_length=50, unique=True)
    title = models.CharField('عنوان العقد', max_length=200)
    start_date = models.DateField('تاريخ البداية')
    end_date = models.DateField('تاريخ النهاية')
    pdf_file = models.FileField(
        'ملف العقد PDF',
        upload_to=contract_upload_path,
        blank=True,
        null=True,
        validators=[FileExtensionValidator(['pdf'])]
    )
    is_active = models.BooleanField('نشط', default=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT,
        verbose_name='أنشئ بواسطة'
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'عقد'
        verbose_name_plural = 'العقود'
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.contract_number} - {self.title}"

    def clean(self):
        if self.end_date < self.start_date:
            raise ValidationError('تاريخ النهاية يجب أن يكون بعد تاريخ البداية')
        if self.pdf_file:
            if self.pdf_file.size > settings.MAX_UPLOAD_SIZE_MB * 1024 * 1024:
                raise ValidationError(
                    f'حجم الملف يتجاوز الحد المسموح ({settings.MAX_UPLOAD_SIZE_MB} ميغابايت)'
                )
            header = self.pdf_file.read(5)
            self.pdf_file.seek(0)
            if not header.startswith(b'%PDF-'):
                raise ValidationError('الملف ليس PDF صالحاً')


# ═══════════════════════════════════════════
#  بنود الأسعار
# ═══════════════════════════════════════════
class PriceItem(models.Model):
    """بند تسعير في العقد"""

    contract = models.ForeignKey(
        Contract, on_delete=models.CASCADE,
        related_name='price_items', verbose_name='العقد'
    )
    code = models.CharField('كود البند', max_length=30)
    description = models.CharField('وصف البند', max_length=300)
    unit = models.CharField('الوحدة', max_length=30)
    unit_price = models.DecimalField(
        'سعر الوحدة', max_digits=12, decimal_places=2,
        validators=[MinValueValidator(Decimal('0.01'))]
    )
    is_active = models.BooleanField('نشط', default=True)

    class Meta:
        verbose_name = 'بند أسعار'
        verbose_name_plural = 'بنود الأسعار'
        constraints = [
            models.UniqueConstraint(
                fields=['contract', 'code'], name='unique_priceitem_code_per_contract'
            )
        ]
        ordering = ['code']

    def __str__(self):
        return f"{self.code} - {self.description}"


# ═══════════════════════════════════════════
#  الفنيون
# ═══════════════════════════════════════════
class Technician(models.Model):
    """فني يعمل على العقد"""

    employee_number = models.CharField('الرقم الوظيفي', max_length=20, unique=True)
    name = models.CharField('الاسم', max_length=100)
    specialty = models.CharField('التخصص', max_length=100)
    is_active = models.BooleanField('نشط', default=True)

    class Meta:
        verbose_name = 'فني'
        verbose_name_plural = 'الفنيون'
        ordering = ['name']

    def __str__(self):
        return f"{self.employee_number} - {self.name}"


# ═══════════════════════════════════════════
#  العطل الرسمية
# ═══════════════════════════════════════════
class Holiday(models.Model):
    """عطلة رسمية لحساب أيام العمل"""

    date = models.DateField('التاريخ', unique=True)
    name = models.CharField('المناسبة', max_length=100)

    class Meta:
        verbose_name = 'عطلة رسمية'
        verbose_name_plural = 'العطل الرسمية'
        ordering = ['date']

    def __str__(self):
        return f"{self.date} - {self.name}"


# ═══════════════════════════════════════════
#  المهام
# ═══════════════════════════════════════════
class Task(models.Model):
    """مهمة فني يومية"""

    contract = models.ForeignKey(
        Contract, on_delete=models.PROTECT,
        related_name='tasks', verbose_name='العقد'
    )
    technician = models.ForeignKey(
        Technician, on_delete=models.PROTECT,
        related_name='tasks', verbose_name='الفني'
    )
    price_item = models.ForeignKey(
        PriceItem, on_delete=models.PROTECT,
        related_name='tasks', verbose_name='البند'
    )
    task_date = models.DateField('تاريخ المهمة')
    quantity = models.DecimalField(
        'الكمية', max_digits=10, decimal_places=2,
        validators=[MinValueValidator(Decimal('0.01'))]
    )
    unit_price_snapshot = models.DecimalField(
        'سعر الوحدة (لحظة الإدخال)', max_digits=12, decimal_places=2
    )
    location = models.CharField('الموقع', max_length=200, blank=True)
    total_cost = models.DecimalField(
        'التكلفة الإجمالية', max_digits=14, decimal_places=2
    )
    is_locked = models.BooleanField('مقفل في مستخلص', default=False)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT,
        verbose_name='أدخل بواسطة'
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'مهمة'
        verbose_name_plural = 'المهام'
        ordering = ['-task_date', '-created_at']
        indexes = [
            models.Index(fields=['contract', 'task_date']),
            models.Index(fields=['task_date']),
        ]

    def __str__(self):
        return f"{self.technician} - {self.price_item.code} - {self.task_date}"

    def clean(self):
        if self.price_item_id and self.contract_id and self.price_item.contract_id != self.contract_id:
            raise ValidationError('البند لا يتبع العقد المحدد')

    def save(self, *args, **kwargs):
        if not self.unit_price_snapshot:
            self.unit_price_snapshot = self.price_item.unit_price
        self.total_cost = (self.quantity * self.unit_price_snapshot).quantize(Decimal('0.01'))
        super().save(*args, **kwargs)


# ═══════════════════════════════════════════
#  المستخلص
# ═══════════════════════════════════════════
class ActiveStatementManager(models.Manager):
    """يعرض المستخلصات النشطة فقط"""

    def get_queryset(self):
        return super().get_queryset().filter(is_deleted=False)


class AllStatementManager(models.Manager):
    """يعرض جميع المستخلصات بما فيها المحذوفة"""


class Statement(models.Model):
    """مستخلص شهري"""

    STATUS_CHOICES = [
        ('draft', 'مسودة'),
        ('reviewed', 'تمت المراجعة'),
        ('approved', 'معتمد'),
        ('paid', 'تم الصرف'),
    ]

    statement_number = models.CharField('رقم المستخلص', max_length=30, unique=True)
    contract = models.ForeignKey(
        Contract, on_delete=models.PROTECT,
        related_name='statements', verbose_name='العقد'
    )
    year = models.PositiveIntegerField('السنة')
    month = models.PositiveIntegerField(
        'الشهر', validators=[MinValueValidator(1), MaxValueValidator(12)]
    )
    revision = models.PositiveIntegerField('رقم الإصدار', default=1)

    subtotal = models.DecimalField(
        'الإجمالي قبل الضريبة', max_digits=14, decimal_places=2, default=0
    )
    vat_amount = models.DecimalField(
        'ضريبة القيمة المضافة', max_digits=14, decimal_places=2, default=0
    )
    total_with_vat = models.DecimalField(
        'الإجمالي شامل الضريبة', max_digits=14, decimal_places=2, default=0
    )
    total_in_words = models.TextField('المبلغ بالحروف', blank=True)

    status = models.CharField('الحالة', max_length=20, choices=STATUS_CHOICES, default='draft')
    notes = models.TextField('ملاحظات', blank=True)

    # الأشخاص
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT,
        related_name='created_statements', verbose_name='أنشئ بواسطة'
    )
    reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT,
        null=True, blank=True,
        related_name='reviewed_statements', verbose_name='راجع بواسطة'
    )
    approved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT,
        null=True, blank=True,
        related_name='approved_statements', verbose_name='اعتمد بواسطة'
    )

    # الصرف
    po_number = models.CharField('رقم أمر الشراء', max_length=30, blank=True)
    paid_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT,
        null=True, blank=True,
        related_name='paid_statements', verbose_name='سجّل الصرف'
    )
    paid_at = models.DateTimeField('تاريخ الصرف', null=True, blank=True)

    # الحذف المنطقي
    is_deleted = models.BooleanField('محذوف', default=False)
    deleted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT,
        null=True, blank=True,
        related_name='deleted_statements', verbose_name='حذف بواسطة'
    )
    deleted_at = models.DateTimeField('تاريخ الحذف', null=True, blank=True)
    delete_reason = models.TextField('سبب الحذف', blank=True)

    reviewed_at = models.DateTimeField('تاريخ المراجعة', null=True, blank=True)
    approved_at = models.DateTimeField('تاريخ الاعتماد', null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    objects = ActiveStatementManager()
    all_objects = AllStatementManager()

    class Meta:
        verbose_name = 'مستخلص'
        verbose_name_plural = 'المستخلصات'
        ordering = ['-year', '-month']
        constraints = [
            models.UniqueConstraint(
                fields=['contract', 'year', 'month'],
                condition=models.Q(is_deleted=False),
                name='unique_active_statement'
            ),
            models.UniqueConstraint(
                fields=['contract', 'year', 'month', 'revision'],
                name='unique_statement_revision'
            ),
        ]

    def __str__(self):
        return self.statement_number

    @staticmethod
    def generate_number(contract, year, month, revision):
        num = f"ST-{year}{month:02d}-{contract.contract_number}"
        if revision > 1:
            num += f"-R{revision}"
        return num


# ═══════════════════════════════════════════
#  بنود المستخلص (لقطة ثابتة)
# ═══════════════════════════════════════════
class StatementLine(models.Model):
    """بند مستخلص - لقطة ثابتة مجمّعة"""

    statement = models.ForeignKey(
        Statement, on_delete=models.CASCADE,
        related_name='lines', verbose_name='المستخلص'
    )
    item_code = models.CharField('كود البند', max_length=30)
    item_description = models.CharField('وصف البند', max_length=300)
    unit = models.CharField('الوحدة', max_length=30)
    unit_price = models.DecimalField('سعر الوحدة', max_digits=12, decimal_places=2)
    total_quantity = models.DecimalField('الكمية الإجمالية', max_digits=12, decimal_places=2)
    line_total = models.DecimalField('إجمالي البند', max_digits=14, decimal_places=2)

    class Meta:
        verbose_name = 'بند مستخلص'
        verbose_name_plural = 'بنود المستخلص'
        ordering = ['item_code']

    def __str__(self):
        return f"{self.item_code} - {self.line_total}"


# ═══════════════════════════════════════════
#  سجل أحداث المستخلص (غير قابل للتعديل)
# ═══════════════════════════════════════════
GENESIS_HASH = "0" * 64


class StatementEvent(models.Model):
    """حدث في مسار المستخلص - لا يُعدّل ولا يُحذف"""

    EVENT_TYPES = [
        ('created', 'إنشاء'),
        ('edited', 'تعديل'),
        ('reviewed', 'مراجعة'),
        ('approved', 'اعتماد'),
        ('paid', 'صرف'),
        ('deleted', 'حذف'),
    ]

    statement = models.ForeignKey(
        Statement, on_delete=models.CASCADE,
        related_name='events', verbose_name='المستخلص'
    )
    event_type = models.CharField('نوع الحدث', max_length=20, choices=EVENT_TYPES)
    performed_by_name = models.CharField('اسم المنفذ', max_length=150)
    performed_by_role = models.CharField('دور المنفذ', max_length=50)
    performed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT,
        verbose_name='المنفذ'
    )
    details = models.TextField('التفاصيل', blank=True)
    signature_snapshot = models.TextField('صورة التوقيع (base64)', blank=True)
    previous_hash = models.CharField('بصمة الحدث السابق', max_length=64, default=GENESIS_HASH)
    event_hash = models.CharField('بصمة هذا الحدث', max_length=64, blank=True)
    timestamp = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = 'حدث مستخلص'
        verbose_name_plural = 'أحداث المستخلصات'
        ordering = ['timestamp', 'id']

    def __str__(self):
        return f"{self.statement} - {self.get_event_type_display()}"

    def compute_hash(self):
        """بصمة SHA-256 تغطي كل الحقول الجوهرية بما فيها صورة التوقيع."""
        data = (
            f"{self.statement_id}|{self.event_type}|{self.performed_by_name}|"
            f"{self.performed_by_role}|{self.details}|{self.signature_snapshot}|"
            f"{self.previous_hash}|"
            f"{self.timestamp.isoformat() if self.timestamp else ''}"
        )
        return hashlib.sha256(data.encode('utf-8')).hexdigest()

    def save(self, *args, **kwargs):
        if self.pk:
            raise PermissionError("لا يمكن تعديل سجل الأحداث")
        if not self.previous_hash or self.previous_hash == GENESIS_HASH:
            last = StatementEvent.objects.filter(
                statement=self.statement
            ).order_by('-timestamp', '-id').first()
            self.previous_hash = last.event_hash if last else GENESIS_HASH
        super().save(*args, **kwargs)
        # الطابع الزمني يُملأ تلقائياً عند الحفظ، لذا تُحسب البصمة بعده مباشرة
        self.event_hash = self.compute_hash()
        StatementEvent.objects.filter(pk=self.pk).update(event_hash=self.event_hash)

    def delete(self, *args, **kwargs):
        raise PermissionError("لا يمكن حذف سجل الأحداث")

    def verify_chain(self):
        """التحقق من سلامة البصمة لهذا الحدث"""
        return bool(self.event_hash) and self.compute_hash() == self.event_hash


# ═══════════════════════════════════════════
#  سجل التدقيق العام
# ═══════════════════════════════════════════
class AuditLog(models.Model):
    """سجل تدقيق عام"""

    ACTION_CHOICES = [
        ('login', 'تسجيل دخول'),
        ('logout', 'تسجيل خروج'),
        ('download', 'تحميل ملف'),
        ('export_pdf', 'تصدير PDF'),
        ('export_excel', 'تصدير Excel'),
        ('user_created', 'إنشاء مستخدم'),
        ('user_edited', 'تعديل مستخدم'),
        ('password_reset', 'إعادة تعيين كلمة مرور'),
        ('track_search', 'بحث في التتبع'),
        ('upload', 'رفع ملف'),
        ('import_tasks', 'استيراد مهام'),
    ]

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT,
        null=True, blank=True, verbose_name='المستخدم'
    )
    action = models.CharField('الإجراء', max_length=30, choices=ACTION_CHOICES)
    details = models.TextField('التفاصيل', blank=True)
    ip_address = models.GenericIPAddressField('عنوان IP', null=True, blank=True)
    timestamp = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = 'سجل تدقيق'
        verbose_name_plural = 'سجلات التدقيق'
        ordering = ['-timestamp']

    def __str__(self):
        return f"{self.user} - {self.get_action_display()} - {self.timestamp}"
