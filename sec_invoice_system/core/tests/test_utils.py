from datetime import date
from decimal import Decimal

from django.test import TestCase

from core.models import Holiday
from core.utils import (
    get_working_days, get_remaining_working_days, forecast_monthly,
    sanitize_excel_value, vat_rate_factor
)


class WorkingDaysTests(TestCase):

    def test_excludes_friday_and_saturday(self):
        # 2025-06-01 أحد ... 2025-06-07 سبت  → 5 أيام عمل
        self.assertEqual(get_working_days(date(2025, 6, 1), date(2025, 6, 7)), 5)

    def test_excludes_holidays(self):
        Holiday.objects.create(date=date(2025, 6, 3), name='عطلة رسمية')
        self.assertEqual(get_working_days(date(2025, 6, 1), date(2025, 6, 7)), 4)

    def test_holiday_on_weekend_does_not_double_count(self):
        Holiday.objects.create(date=date(2025, 6, 6), name='جمعة عطلة')
        self.assertEqual(get_working_days(date(2025, 6, 1), date(2025, 6, 7)), 5)

    def test_single_weekend_day_is_zero(self):
        self.assertEqual(get_working_days(date(2025, 6, 6), date(2025, 6, 6)), 0)

    def test_reversed_range_is_zero(self):
        self.assertEqual(get_working_days(date(2025, 6, 7), date(2025, 6, 1)), 0)

    def test_remaining_days_at_month_end_is_zero(self):
        self.assertEqual(get_remaining_working_days(date(2025, 6, 30)), 0)

    def test_remaining_days_after_a_given_date(self):
        # من 26 يونيو 2025 (خميس) حتى 30 يونيو (اثنين)
        self.assertEqual(get_remaining_working_days(date(2025, 6, 26)), 2)


class ForecastTests(TestCase):

    def test_linear_projection(self):
        self.assertEqual(
            forecast_monthly(Decimal('1000'), 10, 10), Decimal('2000.00')
        )

    def test_no_elapsed_days_returns_accumulated(self):
        self.assertEqual(
            forecast_monthly(Decimal('500'), 0, 20), Decimal('500')
        )

    def test_no_remaining_days_returns_accumulated(self):
        self.assertEqual(
            forecast_monthly(Decimal('777.50'), 15, 0), Decimal('777.50')
        )

    def test_accepts_plain_numbers(self):
        self.assertEqual(forecast_monthly(900, 3, 1), Decimal('1200.00'))


class VatTests(TestCase):

    def test_vat_factor_comes_from_settings(self):
        self.assertEqual(vat_rate_factor(), Decimal('0.15'))

    def test_vat_amount(self):
        subtotal = Decimal('1000.00')
        self.assertEqual(
            (subtotal * vat_rate_factor()).quantize(Decimal('0.01')),
            Decimal('150.00')
        )


class ExcelSanitizeTests(TestCase):

    def test_formula_prefixed_values_are_neutralized(self):
        for raw in ('=1+1', '+cmd', '-cmd', '@SUM(A1)', '\t=evil'):
            self.assertTrue(
                sanitize_excel_value(raw).startswith("'"),
                f'لم يتم تحييد: {raw!r}'
            )

    def test_normal_text_untouched(self):
        self.assertEqual(sanitize_excel_value('بند عادي'), 'بند عادي')

    def test_non_strings_untouched(self):
        self.assertEqual(sanitize_excel_value(42), 42)
        self.assertIsNone(sanitize_excel_value(None))
