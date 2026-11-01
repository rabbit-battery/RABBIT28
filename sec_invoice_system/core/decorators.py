from functools import wraps

from django.shortcuts import redirect
from django.core.exceptions import ObjectDoesNotExist, PermissionDenied


def role_required(*specialties):
    """تقييد الوصول حسب التخصص (المدير الأعلى يمر دائماً)"""
    def decorator(view_func):
        @wraps(view_func)
        def wrapper(request, *args, **kwargs):
            if not request.user.is_authenticated:
                return redirect('login')
            if request.user.is_superuser:
                return view_func(request, *args, **kwargs)
            try:
                specialty = request.user.profile.specialty
            except ObjectDoesNotExist:
                raise PermissionDenied('الملف الشخصي غير موجود')
            if specialty not in specialties:
                raise PermissionDenied('ليس لديك صلاحية الوصول')
            return view_func(request, *args, **kwargs)
        return wrapper
    return decorator
