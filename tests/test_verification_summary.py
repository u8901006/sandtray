import unittest
from tools.verification.playwright_summary import parse_summary
class SummaryTests(unittest.TestCase):
    def test_expected_failure_names_do_not_mark_run_failed(self):
        self.assertEqual(parse_summary('ok 17 file › A13 failed local close\nERROR expected failure\n  63 passed (3.4m)',63)['status'],'PASS')
    def test_real_failure_is_not_hidden_by_passed_count(self):
        self.assertEqual(parse_summary('  1 failed\n  63 passed (3.4m)',63)['status'],'NEEDS_REVIEW')
    def test_incomplete_or_flaky_runs_need_review(self):
        for text in ['ok 63 test passed','62 passed (3m)','63 passed (3m)\n1 flaky','63 passed (3m)\n1 interrupted']:
            self.assertEqual(parse_summary(text,63)['status'],'NEEDS_REVIEW')
    def test_ansi_summary_is_supported(self):
        self.assertEqual(parse_summary('\x1b[32m 16 passed (2m)\x1b[0m',16)['status'],'PASS')
if __name__=='__main__':unittest.main()
