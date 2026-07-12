import sys
import unittest
from unittest.mock import patch
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.analysis import ENGLISH_TASK_RE, _best_source_ids, _ensure_meaningful_notes, _merge_rule_items, _remove_action_only_notes, analyze, analyze_rules  # noqa: E402
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


class FakeDatedEventResponse(FakeOllamaResponse):
    def json(self):
        return {"message": {"content": '{"summary":"Launch planning","items":[{"kind":"event","title":"Launch meeting","startsAt":"2026-07-12T17:00:00Z","sourceSegmentIds":["s1"]}]}'}, "done_reason": "stop"}


class FakeDatedEventClient(FakeOllamaClient):
    async def post(self, url, json):
        FakeOllamaClient.payload = json
        return FakeDatedEventResponse()


class AnalysisTests(unittest.TestCase):
    def test_normalizes_invalid_model_fields_before_the_ui_receives_them(self):
        item = AnalysisItem.model_validate({
            "kind": "event",
            "title": "Meeting mention",
            "startsAt": "tomorrow afternoon",
            "tags": None,
            "sourceSegmentIds": None,
        })
        self.assertIsNone(item.startsAt)
        self.assertEqual(item.tags, [])
        self.assertEqual(item.sourceSegmentIds, [])

    def test_extracts_english_task_and_relative_date(self):
        segments = [Segment(id="s1", sequence_no=0, start_ms=0, end_ms=1000, text="I will send the final email tomorrow at 10.")]
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

    def test_third_person_future_statement_is_not_a_task(self):
        self.assertIsNone(ENGLISH_TASK_RE.search("Dana will be offline next week."))
        self.assertIsNotNone(ENGLISH_TASK_RE.search("I will send the report tomorrow."))
        self.assertIsNotNone(ENGLISH_TASK_RE.search("I need to ask my significant other about the chocolate factory."))
        self.assertIsNotNone(ENGLISH_TASK_RE.search("Ask my significant other about the chocolate factory."))

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

    def test_enriches_a_sparse_event_only_result_with_strict_tasks_and_notes(self):
        segments = [
            Segment(id="s1", sequence_no=0, start_ms=0, end_ms=1000, text="Amit's birthday and cancer anniversary are important family dates to remember."),
            Segment(id="s2", sequence_no=1, start_ms=1000, end_ms=2000, text="I need to ask my significant other about the chocolate factory."),
            Segment(id="s3", sequence_no=2, start_ms=2000, end_ms=3000, text="Let's have a family meeting tomorrow at 14:00."),
        ]
        result = Analysis(summary="Family planning", items=[
            AnalysisItem(kind="event", title="Family meeting", sourceSegmentIds=["s3"]),
            AnalysisItem(kind="note", title="Chocolate factory inquiry", sourceSegmentIds=["s2"]),
        ])
        _merge_rule_items(result, segments, datetime(2026, 7, 12, tzinfo=timezone.utc))
        _remove_action_only_notes(result, segments)
        _ensure_meaningful_notes(result, segments)
        self.assertEqual(len([item for item in result.items if item.kind == "event"]), 1)
        self.assertEqual(len([item for item in result.items if item.kind == "task"]), 1)
        notes = [item for item in result.items if item.kind == "note"]
        self.assertGreaterEqual(len(notes), 1)
        self.assertEqual(notes[0].sourceSegmentIds, ["s1"])
        self.assertFalse(any(item.sourceSegmentIds == ["s2"] for item in notes))


class OllamaAnalysisTests(unittest.IsolatedAsyncioTestCase):
    async def test_disables_thinking_and_parses_structured_chat_output(self):
        segments = [Segment(id="s1", sequence_no=0, start_ms=0, end_ms=1000, text="We decided to ship Friday.")]
        with patch.object(settings, "ollama_url", "http://ollama"), patch("app.analysis.httpx.AsyncClient", FakeOllamaClient):
            result = await analyze(segments, datetime(2026, 7, 11, tzinfo=timezone.utc), "People: Dana")
        self.assertEqual(result.summary, "Useful summary")
        self.assertFalse(FakeOllamaClient.payload["think"])
        self.assertEqual(FakeOllamaClient.payload["messages"][0]["role"], "user")
        self.assertEqual(FakeOllamaClient.payload["keep_alive"], "5m")

    async def test_uses_the_explicit_source_time_instead_of_model_timezone_drift(self):
        segments = [Segment(id="s1", sequence_no=0, start_ms=0, end_ms=1000, text="Let's have a launch meeting tomorrow at 14:00.")]
        with patch.object(settings, "ollama_url", "http://ollama"), patch("app.analysis.httpx.AsyncClient", FakeDatedEventClient):
            result = await analyze(segments, datetime(2026, 7, 11, tzinfo=timezone.utc), "")
        self.assertEqual(result.items[0].kind, "event")
        self.assertEqual(result.items[0].startsAt, "2026-07-12T14:00:00")


if __name__ == "__main__":
    unittest.main()
