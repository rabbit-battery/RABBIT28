from django import template
from django.utils.formats import number_format

register = template.Library()


@register.filter
def currency(value):
    """تنسيق المبلغ بالريال"""
    try:
        return f"{number_format(value, 2)} ر.س"
    except (ValueError, TypeError):
        return value


@register.filter
def status_badge(status):
    """لون حالة المستخلص"""
    colors = {
        'draft': 'warning',
        'reviewed': 'info',
        'approved': 'success',
        'paid': 'primary',
    }
    return colors.get(status, 'secondary')


@register.filter
def status_arabic(status):
    """الحالة بالعربية"""
    names = {
        'draft': 'مسودة',
        'reviewed': 'تمت المراجعة',
        'approved': 'معتمد',
        'paid': 'تم الصرف',
    }
    return names.get(status, status)
