from django.test import SimpleTestCase

from core.arabic_amount import amount_to_arabic


class ArabicAmountTests(SimpleTestCase):

    def test_zero(self):
        self.assertEqual(amount_to_arabic(0), 'صفر ريال سعودي')

    def test_single_riyal(self):
        self.assertEqual(amount_to_arabic(1), 'واحد ريال سعودي')

    def test_teens_with_halalas(self):
        self.assertEqual(
            amount_to_arabic('15.50'),
            'خمسة عشر ريال سعودي وخمسون هللة'
        )

    def test_hundreds_and_tens(self):
        self.assertEqual(amount_to_arabic(185), 'مائة وخمسة وثمانون ريال سعودي')

    def test_one_thousand(self):
        self.assertEqual(amount_to_arabic(1000), 'ألف ريال سعودي')

    def test_dual_thousand(self):
        self.assertEqual(amount_to_arabic(2000), 'ألفان ريال سعودي')

    def test_few_thousands(self):
        self.assertEqual(amount_to_arabic(3000), 'ثلاثة آلاف ريال سعودي')

    def test_many_thousands(self):
        self.assertEqual(amount_to_arabic(11000), 'أحد عشر ألف ريال سعودي')

    def test_one_million(self):
        self.assertEqual(amount_to_arabic(1000000), 'مليون ريال سعودي')

    def test_dual_million(self):
        self.assertEqual(amount_to_arabic(2000000), 'مليونان ريال سعودي')

    def test_few_millions(self):
        self.assertEqual(amount_to_arabic(5000000), 'خمسة ملايين ريال سعودي')

    def test_billion(self):
        self.assertEqual(amount_to_arabic(1000000000), 'مليار ريال سعودي')

    def test_composite_number(self):
        self.assertEqual(
            amount_to_arabic(1234567),
            'مليون ومئتان وأربعة وثلاثون ألف وخمسمائة وسبعة وستون ريال سعودي'
        )

    def test_halalas_rounding_is_half_up(self):
        # 0.125 → 13 هللة (وليس 12 كما في التقريب المصرفي الافتراضي)
        self.assertEqual(amount_to_arabic('0.125'), 'ثلاثة عشر هللة')

    def test_negative_amount(self):
        self.assertTrue(amount_to_arabic(-1500).startswith('سالب '))

    def test_realistic_statement_total(self):
        text = amount_to_arabic('24150.75')
        self.assertIn('ريال سعودي', text)
        self.assertIn('خمسة وسبعون هللة', text)
