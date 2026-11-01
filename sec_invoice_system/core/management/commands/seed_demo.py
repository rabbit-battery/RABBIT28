"""
إنشاء بيانات تجريبية للتقييم والعرض.

    python manage.py seed_demo            # إنشاء/استكمال
    python manage.py seed_demo --wipe     # مسح ثم إنشاء من جديد

ينشئ مستخدمين لكل تخصص، عقداً ببنود أسعار، فنيين، عطلاً رسمية، ومهاماً
لثلاثة أشهر نسبةً إلى تاريخ اليوم:
  • الشهر الجاري: مهام حتى اليوم (تظهر في لوحة المتابعة والرسم البياني)
  • الشهر السابق: مستخلص مكتمل الدورة (تم الصرف)
  • الشهر قبله: مستخلص في حالة «تمت المراجعة»

الأمر idempotent: تشغيله مرتين لا يضاعف البيانات.
"""

import random
from datetime import date, timedelta
from decimal import Decimal

from django.core.management.base import BaseCommand
from django.contrib.auth.models import User
from django.db import transaction
from django.db.models import Sum
from django.utils import timezone

from core.models import (
    UserProfile, Contract, PriceItem, Technician, Holiday, Task,
    Statement, StatementLine, AuditLog
)
from core.utils import create_statement_event, vat_rate_factor
from core.arabic_amount import amount_to_arabic

DEMO_PASSWORD = 'Demo-Passw0rd!2025'

PEOPLE = [
    ('manager', 'خالد', 'العبدالله', 'مدير العقود', 'contract_manager', 'EMP1001'),
    ('entry', 'نورة', 'الشمري', 'مدخل بيانات', 'data_entry', 'EMP1002'),
    ('accountant', 'سارة', 'القحطاني', 'محاسب', 'accountant', 'EMP1003'),
    ('branch', 'فهد', 'المطيري', 'مدير الفرع', 'branch_manager', 'EMP1004'),
    ('approver', 'عبدالرحمن', 'الدوسري', 'معتمد المستخلص', 'approver', 'EMP1005'),
]

PRICE_ITEMS = [
    ('EL-001', 'تمديد كيبل جهد منخفض 4×16 مم', 'متر', '45.00'),
    ('EL-002', 'تركيب لوحة توزيع فرعية', 'لوحة', '1250.00'),
    ('EL-003', 'استبدال قاطع رئيسي 400 أمبير', 'قاطع', '890.50'),
    ('EL-004', 'صيانة وقائية لمحول 1000 ك.ف.أ', 'زيارة', '3200.00'),
    ('EL-005', 'إنارة شوارع LED 150 واط', 'وحدة', '375.25'),
]

TECHNICIANS = [
    ('T20001', 'محمد العتيبي', 'كهرباء جهد منخفض'),
    ('T20002', 'أحمد الزهراني', 'كهرباء جهد متوسط'),
    ('T20003', 'سلطان الغامدي', 'صيانة محولات'),
    ('T20004', 'ياسر السبيعي', 'إنارة'),
]

LOCATIONS = ['بريدة - حي الصفراء', 'بريدة - حي الروضة', 'عنيزة - الصناعية',
             'الرس - وسط المدينة', 'المذنب - حي النهضة']

AR_MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
             'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر']


def month_shift(anchor, offset):
    """(سنة، شهر) بعد إزاحة عدد من الأشهر عن شهر anchor"""
    total = anchor.year * 12 + (anchor.month - 1) + offset
    return total // 12, total % 12 + 1


def month_range(year, month):
    first = date(year, month, 1)
    if month == 12:
        last = date(year, 12, 31)
    else:
        last = date(year, month + 1, 1) - timedelta(days=1)
    return first, last


def working_days(first, last):
    """أيام الأسبوع عدا الجمعة والسبت"""
    day = first
    while day <= last:
        if day.weekday() not in (4, 5):
            yield day
        day += timedelta(days=1)


