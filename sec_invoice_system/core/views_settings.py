"""شاشات الإدارة الفنية: إعدادات المظهر وهيكل العمل."""

import logging

from django import forms
from django.contrib import messages
from django.contrib.auth.decorators import login_required
from django.shortcuts import render, redirect

from .decorators import role_required
from .models import SiteSettings
from .utils import log_audit

logger = logging.getLogger(__name__)


class SiteSettingsForm(forms.ModelForm):
    class Meta:
        model = SiteSettings
        fields = ['site_name', 'org_name', 'primary_color', 'accent_color',
                  'theme', 'nav_order', 'show_forecast']
        widgets = {
            'primary_color': forms.TextInput(attrs={'type': 'color'}),
            'accent_color': forms.TextInput(attrs={'type': 'color'}),
            'nav_order': forms.Textarea(attrs={'rows': 2}),
        }

    def clean_site_name(self):
        value = (self.cleaned_data.get('site_name') or '').strip()
        if len(value) < 3:
            raise forms.ValidationError('اسم النظام قصير جداً')
        return value


@login_required
@role_required('technical_admin')
def site_settings_view(request):
    """
    تعديل اسم النظام والجهة والألوان ونمط التصميم وترتيب القائمة.

    محصور بدور «إدارة فنية». التغيير يُسجَّل في سجل التدقيق مع اسم من أجراه،
    لأنه يعدّل ما يراه كل المستخدمين.
    """
    site = SiteSettings.load()

    if request.method == 'POST':
        form = SiteSettingsForm(request.POST, instance=site)
        if form.is_valid():
            obj = form.save(commit=False)
            obj.updated_by = request.user
            obj.save()
            log_audit(request, 'settings_updated',
                      f'تعديل إعدادات الموقع: {obj.site_name} / نمط {obj.theme}')
            messages.success(request, 'تم حفظ الإعدادات وطُبّقت فوراً')
            return redirect('site_settings')
        messages.error(request, 'تحقق من الحقول المميزة بالأحمر')
    else:
        form = SiteSettingsForm(instance=site)

    return render(request, 'core/site_settings.html', {
        'form': form,
        'site': site,
        'nav_preview': site.nav_keys(),
        'nav_labels': SiteSettings.NAV_KEYS,
    })
