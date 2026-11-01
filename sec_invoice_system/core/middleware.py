from django.shortcuts import redirect


class ForcePasswordChangeMiddleware:
    """إجبار المستخدم على تغيير كلمة المرور المؤقتة"""

    EXEMPT_URLS = [
        '/password/change/',
        '/logout/',
        '/static/',
        '/secure-admin-x7k/',
        '/health/',
    ]

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if request.user.is_authenticated:
            try:
                profile = request.user.profile
                if profile.must_change_password:
                    path = request.path
                    if not any(path.startswith(url) for url in self.EXEMPT_URLS):
                        return redirect('password_change')
            except Exception:  # noqa: BLE001 - حساب بلا ملف شخصي (مدير أعلى قديم)
                pass
        return self.get_response(request)


class Force2FAMiddleware:
    """إجبار الأدوار الحساسة على تفعيل المصادقة الثنائية"""

    SENSITIVE_SPECIALTIES = ['accountant', 'branch_manager', 'approver', 'contract_manager']

    EXEMPT_URLS = [
        '/2fa/',
        '/logout/',
        '/password/change/',
        '/static/',
        '/secure-admin-x7k/',
        '/health/',
    ]

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if request.user.is_authenticated:
            try:
                profile = request.user.profile
                needs_2fa = (
                    profile.specialty in self.SENSITIVE_SPECIALTIES
                    and not profile.must_change_password
                )
                if needs_2fa and not request.user.is_verified():
                    if not any(request.path.startswith(u) for u in self.EXEMPT_URLS):
                        return redirect('setup_2fa')
            except Exception:  # noqa: BLE001
                pass
        return self.get_response(request)