class Command(BaseCommand):
    help = 'إنشاء بيانات تجريبية للنظام (للتقييم والعرض فقط)'

    def add_arguments(self, parser):
        parser.add_argument(
            '--wipe', action='store_true',
            help='حذف البيانات التجريبية الحالية قبل الإنشاء'
        )

    @transaction.atomic
    def handle(self, *args, **options):
        if options['wipe']:
            self.stdout.write('حذف البيانات الحالية...')
            Task.objects.all().delete()
            Statement.all_objects.all().delete()
            Contract.objects.all().delete()
            Technician.objects.all().delete()
            Holiday.objects.all().delete()
            # سجل التدقيق يرتبط بالمستخدم بـ PROTECT عن قصد: سجل التدقيق لا يجوز
            # أن يفقد صاحبه. لذلك يُمسح صراحةً قبل حذف الحسابات، وإلا فشل
            # الأمر بـ ProtectedError. مقبول هنا لأن --wipe إعادة ضبط كاملة
            # لبيئة تجريبية، لا إجراءً على بيانات إنتاج.
            AuditLog.objects.all().delete()
            User.objects.filter(is_superuser=False).delete()

        today = timezone.localdate()
        rng = random.Random(20250601)

        users = self._create_users()
        contract, items = self._create_contract(users['contract_manager'])
        techs = self._create_technicians()
        self._create_holidays(today)

        entry = users['data_entry']

        # ── الشهر الجاري: مهام حتى اليوم ──
        cur_year, cur_month = today.year, today.month
        first, _ = month_range(cur_year, cur_month)
        count = self._seed_tasks(contract, items, techs, entry, rng,
                                 first, today)
        self.stdout.write(
            f'  + {count} مهمة في {AR_MONTHS[cur_month - 1]} {cur_year} (حتى اليوم)'
        )

        # ── الشهر السابق: مستخلص مصروف ──
        prev = self._seed_month(contract, items, techs, users, rng, offset=-1)
        if prev:
            self.stdout.write(
                f'  + مستخلص {prev.statement_number} = {prev.total_with_vat} ر.س '
                f'({prev.get_status_display()})'
            )

        # ── الشهر قبل السابق: مستخلص تمت مراجعته ──
        older = self._seed_month(contract, items, techs, users, rng,
                                 offset=-2, stop_at='reviewed')
        if older:
            self.stdout.write(
                f'  + مستخلص {older.statement_number} = {older.total_with_vat} ر.س '
                f'({older.get_status_display()})'
            )

        # ── ثلاثة أشهر سابقة: مستخلص معتمد ──
        # كل حالة من حالات دورة العمل ممثَّلة بمستخلص، فيمكن تجربة كل إجراء
        # على مستخلص جاهز بدل انتظار شهر كامل:
        #   مسودة → branch يراجعها | reviewed → approver يعتمد |
        #   approved → accountant يصرف | paid → للاطلاع والتتبع.
        approved = self._seed_month(contract, items, techs, users, rng,
                                    offset=-3, stop_at='approved')
        if approved:
            self.stdout.write(
                f'  + مستخلص {approved.statement_number} = {approved.total_with_vat} ر.س '
                f'({approved.get_status_display()})'
            )

        # ── أربعة أشهر سابقة: مستخلص مسودة ──
        draft = self._seed_month(contract, items, techs, users, rng,
                                 offset=-4, stop_at='draft')
        if draft:
            self.stdout.write(
                f'  + مستخلص {draft.statement_number} = {draft.total_with_vat} ر.س '
                f'({draft.get_status_display()})'
            )

        self.stdout.write(self.style.SUCCESS(
            f'\n✓ تم. كلمة المرور لجميع الحسابات التجريبية: {DEMO_PASSWORD}'
        ))
        self.stdout.write(
            '  الحسابات: manager (مدير عقود) | entry | accountant | branch | approver'
        )

    # ───────────────────────── إنشاء الكيانات ─────────────────────────

    def _create_users(self):
        users = {}
        for username, first, last, title, specialty, emp_id in PEOPLE:
            user, created = User.objects.get_or_create(
                username=username,
                defaults={'first_name': first, 'last_name': last,
                          'email': f'{username}@sec.demo'}
            )
            if created:
                user.set_password(DEMO_PASSWORD)
                user.save()
            UserProfile.objects.get_or_create(
                user=user,
                defaults={'specialty': specialty, 'employee_id': emp_id,
                          'must_change_password': False}
            )
            users[specialty] = user
            self.stdout.write(f'  {"+" if created else "="} {username} — {title}')
        return users

    def _create_contract(self, manager):
        today = timezone.localdate()
        contract, created = Contract.objects.get_or_create(
            contract_number='1001',
            defaults={
                'title': 'العقد الموحد - تشغيل وصيانة شبكات التوزيع بمنطقة القصيم',
                'start_date': date(today.year, 1, 1),
                'end_date': date(today.year, 12, 31),
                'created_by': manager,
            }
        )
        self.stdout.write(f'  {"+" if created else "="} عقد {contract.contract_number}')

        for code, desc, unit, price in PRICE_ITEMS:
            PriceItem.objects.get_or_create(
                contract=contract, code=code,
                defaults={'description': desc, 'unit': unit,
                          'unit_price': Decimal(price)}
            )
        return contract, list(contract.price_items.all())

    def _create_technicians(self):
        techs = []
        for emp, name, spec in TECHNICIANS:
            tech, _ = Technician.objects.get_or_create(
                employee_number=emp, defaults={'name': name, 'specialty': spec}
            )
            techs.append(tech)
        return techs

    def _create_holidays(self, today):
        for month, day, name in [(2, 22, 'يوم التأسيس'), (9, 23, 'اليوم الوطني')]:
            Holiday.objects.get_or_create(
                date=date(today.year, month, day), defaults={'name': name}
            )

    # ───────────────────────── المهام والمستخلصات ─────────────────────────

    def _seed_tasks(self, contract, items, techs, entry, rng, first, last):
        created = 0
        for day in working_days(first, last):
            for _ in range(rng.randint(2, 4)):
                item = rng.choice(items)
                tech = rng.choice(techs)
                qty = Decimal(rng.choice(['1', '2', '3', '5', '8', '12', '25']))
                exists = Task.objects.filter(
                    contract=contract, task_date=day, technician=tech,
                    price_item=item
                ).exists()
                if exists:
                    continue
                Task.objects.create(
                    contract=contract,
                    technician=tech,
                    price_item=item,
                    task_date=day,
                    quantity=qty,
                    unit_price_snapshot=item.unit_price,
                    total_cost=(qty * item.unit_price).quantize(Decimal('0.01')),
                    location=rng.choice(LOCATIONS),
                    created_by=entry,
                )
                created += 1
        return created

    def _seed_month(self, contract, items, techs, users, rng, offset,
                    stop_at='paid'):
        today = timezone.localdate()
        year, month = month_shift(today, offset)
        first, last = month_range(year, month)

        self._seed_tasks(contract, items, techs, users['data_entry'], rng, first, last)
        return self._build_statement(contract, year, month, users, stop_at)

    def _build_statement(self, contract, year, month, users, stop_at='paid'):
        existing = Statement.objects.filter(
            contract=contract, year=year, month=month
        ).first()
        if existing:
            return existing

        tasks = Task.objects.filter(
            contract=contract, task_date__year=year, task_date__month=month,
            is_locked=False
        )
        if not tasks.exists():
            return None

        revision = Statement.all_objects.filter(
            contract=contract, year=year, month=month
        ).count() + 1
        number = Statement.generate_number(contract, year, month, revision)

        grouped = tasks.values(
            'price_item__code', 'price_item__description', 'price_item__unit',
            'unit_price_snapshot'
        ).annotate(
            total_qty=Sum('quantity'), total_cost=Sum('total_cost')
        ).order_by('price_item__code')

        stmt = Statement.objects.create(
            statement_number=number, contract=contract, year=year, month=month,
            revision=revision, created_by=users['accountant'], status='draft',
        )

        subtotal = Decimal('0')
        for g in grouped:
            line_total = Decimal(g['total_cost']).quantize(Decimal('0.01'))
            StatementLine.objects.create(
                statement=stmt,
                item_code=g['price_item__code'],
                item_description=g['price_item__description'],
                unit=g['price_item__unit'],
                unit_price=g['unit_price_snapshot'],
                total_quantity=g['total_qty'],
                line_total=line_total,
            )
            subtotal += line_total

        stmt.subtotal = subtotal
        stmt.vat_amount = (subtotal * vat_rate_factor()).quantize(Decimal('0.01'))
        stmt.total_with_vat = subtotal + stmt.vat_amount
        stmt.total_in_words = amount_to_arabic(stmt.total_with_vat)
        stmt.notes = f'مستخلص أعمال شهر {AR_MONTHS[month - 1]} {year}'
        stmt.save()
        tasks.update(is_locked=True)

        create_statement_event(stmt, 'created', users['accountant'],
                               f'إنشاء مستخلص {number}')

        if stop_at in ('reviewed', 'approved', 'paid'):
            stmt.status = 'reviewed'
            stmt.reviewed_by = users['branch_manager']
            stmt.reviewed_at = timezone.now()
            stmt.save()
            create_statement_event(stmt, 'reviewed', users['branch_manager'],
                                   'تمت المراجعة')

        if stop_at in ('approved', 'paid'):
            stmt.status = 'approved'
            stmt.approved_by = users['approver']
            stmt.approved_at = timezone.now()
            stmt.save()
            create_statement_event(stmt, 'approved', users['approver'], 'تم الاعتماد')

        if stop_at == 'paid':
            stmt.po_number = f'PO-{year}-{month:02d}01'
            stmt.status = 'paid'
            stmt.paid_by = users['accountant']
            stmt.paid_at = timezone.now()
            stmt.save()
            create_statement_event(stmt, 'paid', users['accountant'],
                                   f'تم الصرف - رقم PO: {stmt.po_number}')

        from core.utils import verify_event_chain
        if not verify_event_chain(stmt):
            self.stdout.write(self.style.ERROR(
                f'سلسلة أحداث {number} غير سليمة!'
            ))
        return stmt
