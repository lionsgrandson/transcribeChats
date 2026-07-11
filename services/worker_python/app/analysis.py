import json
import re
from datetime import datetime, timedelta

import httpx

from .schemas import Analysis, AnalysisItem, Segment
from .settings import settings

TASK_RE = re.compile(r"\b(will|need to|needs to|should|action item|follow up|send|prepare|finish|call|email)\b|צריך|צריכה|אשלח|ישלח|תשלח|להכין|לסיים|לטפל|משימה", re.I)
EVENT_RE = re.compile(r"\b(meeting|review|appointment|birthday|offline|vacation|deadline|launch)\b|פגישה|ישיבה|סקירה|יום הולדת|חופש|לא זמין|השקה", re.I)
TAKEAWAY_RE = re.compile(r"\b(important|remember|decision|agreed|confirmed|blocked)\b|חשוב|לזכור|החלטה|סיכמנו|אושר|חסום", re.I)


def _relative_date(text: str, reference: datetime) -> tuple[str | None, str | None]:
    value = reference
    reason = None
    if re.search(r"tomorrow|מחר", text, re.I):
        value += timedelta(days=1)
        reason = "Relative date inferred from the conversation date."
    elif re.search(r"next week|שבוע הבא", text, re.I):
        value += timedelta(days=7)
        reason = "Relative date inferred from the conversation date."
    elif not re.search(r"today|היום", text, re.I):
        return None, None
    match = re.search(r"(?:at\s*)?(\d{1,2})(?::(\d{2}))?", text, re.I)
    value = value.replace(hour=int(match.group(1)) if match else 9, minute=int(match.group(2) or 0) if match else 0, second=0, microsecond=0)
    return value.isoformat(), reason


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
            if TASK_RE.search(sentence):
                due_at, uncertainty = _relative_date(sentence, conversation_date)
                items.append(AnalysisItem(kind="task", title=sentence[:300], priority=_priority(sentence), dueAt=due_at, uncertaintyReason=uncertainty, sourceSegmentIds=source, confidence=0.74))
            elif EVENT_RE.search(sentence):
                starts_at, uncertainty = _relative_date(sentence, conversation_date)
                items.append(AnalysisItem(kind="event", title=sentence[:300], startsAt=starts_at, uncertaintyReason=uncertainty, sourceSegmentIds=source, confidence=0.72))
            elif TAKEAWAY_RE.search(sentence):
                items.append(AnalysisItem(kind="takeaway", title=sentence[:300], status="open", sourceSegmentIds=source, confidence=0.68))
    summary = " ".join(segment.text.strip() for segment in segments[:4])[:800]
    return Analysis(summary=summary, items=items)


async def analyze(segments: list[Segment], conversation_date: datetime, context: str) -> Analysis:
    if not settings.ollama_url:
        return analyze_rules(segments, conversation_date)
    transcript = "\n".join(f"[{segment.start_ms}] {segment.speaker_label}: {segment.text}" for segment in segments)
    prompt = f"""Extract tasks, events, notes, and takeaways from this Hebrew/English transcript.
Return JSON with summary and items. Do not invent dates or assignees. Conversation date: {conversation_date.isoformat()}.
Context: {context}
Transcript:\n{transcript}"""
    schema = Analysis.model_json_schema()
    async with httpx.AsyncClient(timeout=180) as client:
        response = await client.post(f"{settings.ollama_url.rstrip('/')}/api/generate", json={"model": settings.ollama_model, "prompt": prompt, "format": schema, "stream": False})
        response.raise_for_status()
        content = response.json().get("response", "{}")
        return Analysis.model_validate(json.loads(content))
