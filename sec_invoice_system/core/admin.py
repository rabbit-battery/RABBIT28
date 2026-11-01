from django.contrib import admin

from .models import (
    Contract, PriceItem, Technician, Holiday, Task,
    Statement, StatementLine, StatementEvent, UserProfile, AuditLog
)


@admin.register(Contract)
class ContractAdmin(admin.ModelAdmin):
    list_display = ['contract_number', 'title', 'start_date', 'end_date', 'is_active']
    list_filter = ['is_active']
    search_fields = ['contract_number', 'title']


@admin.register(PriceItem)
class PriceItemAdmin(admin.ModelAdmin):
    list_display = ['code', 'description', 'unit', 'unit_price', 'contract']
    list_filter = ['contract']


@admin.register(Technician)
class TechnicianAdmin(admin.ModelAdmin):
    list_display = ['employee_number', 'name', 'specialty', 'is_active']
    list_filter = ['is_active', 'specialty']


@admin.register(Holiday)
class HolidayAdmin(admin.ModelAdmin):
    list_display = ['date', 'name']


@admin.register(Task)
class TaskAdmin(admin.ModelAdmin):
    list_display = ['technician', 'price_item', 'task_date', 'quantity', 'total_cost', 'is_locked']
    list_filter = ['is_locked', 'contract', 'task_date']
    date_hierarchy = 'task_date'


@admin.register(Statement)
class StatementAdmin(admin.ModelAdmin):
    list_display = [
        'statement_number', 'contract', 'status', 'subtotal', 'total_with_vat', 'is_deleted'
    ]
    list_filter = ['status', 'is_deleted']
    readonly_fields = [
        'statement_number', 'contract', 'year', 'month', 'subtotal',
        'vat_amount', 'total_with_vat', 'total_in_words', 'status',
        'created_by', 'reviewed_by', 'approved_by', 'paid_by',
        'po_number', 'is_deleted', 'deleted_by', 'delete_reason',
    ]

    def get_queryset(self, request):
        # المدير الأعلى يجب أن يرى المستخلصات المحذوفة منطقياً أيضاً
        return Statement.all_objects.all()

    def has_delete_permission(self, request, obj=None):
        return False

    def has_add_permission(self, request):
        return False


@admin.register(StatementLine)
class StatementLineAdmin(admin.ModelAdmin):
    list_display = ['statement', 'item_code', 'item_description', 'total_quantity', 'line_total']
    readonly_fields = [
        'statement', 'item_code', 'item_description', 'unit',
        'unit_price', 'total_quantity', 'line_total',
    ]

    def has_delete_permission(self, request, obj=None):
        return False

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False


@admin.register(StatementEvent)
class StatementEventAdmin(admin.ModelAdmin):
    list_display = ['statement', 'event_type', 'performed_by_name', 'timestamp']
    readonly_fields = [
        'statement', 'event_type', 'performed_by_name', 'performed_by_role',
        'performed_by', 'details', 'signature_snapshot', 'previous_hash',
        'event_hash', 'timestamp',
    ]

    def has_delete_permission(self, request, obj=None):
        return False

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False


@admin.register(UserProfile)
class UserProfileAdmin(admin.ModelAdmin):
    list_display = ['user', 'specialty', 'employee_id', 'must_change_password']
    list_filter = ['specialty']


@admin.register(AuditLog)
class AuditLogAdmin(admin.ModelAdmin):
    list_display = ['user', 'action', 'timestamp', 'ip_address']
    list_filter = ['action']
    readonly_fields = ['user', 'action', 'details', 'ip_address', 'timestamp']
    date_hierarchy = 'timestamp'

    def has_delete_permission(self, request, obj=None):
        return False

    def has_add_permission(self, request):
        return False
