import json
import re
from datetime import datetime, timedelta

import httpx

from .schemas import Analysis, AnalysisItem, Segment
from .settings import settings

ACTION_VERBS = r"(?:send|call|email|schedule|book|prepare|deliver|finish|update|review|follow\s+up|pay|buy|submit|upload|create|fix|contact|share|write)"
ENGLISH_TASK_RE = re.compile(rf"\b(?:(?:i|we|you|[A-Z][a-z]+)\s+(?:will|shall|must|have\s+to|am\s+going\s+to|are\s+going\s+to|committed\s+to)|(?:please|can\s+you|could\s+you))\s+{ACTION_VERBS}\b", re.I)
HEBREW_TASK_RE = re.compile(r"(?:אני|אנחנו)\s+(?:אשלח|נשלח|אתקשר|נתקשר|אכין|נכין|אסיים|נסיים|אעדכן|נעדכן|אקבע|נקבע|אטפל|נטפל)|(?:בבקשה|נא)\s+(?:שלח|תשלח|התקשר|תתקשר|תכין|תעדכן|תקבע)", re.I)
MEETING_RE = re.compile(r"\b(?:let'?s|we\s+will|can\s+we|please)\s+(?:(?:have|schedule|book)\s+)?(?:a\s+)?(?:meeting|call|appointment)\b|\b(?:schedule|book)\s+(?:a\s+)?(?:meeting|call|appointment)\b|(?:בואו?|נקבע)\s+(?:פגישה|ישיבה|שיחה)", re.I)
DECISION_RE = re.compile(r"\b(?:we\s+decided|we\s+agreed|decision:)\b|(?:החלטנו|סיכמנו)", re.I)


def _date(text: str, reference: datetime) -> str | None:
    value = reference
    iso_match = re.search(r"\b(20\d{2})-(\d{1,2})-(\d{1,2})\b", text)
    if iso_match:
        value = value.replace(year=int(iso_match.group(1)), month=int(iso_match.group(2)), day=int(iso_match.group(3)))
    elif re.search(r"tomorrow|מחר", text, re.I):
        value += timedelta(days=1)
    elif re.search(r"next week|שבוע הבא", text, re.I):
        value += timedelta(days=7)
    elif not re.search(r"today|היום", text, re.I):
        return None
    time_match = re.search(r"(?:at|בשעה)\s*(\d{1,2})(?::(\d{2}))?", text, re.I)
    value = value.replace(hour=int(time_match.group(1)) if time_match else 9, minute=int(time_match.group(2) or 0) if time_match else 0, second=0, microsecond=0)
    return value.isoformat()


def _priority(text: str) -> str:
    if re.search(r"urgent|asap|immediately|דחוף|מייד", text, re.I):
        return "urgent"
    if re.search(r"important|high priority|חשוב|עדיפות גבוהה", text, re.I):
        return "high"
    return "medium"


def analyze_rules(segments: list[Segment], conversation_date: datetime) -> Analysis:
    items: list[AnalysisItem] = []
    for segment in segments:
        for sentence in filter(None, re.split(r"(?<=[.!?])\s+|\n+", segment.text.strip())):
            source = [segment.id] if segment.id else []
            if MEETING_RE.search(sentence):
                starts_at = _date(sentence, conversation_date)
                items.append(AnalysisItem(kind="event", title=sentence[:300], status="needs_review", startsAt=starts_at, uncertaintyReason=None if starts_at else "Add a date and time before accepting this event into the calendar.", sourceSegmentIds=source, confidence=0.9 if starts_at else 0.72))
            elif ENGLISH_TASK_RE.search(sentence) or HEBREW_TASK_RE.search(sentence):
                items.append(AnalysisItem(kind="task", title=sentence[:300], status="needs_review", priority=_priority(sentence), dueAt=_date(sentence, conversation_date), sourceSegmentIds=source, confidence=0.9))
            elif DECISION_RE.search(sentence):
                items.append(AnalysisItem(kind="takeaway", title=sentence[:300], status="open", sourceSegmentIds=source, confidence=0.86))
    summary = " ".join(segment.text.strip() for segment in segments[:4])[:800]
    return Analysis(summary=summary, items=items)


async def analyze(segments: list[Segment], conversation_date: datetime, context: str) -> Analysis:
    if not settings.ollama_url:
        raise RuntimeError("Ollama is not configured for the transcription worker.")
    transcript = "\n".join(
        f'<segment id="{segment.id or ""}" start_ms="{segment.start_ms}" speaker="{segment.speaker_label}">{segment.text}</segment>'
        for segment in segments
    )
    schema = Analysis.model_json_schema()
    prompt = f"""Analyze this Hebrew/English transcript and produce the complete workspace output.

Rules:
- A task is allowed only when a speaker explicitly commits a person to a concrete action, e.g. "Dana will send the file" or "please call Amir".
- Do not convert advice, predictions, opinions, descriptions, or phrases like "you need to understand" into tasks.
- An event is allowed only for an explicit proposal to schedule/have a meeting, call, or appointment. Ordinary mentions of meetings are not events.
- Preserve a meeting proposal without a date as needs_review with startsAt null. Never invent a date or time.
- Every task/event must be needs_review and confirmed=false.
- Every extracted item must include sourceSegmentIds using only the exact segment `id` values shown in the transcript.
- Extract important factual notes and explicit decisions as note/takeaway items. Do not turn them into tasks.
- Return a useful concise summary even when there are no actionable items.
- Dated tasks and events create the timeline. Never invent dates.
- Use participant names and domain terms from Context only when supported by the transcript.
- Output only JSON matching this schema: {json.dumps(schema, ensure_ascii=False)}

Conversation date: {conversation_date.isoformat()}
Context: {context}
Transcript:\n{transcript}"""
    async with httpx.AsyncClient(timeout=900) as client:
        response = await client.post(f"{settings.ollama_url.rstrip('/')}/api/chat", json={
            "model": settings.ollama_model,
            "messages": [{"role": "user", "content": prompt}],
            "format": schema,
            "stream": False,
            "think": False,
            "keep_alive": 0,
            "options": {"temperature": 0},
        })
        response.raise_for_status()
        payload = response.json()
        content = payload.get("message", {}).get("content", "").strip()
        if not content:
            raise RuntimeError(f"Ollama returned no final analysis (reason: {payload.get('done_reason', 'unknown')}).")
        result = Analysis.model_validate_json(content)
        valid_sources = {segment.id for segment in segments if segment.id}
        for item in result.items:
            item.sourceSegmentIds = [source for source in item.sourceSegmentIds if source in valid_sources]
            item.confirmed = False
            if item.kind in {"task", "event"}:
                item.status = "needs_review"
            else:
                item.status = "open"
            if item.kind == "task":
                item.startsAt = None
                item.endsAt = None
            if item.kind == "event":
                item.dueAt = None
            if item.kind == "event" and not item.startsAt and not item.uncertaintyReason:
                item.uncertaintyReason = "Add a date and time before accepting this event into the calendar."
        if not result.summary.strip():
            result.summary = " ".join(segment.text.strip() for segment in segments[:4])[:800]
        return result
