from django.core.management.base import BaseCommand
from django.contrib.auth.models import Group, Permission


class Command(BaseCommand):
    help = 'إنشاء المجموعات والصلاحيات'

    ROLES = {
        'مدخل بيانات': [
            'add_task', 'change_task', 'delete_task', 'view_task',
            'view_contract', 'view_priceitem', 'view_technician',
        ],
        'محاسب': [
            'add_statement', 'view_statement', 'delete_statement',
            'view_task', 'view_contract', 'view_priceitem',
        ],
        'مدير الفرع': [
            'view_statement', 'change_statement', 'delete_statement',
            'view_task', 'view_contract',
        ],
        'معتمد المستخلص': [
            'view_statement', 'change_statement',
            'view_task', 'view_contract',
        ],
        'مدير العقود': [
            'add_contract', 'change_contract', 'view_contract',
            'add_priceitem', 'change_priceitem', 'view_priceitem',
            'add_technician', 'change_technician', 'view_technician',
            'add_holiday', 'change_holiday', 'view_holiday',
            'view_task', 'view_statement',
        ],
    }

    def handle(self, *args, **options):
        for group_name, perm_codenames in self.ROLES.items():
            group, created = Group.objects.get_or_create(name=group_name)
            if created:
                self.stdout.write(f'✓ إنشاء مجموعة: {group_name}')

            group.permissions.clear()
            for codename in perm_codenames:
                perm = Permission.objects.filter(codename=codename).first()
                if perm is None:
                    self.stdout.write(
                        self.style.WARNING(f'  ⚠ صلاحية غير موجودة: {codename}')
                    )
                    continue
                group.permissions.add(perm)

            self.stdout.write(f'  → {group.permissions.count()} صلاحية')

        self.stdout.write(self.style.SUCCESS('✓ تم إعداد جميع الأدوار'))
