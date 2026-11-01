from django import forms
from django.core.validators import RegexValidator

from .models import Contract, PriceItem, Technician, Task, Holiday


class ContractForm(forms.ModelForm):
    class Meta:
        model = Contract
        fields = ['contract_number', 'title', 'start_date', 'end_date', 'pdf_file']
        widgets = {
            'start_date': forms.DateInput(attrs={'type': 'date'}),
            'end_date': forms.DateInput(attrs={'type': 'date'}),
        }


class PriceItemForm(forms.ModelForm):
    class Meta:
        model = PriceItem
        fields = ['code', 'description', 'unit', 'unit_price']


class TechnicianForm(forms.ModelForm):
    class Meta:
        model = Technician
        fields = ['employee_number', 'name', 'specialty', 'is_active']


class HolidayForm(forms.ModelForm):
    class Meta:
        model = Holiday
        fields = ['date', 'name']
        widgets = {
            'date': forms.DateInput(attrs={'type': 'date'}),
        }


class TaskForm(forms.ModelForm):
    class Meta:
        model = Task
        fields = ['contract', 'technician', 'price_item', 'task_date', 'quantity', 'location']
        widgets = {
            'task_date': forms.DateInput(attrs={'type': 'date'}),
        }


class TaskImportForm(forms.Form):
    contract = forms.ModelChoiceField(
        queryset=Contract.objects.filter(is_active=True),
        label='العقد'
    )
    excel_file = forms.FileField(
        label='ملف Excel (.xlsx)',
        help_text='الحد الأقصى 5 ميغابايت و5000 سطر'
    )


class GenerateStatementForm(forms.Form):
    contract = forms.ModelChoiceField(
        queryset=Contract.objects.filter(is_active=True),
        label='العقد'
    )
    year = forms.IntegerField(label='السنة', min_value=2020, max_value=2050)
    month = forms.IntegerField(label='الشهر', min_value=1, max_value=12)


class StatementNotesForm(forms.Form):
    notes = forms.CharField(
        widget=forms.Textarea(attrs={'rows': 3}),
        label='ملاحظات',
        required=False
    )


class POForm(forms.Form):
    po_number = forms.CharField(
        label='رقم أمر الشراء',
        min_length=4,
        max_length=30,
        validators=[
            RegexValidator(
                regex=r'^[A-Za-z0-9\-/]{4,30}$',
                message='رقم أمر الشراء يقبل أحرف لاتينية وأرقام و- و/ فقط'
            )
        ]
    )


class DeleteStatementForm(forms.Form):
    reason = forms.CharField(
        widget=forms.Textarea(attrs={'rows': 3}),
        label='سبب الحذف',
        min_length=10,
    )


class TrackStatementForm(forms.Form):
    # رقم المستخلص: ST-YYYYMM-<رقم العقد>[-Rn]
    statement_number = forms.CharField(
        label='رقم المستخلص',
        max_length=40,
        validators=[
            RegexValidator(
                regex=r'^ST-\d{6}-[\w\-/.]+(?:-R\d+)?$',
                message='صيغة رقم المستخلص غير صحيحة (مثال: ST-202506-101)'
            )
        ]
    )


class UserCreateForm(forms.Form):
    # technical_admin مستثنى عن قصد: دوره محمي ولا يُنشأ إلا من سطر الأوامر
    # عبر manage.py setup_technical_admin، حتى لا يرقّي أحد نفسه إليه.
    SPECIALTY_CHOICES = [
        ('data_entry', 'مدخل بيانات'),
        ('accountant', 'محاسب'),
        ('branch_manager', 'مدير الفرع'),
        ('approver', 'معتمد المستخلص'),
        ('contract_manager', 'مدير العقود'),
    ]

    username = forms.CharField(label='اسم المستخدم', max_length=150)
    first_name = forms.CharField(label='الاسم الأول', max_length=30)
    last_name = forms.CharField(label='الاسم الأخير', max_length=30)
    email = forms.EmailField(label='البريد الإلكتروني')
    employee_id = forms.CharField(label='الرقم الوظيفي', max_length=20)
    specialty = forms.ChoiceField(label='التخصص', choices=SPECIALTY_CHOICES)


class UserEditForm(UserCreateForm):
    """نفس حقول الإنشاء لكن اسم المستخدم للقراءة فقط أثناء التعديل"""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields['username'].widget.attrs['readonly'] = True


class SignatureUploadForm(forms.Form):
    signature = forms.ImageField(label='صورة التوقيع/الختم')


class PasswordChangeForm(forms.Form):
    old_password = forms.CharField(
        widget=forms.PasswordInput, label='كلمة المرور الحالية'
    )
    new_password = forms.CharField(
        widget=forms.PasswordInput, label='كلمة المرور الجديدة',
        min_length=12
    )
    confirm_password = forms.CharField(
        widget=forms.PasswordInput, label='تأكيد كلمة المرور'
    )

    def clean(self):
        cleaned = super().clean()
        if cleaned.get('new_password') != cleaned.get('confirm_password'):
            raise forms.ValidationError('كلمتا المرور غير متطابقتين')
        return cleaned
