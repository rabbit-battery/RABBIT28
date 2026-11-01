"""مصانع بيانات مشتركة للاختبارات"""

from datetime import date
from decimal import Decimal

from django.contrib.auth.models import User
from django_otp import DEVICE_ID_SESSION_KEY
from django_otp.plugins.otp_totp.models import TOTPDevice

from core.models import Contract, PriceItem, Technician, Task, UserProfile

PASSWORD = 'Str0ng-Passw0rd!2025'

_seq = {'n': 0}


def _next():
    _seq['n'] += 1
    return _seq['n']


def make_user(specialty='data_entry', must_change_password=False, username=None):
    n = _next()
    username = username or f"{specialty}_{n}"
    user = User.objects.create_user(
        username=username,
        password=PASSWORD,
        first_name=f'اسم{n}',
        last_name=f'عائلة{n}',
        email=f'{username}@example.com',
    )
    UserProfile.objects.create(
        user=user,
        specialty=specialty,
        employee_id=f'EMP{n:05d}',
        must_change_password=must_change_password,
    )
    return user


def mark_otp_verified(client, user):
    """
    وضع الجلسة في حالة «موثّقة ثنائياً» كما يفعل django_otp.login تماماً،
    حتى لا تحوّل Force2FAMiddleware طلبات الاختبار إلى /2fa/setup/.
    (التدفق الحقيقي عبر HTTP مُختبَر في test_security.py)
    """
    device = TOTPDevice.objects.filter(user=user, confirmed=True).first()
    if device is None:
        device = TOTPDevice.objects.create(user=user, name='default', confirmed=True)
    session = client.session
    session[DEVICE_ID_SESSION_KEY] = device.persistent_id
    session.save()
    return device


def make_contract(created_by, contract_number=None):
    n = _next()
    return Contract.objects.create(
        contract_number=contract_number or f'CT-{1000 + n}',
        title=f'عقد تشغيل وصيانة {n}',
        start_date=date(2025, 1, 1),
        end_date=date(2025, 12, 31),
        created_by=created_by,
    )


def make_price_item(contract, code=None, unit_price='100.00'):
    n = _next()
    return PriceItem.objects.create(
        contract=contract,
        code=code or f'IT-{n:03d}',
        description=f'بند أعمال {n}',
        unit='وحدة',
        unit_price=Decimal(unit_price),
    )


def make_technician(employee_number=None):
    n = _next()
    return Technician.objects.create(
        employee_number=employee_number or f'T{n:05d}',
        name=f'فني {n}',
        specialty='كهرباء',
    )


def make_task(contract, technician, price_item, task_date, quantity, created_by):
    qty = Decimal(str(quantity))
    return Task.objects.create(
        contract=contract,
        technician=technician,
        price_item=price_item,
        task_date=task_date,
        quantity=qty,
        unit_price_snapshot=price_item.unit_price,
        total_cost=(qty * price_item.unit_price).quantize(Decimal('0.01')),
        created_by=created_by,
    )
