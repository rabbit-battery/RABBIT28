"""اختبارات دورة حياة المستخلص: الإنشاء، المراجعة، الاعتماد، الصرف، الحذف"""

from datetime import date
from decimal import Decimal

from django.test import TestCase
from django.urls import reverse

from core.models import Statement, StatementEvent, Task
from core.utils import verify_event_chain
from .factories import (
    make_user, make_contract, make_price_item, make_technician,
    make_task, mark_otp_verified
)


class StatementBase(TestCase):
    """بيئة مشتركة: عقد، بندان، ثلاث مهام في يونيو 2025"""

    year = 2025
    month = 6

    def setUp(self):
        self.accountant = make_user('accountant')
        self.manager = make_user('branch_manager')
        self.approver = make_user('approver')
        self.data_entry = make_user('data_entry')

        self.contract = make_contract(self.accountant, contract_number='101')
        self.item_a = make_price_item(self.contract, code='IT-001', unit_price='100.00')
        self.item_b = make_price_item(self.contract, code='IT-002', unit_price='250.00')
        self.tech = make_technician()

        # 10 × 100 + 5 × 100 + 2 × 250 = 2000 قبل الضريبة
        self.tasks = [
            make_task(self.contract, self.tech, self.item_a, date(2025, 6, 2), 10, self.data_entry),
            make_task(self.contract, self.tech, self.item_a, date(2025, 6, 3), 5, self.data_entry),
            make_task(self.contract, self.tech, self.item_b, date(2025, 6, 4), 2, self.data_entry),
        ]
        # مهمة في شهر آخر يجب ألا تدخل المستخلص
        self.other_month_task = make_task(
            self.contract, self.tech, self.item_a, date(2025, 7, 1), 99, self.data_entry
        )

    def generate(self, user=None, year=None, month=None):
        user = user or self.accountant
        self.client.force_login(user)
        mark_otp_verified(self.client, user)
        return self.client.post(reverse('statement_generate'), {
            'contract': self.contract.pk,
            'year': year or self.year,
            'month': month or self.month,
        })

    def created_statement(self):
        return Statement.objects.get()


class StatementGenerationTests(StatementBase):

    def test_generate_redirects_to_detail(self):
        stmt = None
        response = self.generate()
        self.assertEqual(response.status_code, 302)
        stmt = self.created_statement()
        self.assertEqual(
            response['Location'], reverse('statement_detail', args=[stmt.pk])
        )

    def test_totals_and_vat(self):
        self.generate()
        stmt = self.created_statement()
        self.assertEqual(stmt.subtotal, Decimal('2000.00'))
        self.assertEqual(stmt.vat_amount, Decimal('300.00'))
        self.assertEqual(stmt.total_with_vat, Decimal('2300.00'))

    def test_amount_in_words(self):
        self.generate()
        self.assertEqual(
            self.created_statement().total_in_words,
            'ألفان وثلاثمائة ريال سعودي'
        )

    def test_statement_number_format(self):
        self.generate()
        self.assertEqual(self.created_statement().statement_number, 'ST-202506-101')

    def test_lines_are_aggregated_by_price_item(self):
        self.generate()
        stmt = self.created_statement()
        self.assertEqual(stmt.lines.count(), 2)

        line_a = stmt.lines.get(item_code='IT-001')
        self.assertEqual(line_a.total_quantity, Decimal('15'))
        self.assertEqual(line_a.line_total, Decimal('1500.00'))

        line_b = stmt.lines.get(item_code='IT-002')
        self.assertEqual(line_b.total_quantity, Decimal('2'))
        self.assertEqual(line_b.line_total, Decimal('500.00'))

    def test_only_tasks_of_the_selected_month_are_included(self):
        self.generate()
        self.assertFalse(Task.objects.get(pk=self.other_month_task.pk).is_locked)
        self.assertEqual(Task.objects.filter(is_locked=True).count(), 3)

    def test_tasks_are_locked_after_generation(self):
        self.generate()
        for task in self.tasks:
            task.refresh_from_db()
            self.assertTrue(task.is_locked, f'المهمة {task.pk} يجب أن تُقفل')

    def test_creation_event_is_recorded_and_chained(self):
        self.generate()
        stmt = self.created_statement()
        events = list(stmt.events.all())
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0].event_type, 'created')
        self.assertEqual(events[0].previous_hash, '0' * 64)
        self.assertEqual(len(events[0].event_hash), 64)
        self.assertTrue(verify_event_chain(stmt))

    def test_second_active_statement_for_same_month_rejected(self):
        self.generate()
        response = self.generate()
        self.assertEqual(response.status_code, 302)
        self.assertEqual(Statement.objects.count(), 1)

    def test_month_without_tasks_rejected(self):
        response = self.generate(month=3)
        self.assertEqual(response.status_code, 302)
        self.assertEqual(Statement.objects.count(), 0)

    def test_data_entry_cannot_generate(self):
        response = self.generate(user=self.data_entry)
        self.assertEqual(response.status_code, 403)
        self.assertEqual(Statement.objects.count(), 0)

    def test_get_request_shows_form(self):
        self.client.force_login(self.accountant)
        mark_otp_verified(self.client, self.accountant)
        response = self.client.get(reverse('statement_generate'))
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, 'إنشاء مستخلص جديد')
        self.assertEqual(Statement.objects.count(), 0)


