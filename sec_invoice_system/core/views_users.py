import secrets
import string

from django.shortcuts import render, redirect, get_object_or_404
from django.contrib.auth.decorators import login_required
from django.contrib.auth.models import User, Group
from django.contrib import messages
from django.db import IntegrityError

from .models import UserProfile
from .forms import UserCreateForm, UserEditForm, SignatureUploadForm
from .utils import log_audit, process_signature_upload
from .decorators import role_required

SPECIALTY_GROUP_MAP = {
    'data_entry': 'مدخل بيانات',
    'accountant': 'محاسب',
    'branch_manager': 'مدير الفرع',
    'approver': 'معتمد المستخلص',
}


def generate_temp_password():
    """توليد كلمة مرور مؤقتة قوية"""
    alphabet = string.ascii_letters + string.digits + "!@#$%"
    return ''.join(secrets.choice(alphabet) for _ in range(14))


@login_required
@role_required('contract_manager')
def user_list(request):
    users = User.objects.filter(is_superuser=False).select_related('profile')
    return render(request, 'core/users.html', {'users': users})


@login_required
@role_required('contract_manager')
def user_create(request):
    if request.method == 'POST':
        form = UserCreateForm(request.POST)
        if form.is_valid():
            username = form.cleaned_data['username']
            employee_id = form.cleaned_data['employee_id']

            if User.objects.filter(username=username).exists():
                messages.error(request, 'اسم المستخدم موجود مسبقاً')
                return redirect('user_create')
            if UserProfile.objects.filter(employee_id=employee_id).exists():
                messages.error(request, 'الرقم الوظيفي مستخدم مسبقاً')
                return redirect('user_create')

            temp_password = generate_temp_password()

            user = User.objects.create_user(
                username=username,
                password=temp_password,
                first_name=form.cleaned_data['first_name'],
                last_name=form.cleaned_data['last_name'],
                email=form.cleaned_data['email'],
            )

            UserProfile.objects.create(
                user=user,
                specialty=form.cleaned_data['specialty'],
                employee_id=employee_id,
                must_change_password=True,
            )

            group_name = SPECIALTY_GROUP_MAP.get(form.cleaned_data['specialty'])
            if group_name:
                group = Group.objects.filter(name=group_name).first()
                if group:
                    user.groups.add(group)

            log_audit(request, 'user_created',
                      f'إنشاء مستخدم: {username} ({form.cleaned_data["specialty"]})')

            messages.success(
                request,
                f'تم إنشاء المستخدم {username}. كلمة المرور المؤقتة: {temp_password}'
            )
            return redirect('users')
    else:
        form = UserCreateForm()

    return render(request, 'core/user_form.html', {'form': form, 'creating': True})


@login_required
@role_required('contract_manager')
def user_edit(request, pk):
    user = get_object_or_404(User, pk=pk)

    if user.is_superuser or user == request.user:
        messages.error(request, 'لا يمكنك تعديل هذا المستخدم')
        return redirect('users')

    if request.method == 'POST':
        form = UserEditForm(request.POST)
        if form.is_valid():
            employee_id = form.cleaned_data['employee_id']
            clash = UserProfile.objects.filter(employee_id=employee_id).exclude(user=user)
            if clash.exists():
                messages.error(request, 'الرقم الوظيفي مستخدم مسبقاً')
                return redirect('user_edit', pk=pk)

            user.first_name = form.cleaned_data['first_name']
            user.last_name = form.cleaned_data['last_name']
            user.email = form.cleaned_data['email']
            user.save()

            profile = user.profile
            profile.specialty = form.cleaned_data['specialty']
            profile.employee_id = employee_id
            profile.save()

            group_name = SPECIALTY_GROUP_MAP.get(form.cleaned_data['specialty'])
            if group_name:
                group = Group.objects.filter(name=group_name).first()
                if group:
                    user.groups.set([group])

            log_audit(request, 'user_edited', f'تعديل مستخدم: {user.username}')
            messages.success(request, 'تم تحديث بيانات المستخدم')
            return redirect('users')
    else:
        initial = {
            'username': user.username,
            'first_name': user.first_name,
            'last_name': user.last_name,
            'email': user.email,
            'specialty': user.profile.specialty,
            'employee_id': user.profile.employee_id,
        }
        form = UserEditForm(initial=initial)

    return render(request, 'core/user_form.html', {
        'form': form, 'editing': True, 'target_user': user
    })


@login_required
@role_required('contract_manager')
def user_reset_password(request, pk):
    user = get_object_or_404(User, pk=pk)

    if user.is_superuser or user == request.user:
        messages.error(request, 'لا يمكنك إعادة تعيين كلمة مرور هذا المستخدم')
        return redirect('users')

    if request.method == 'POST':
        temp_password = generate_temp_password()
        user.set_password(temp_password)
        user.save()

        try:
            user.profile.must_change_password = True
            user.profile.save()
        except Exception:  # noqa: BLE001
            pass

        log_audit(request, 'password_reset', f'إعادة تعيين كلمة مرور: {user.username}')
        messages.success(
            request, f'كلمة المرور الجديدة لـ {user.username}: {temp_password}'
        )

    return redirect('users')


@login_required
def signature_upload(request):
    """رفع صورة التوقيع"""
    if request.method == 'POST':
        form = SignatureUploadForm(request.POST, request.FILES)
        if form.is_valid():
            try:
                process_signature_upload(form.cleaned_data['signature'], request.user)
                messages.success(request, 'تم رفع صورة التوقيع')
            except ValueError as exc:
                messages.error(request, str(exc))
            except IntegrityError:
                messages.error(request, 'تعذّر حفظ التوقيع: لا يوجد ملف شخصي لهذا الحساب')
            return redirect('signature_upload')
    else:
        form = SignatureUploadForm()

    has_signature = False
    signature_b64 = ''
    try:
        signature_b64 = request.user.profile.signature_data or ''
        has_signature = bool(signature_b64)
    except Exception:  # noqa: BLE001
        pass

    return render(request, 'core/profile_signature.html', {
        'form': form, 'has_signature': has_signature,
        'signature_b64': signature_b64,
    })
