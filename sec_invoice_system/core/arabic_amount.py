"""تحويل المبلغ الرقمي إلى نص عربي"""

from decimal import Decimal, ROUND_HALF_UP

ONES = [
    '', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة',
    'ستة', 'سبعة', 'ثمانية', 'تسعة', 'عشرة',
    'أحد عشر', 'اثنا عشر', 'ثلاثة عشر', 'أربعة عشر', 'خمسة عشر',
    'ستة عشر', 'سبعة عشر', 'ثمانية عشر', 'تسعة عشر'
]

TENS = [
    '', '', 'عشرون', 'ثلاثون', 'أربعون', 'خمسون',
    'ستون', 'سبعون', 'ثمانون', 'تسعون'
]

HUNDREDS = [
    '', 'مائة', 'مئتان', 'ثلاثمائة', 'أربعمائة', 'خمسمائة',
    'ستمائة', 'سبعمائة', 'ثمانمائة', 'تسعمائة'
]

SCALES = ['', 'ألف', 'مليون', 'مليار']


def _three_digits(n):
    """تحويل رقم من 0 إلى 999 إلى نص"""
    if n == 0:
        return ''

    parts = []
    h = n // 100
    remainder = n % 100

    if h > 0:
        parts.append(HUNDREDS[h])

    if remainder > 0:
        if remainder < 20:
            parts.append(ONES[remainder])
        else:
            t = remainder // 10
            o = remainder % 10
            if o > 0:
                parts.append(f"{ONES[o]} و{TENS[t]}")
            else:
                parts.append(TENS[t])

    return ' و'.join(parts)


def _scale_word(group, index):
    """صياغة اسم المجموعة (ألف/مليون/مليار) مع المثنى والجمع"""
    if group == 0:
        return ''
    if index == 0:
        return _three_digits(group)

    scale = SCALES[index] if index < len(SCALES) else SCALES[-1]
    dual = {'ألف': 'ألفان', 'مليون': 'مليونان', 'مليار': 'ملياران'}[scale]
    plural = {'ألف': 'آلاف', 'مليون': 'ملايين', 'مليار': 'مليارات'}[scale]

    if group == 1:
        return scale
    if group == 2:
        return dual
    if 3 <= group <= 10:
        return f"{_three_digits(group)} {plural}"
    return f"{_three_digits(group)} {scale}"


def amount_to_arabic(amount):
    """تحويل مبلغ إلى نص عربي بالريال والهللة"""
    amount = Decimal(str(amount))

    if amount < 0:
        return 'سالب ' + amount_to_arabic(-amount)

    riyals = int(amount)
    halalas = int(((amount - riyals) * 100).quantize(Decimal('1'), rounding=ROUND_HALF_UP))

    if riyals == 0 and halalas == 0:
        return 'صفر ريال سعودي'

    # تقسيم إلى مجموعات ثلاثية
    groups = []
    temp = riyals
    while temp > 0:
        groups.append(temp % 1000)
        temp //= 1000

    parts = [_scale_word(group, i) for i, group in enumerate(groups)]
    parts.reverse()
    parts = [p for p in parts if p]

    if riyals > 0:
        result = ' و'.join(parts) + ' ريال سعودي'
        if halalas > 0:
            result += f" و{_three_digits(halalas)} هللة"
    else:
        # مبلغ أقل من ريال: تُذكر الهللة وحدها بلا «ريال سعودي» فارغة
        result = f"{_three_digits(halalas)} هللة"

    return result