class StatementWorkflowTests(StatementBase):

    def setUp(self):
        super().setUp()
        self.generate()
        self.stmt = self.created_statement()

    def review(self, user=None):
        user = user or self.manager
        self.client.force_login(user)
        mark_otp_verified(self.client, user)
        return self.client.post(reverse('statement_review', args=[self.stmt.pk]))

    def approve(self, user=None):
        user = user or self.approver
        self.client.force_login(user)
        mark_otp_verified(self.client, user)
        return self.client.post(reverse('statement_approve', args=[self.stmt.pk]))

    def pay(self, user=None, po='PO-2025-0001'):
        user = user or self.accountant
        self.client.force_login(user)
        mark_otp_verified(self.client, user)
        return self.client.post(
            reverse('statement_pay', args=[self.stmt.pk]), {'po_number': po}
        )

    def test_creator_without_review_role_gets_403(self):
        # المحاسب ليس مدير فرع أصلاً، فيُرفض من بوابة الأدوار قبل فحص "المراجعة الذاتية"
        response = self.review(user=self.accountant)
        self.assertEqual(response.status_code, 403)
        self.stmt.refresh_from_db()
        self.assertEqual(self.stmt.status, 'draft')

    def test_branch_manager_cannot_review_statement_he_created(self):
        """
        حاجز «لا تراجع ما أنشأته» يعمل حتى لو أصبح المنشئ مديراً للفرع.
        (في النموذج الحالي التخصص واحد فالمنشئ لا يمكن أن يكون مدير فرع،
         وهذا الحاجز طبقة دفاع إضافية نتحقق منها مباشرة.)
        """
        self.stmt.created_by = self.manager
        self.stmt.save()

        response = self.review(user=self.manager)
        self.assertEqual(response.status_code, 302)
        self.stmt.refresh_from_db()
        self.assertEqual(self.stmt.status, 'draft')
        self.assertIsNone(self.stmt.reviewed_by)

    def test_review_by_branch_manager(self):
        self.review()
        self.stmt.refresh_from_db()
        self.assertEqual(self.stmt.status, 'reviewed')
        self.assertEqual(self.stmt.reviewed_by, self.manager)
        self.assertIsNotNone(self.stmt.reviewed_at)
        self.assertEqual(self.stmt.events.filter(event_type='reviewed').count(), 1)

    def test_reviewer_cannot_approve(self):
        self.review()
        self.approve(user=self.manager)
        self.stmt.refresh_from_db()
        self.assertEqual(self.stmt.status, 'reviewed')

    def test_approve_by_approver(self):
        self.review()
        self.approve()
        self.stmt.refresh_from_db()
        self.assertEqual(self.stmt.status, 'approved')
        self.assertEqual(self.stmt.approved_by, self.approver)

    def test_cannot_approve_before_review(self):
        self.approve()
        self.stmt.refresh_from_db()
        self.assertEqual(self.stmt.status, 'draft')

    def test_full_cycle_to_paid(self):
        self.review()
        self.approve()
        self.pay()
        self.stmt.refresh_from_db()
        self.assertEqual(self.stmt.status, 'paid')
        self.assertEqual(self.stmt.po_number, 'PO-2025-0001')
        self.assertEqual(
            [e.event_type for e in self.stmt.events.all()],
            ['created', 'reviewed', 'approved', 'paid']
        )
        self.assertTrue(verify_event_chain(self.stmt))

    def test_purchase_order_is_uppercased_and_validated(self):
        self.review()
        self.approve()
        self.pay(po='po-2025-9999')
        self.stmt.refresh_from_db()
        self.assertEqual(self.stmt.po_number, 'PO-2025-9999')

    def test_invalid_purchase_order_rejected(self):
        self.review()
        self.approve()
        self.pay(po='سيئ!!')
        self.stmt.refresh_from_db()
        self.assertEqual(self.stmt.status, 'approved')
        self.assertEqual(self.stmt.po_number, '')

    def test_paid_statement_cannot_be_deleted(self):
        self.review()
        self.approve()
        self.pay()
        self.client.force_login(self.manager)
        mark_otp_verified(self.client, self.manager)
        self.client.post(
            reverse('statement_delete', args=[self.stmt.pk]),
            {'reason': 'محاولة حذف مستخلص مصروف'}
        )
        self.stmt.refresh_from_db()
        self.assertFalse(self.stmt.is_deleted)


