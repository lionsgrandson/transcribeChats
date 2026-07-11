import sys
import unittest
from unittest.mock import patch
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.analysis import _best_source_ids, _ensure_meaningful_notes, analyze, analyze_rules  # noqa: E402
from app.schemas import Analysis, AnalysisItem, Segment  # noqa: E402
from app.settings import settings  # noqa: E402


class FakeOllamaResponse:
    def raise_for_status(self):
        return None

    def json(self):
        return {"message": {"content": '{"summary":"Useful summary","items":[]}'}, "done_reason": "stop"}


class FakeOllamaClient:
    payload = None

    def __init__(self, *args, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return None

    async def post(self, url, json):
        FakeOllamaClient.payload = json
        return FakeOllamaResponse()


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

    def test_assigns_a_source_when_an_ai_item_omits_it(self):
        segments = [
            Segment(id="s1", sequence_no=0, start_ms=0, end_ms=1000, text="The launch remains private."),
            Segment(id="s2", sequence_no=1, start_ms=1000, end_ms=2000, text="Noam will send the final report tomorrow."),
        ]
        item = AnalysisItem(kind="task", title="Send the final report", sourceSegmentIds=[])
        self.assertEqual(_best_source_ids(item, segments), ["s2"])

    def test_creates_sourced_notes_for_substantive_zero_item_analysis(self):
        result = Analysis(summary="Conversation summary", items=[])
        segments = [Segment(id="s1", sequence_no=0, start_ms=0, end_ms=4000, text="The customer is unavailable next week, which is an important risk for the release schedule and should remain visible to the team.")]
        _ensure_meaningful_notes(result, segments)
        self.assertEqual(result.items[0].kind, "note")
        self.assertEqual(result.items[0].sourceSegmentIds, ["s1"])


class OllamaAnalysisTests(unittest.IsolatedAsyncioTestCase):
    async def test_disables_thinking_and_parses_structured_chat_output(self):
        segments = [Segment(id="s1", sequence_no=0, start_ms=0, end_ms=1000, text="We decided to ship Friday.")]
        with patch.object(settings, "ollama_url", "http://ollama"), patch("app.analysis.httpx.AsyncClient", FakeOllamaClient):
            result = await analyze(segments, datetime(2026, 7, 11, tzinfo=timezone.utc), "People: Dana")
        self.assertEqual(result.summary, "Useful summary")
        self.assertFalse(FakeOllamaClient.payload["think"])
        self.assertEqual(FakeOllamaClient.payload["messages"][0]["role"], "user")


if __name__ == "__main__":
    unittest.main()
