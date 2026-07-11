import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.analysis import analyze_rules  # noqa: E402
from app.schemas import Segment  # noqa: E402


class AnalysisTests(unittest.TestCase):
    def test_extracts_english_task_and_relative_date(self):
        segments = [Segment(id="s1", sequence_no=0, start_ms=0, end_ms=1000, text="Dana will send the final email tomorrow at 10.")]
        result = analyze_rules(segments, datetime(2026, 7, 11, tzinfo=timezone.utc))
        self.assertEqual(len(result.items), 1)
        self.assertEqual(result.items[0].kind, "task")
        self.assertTrue(result.items[0].dueAt.startswith("2026-07-12T10:00"))
        self.assertEqual(result.items[0].sourceSegmentIds, ["s1"])

    def test_extracts_hebrew_task(self):
        segments = [Segment(id="s2", sequence_no=0, start_ms=0, end_ms=1000, text="אני אשלח ללקוחות את המייל מחר.", language="he")]
        result = analyze_rules(segments, datetime(2026, 7, 11, tzinfo=timezone.utc))
        self.assertEqual(result.items[0].kind, "task")
        self.assertIn("2026-07-12", result.items[0].dueAt)

    def test_does_not_turn_advice_into_a_task(self):
        segments = [Segment(id="s3", sequence_no=0, start_ms=0, end_ms=1000, text="You need to understand yourself and you will enjoy it.")]
        result = analyze_rules(segments, datetime(2026, 7, 11, tzinfo=timezone.utc))
        self.assertEqual(result.items, [])

    def test_meeting_without_date_requires_review(self):
        segments = [Segment(id="s4", sequence_no=0, start_ms=0, end_ms=1000, text="Let's have a meeting about the launch.")]
        result = analyze_rules(segments, datetime(2026, 7, 11, tzinfo=timezone.utc))
        self.assertEqual(len(result.items), 1)
        self.assertEqual(result.items[0].kind, "event")
        self.assertEqual(result.items[0].status, "needs_review")
        self.assertIsNone(result.items[0].startsAt)


if __name__ == "__main__":
    unittest.main()