class StatementDeletionTests(StatementBase):

    def test_soft_delete_unlocks_tasks_and_keeps_record(self):
        self.generate()
        stmt = self.created_statement()
        reason = 'أدخلت المهام في الشهر الخطأ ويجب إعادة التوليد'

        self.client.force_login(self.manager)
        mark_otp_verified(self.client, self.manager)
        response = self.client.post(
            reverse('statement_delete', args=[stmt.pk]), {'reason': reason}
        )

        self.assertEqual(response.status_code, 302)
        stmt.refresh_from_db()
        self.assertTrue(stmt.is_deleted)
        self.assertEqual(stmt.deleted_by, self.manager)
        self.assertEqual(stmt.delete_reason, reason)
        self.assertIsNotNone(stmt.deleted_at)
        self.assertEqual(Task.objects.filter(is_locked=True).count(), 0)

        # يبقى مرئياً عبر all_objects ومخفياً عبر objects
        self.assertFalse(Statement.objects.filter(pk=stmt.pk).exists())
        self.assertTrue(Statement.all_objects.filter(pk=stmt.pk).exists())

    def test_deleted_statement_is_excluded_from_lists(self):
        self.generate()
        stmt = self.created_statement()
        self.client.force_login(self.manager)
        mark_otp_verified(self.client, self.manager)
        self.client.post(
            reverse('statement_delete', args=[stmt.pk]),
            {'reason': 'حذف تجريبي لسبب مشروع' * 2}
        )
        self.client.get(reverse('statements'))
        self.assertEqual(Statement.objects.count(), 0)

    def test_short_reason_rejected(self):
        self.generate()
        stmt = self.created_statement()
        self.client.force_login(self.manager)
        mark_otp_verified(self.client, self.manager)
        self.client.post(
            reverse('statement_delete', args=[stmt.pk]), {'reason': 'قصير'}
        )
        stmt.refresh_from_db()
        self.assertFalse(stmt.is_deleted)

    def test_accountant_can_delete_draft_only(self):
        self.generate()
        stmt = self.created_statement()

        # المحاسب أنشأه بنفسه وهو مسودة → يمكنه حذفه
        self.client.force_login(self.accountant)
        mark_otp_verified(self.client, self.accountant)
        self.client.post(
            reverse('statement_delete', args=[stmt.pk]),
            {'reason': 'حذف مسودة من قبل المحاسب المنشئ'}
        )
        stmt.refresh_from_db()
        self.assertTrue(stmt.is_deleted)

    def test_revision_increments_after_delete_and_regenerate(self):
        self.generate()
        first = self.created_statement()
        self.assertEqual(first.revision, 1)
        self.assertEqual(first.statement_number, 'ST-202506-101')

        self.client.force_login(self.manager)
        mark_otp_verified(self.client, self.manager)
        self.client.post(
            reverse('statement_delete', args=[first.pk]),
            {'reason': 'إعادة توليد المستخلص بعد تصحيح المهام'}
        )

        self.generate()
        second = Statement.objects.get()
        self.assertEqual(second.revision, 2)
        self.assertEqual(second.statement_number, 'ST-202506-101-R2')


class EventIntegrityTests(StatementBase):

    def test_events_cannot_be_modified_through_the_model(self):
        self.generate()
        event = self.created_statement().events.first()
        event.details = 'محاولة تعديل'
        with self.assertRaises(PermissionError):
            event.save()

    def test_events_cannot_be_deleted_through_the_model(self):
        self.generate()
        event = self.created_statement().events.first()
        with self.assertRaises(PermissionError):
            event.delete()

    def test_direct_database_tampering_is_detected(self):
        self.generate()
        stmt = self.created_statement()
        event = stmt.events.first()
        self.assertTrue(verify_event_chain(stmt))

        # تجاوز حراسة النموذج بتحديث مباشر على مستوى قاعدة البيانات
        StatementEvent.objects.filter(pk=event.pk).update(details='نص مزوَّر')
        event.refresh_from_db()

        self.assertFalse(event.verify_chain())
        self.assertFalse(verify_event_chain(stmt))

    def test_signature_tampering_is_detected(self):
        self.generate()
        stmt = self.created_statement()
        event = stmt.events.first()
        StatementEvent.objects.filter(pk=event.pk).update(signature_snapshot='ZmFrZQ==')
        event.refresh_from_db()
        self.assertFalse(verify_event_chain(stmt))

    def test_broken_link_between_events_is_detected(self):
        self.generate()
        stmt = self.created_statement()

        self.client.force_login(self.manager)
        mark_otp_verified(self.client, self.manager)
        self.client.post(reverse('statement_review', args=[stmt.pk]))

        self.assertTrue(verify_event_chain(stmt))

        # إعادة ربط الحدث الثاني ببداية السلسلة يكسر التسلسل
        review_event = stmt.events.filter(event_type='reviewed').first()
        StatementEvent.objects.filter(pk=review_event.pk).update(previous_hash='0' * 64)
        self.assertFalse(verify_event_chain(stmt))

    def test_track_page_reports_broken_chain(self):
        self.generate()
        stmt = self.created_statement()
        number = stmt.statement_number
        StatementEvent.objects.filter(statement=stmt).update(details='عبث')

        self.client.force_login(self.data_entry)
        response = self.client.post(reverse('statement_track'), {'statement_number': number})
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, 'سلسلة التجزئة غير سليمة')

    def test_track_page_reports_healthy_chain(self):
        self.generate()
        number = self.created_statement().statement_number

        self.client.force_login(self.data_entry)
        response = self.client.post(reverse('statement_track'), {'statement_number': number})
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, 'سلسلة التجزئة سليمة')

    def test_track_page_handles_unknown_number(self):
        self.client.force_login(self.data_entry)
        response = self.client.post(
            reverse('statement_track'), {'statement_number': 'ST-202501-999'}
        )
        self.assertContains(response, 'لم يتم العثور على مستخلص بهذا الرقم')

    def test_track_rejects_malformed_number(self):
        self.client.force_login(self.data_entry)
        response = self.client.post(
            reverse('statement_track'), {'statement_number': 'DROP TABLE'}
        )
        self.assertContains(response, 'صيغة رقم المستخلص غير صحيحة')


class StatementNotesTests(StatementBase):

    def test_notes_form_is_reachable_and_saves(self):
        self.generate()
        stmt = self.created_statement()

        self.client.force_login(self.accountant)
        mark_otp_verified(self.client, self.accountant)

        get_response = self.client.get(reverse('statement_notes', args=[stmt.pk]))
        self.assertEqual(get_response.status_code, 200)
        self.assertContains(get_response, 'تعديل ملاحظات المستخلص')

        self.client.post(
            reverse('statement_notes', args=[stmt.pk]), {'notes': 'مراجعة أولية'}
        )
        stmt.refresh_from_db()
        self.assertEqual(stmt.notes, 'مراجعة أولية')
        self.assertEqual(stmt.events.filter(event_type='edited').count(), 1)

    def test_notes_cannot_be_changed_after_review(self):
        self.generate()
        stmt = self.created_statement()
        self.client.force_login(self.manager)
        mark_otp_verified(self.client, self.manager)
        self.client.post(reverse('statement_review', args=[stmt.pk]))

        self.client.post(
            reverse('statement_notes', args=[stmt.pk]), {'notes': 'تعديل متأخر'}
        )
        stmt.refresh_from_db()
        self.assertEqual(stmt.notes, '')
