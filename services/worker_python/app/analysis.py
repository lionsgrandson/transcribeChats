import json
import re
from datetime import datetime, timedelta

import httpx

from .schemas import Analysis, AnalysisItem, Segment
from .settings import settings

ACTION_VERBS = r"(?:ask|send|call|email|schedule|book|prepare|deliver|finish|complete|update|review|check|confirm|arrange|organize|handle|research|draft|test|investigate|remind|follow\s+up|pay|buy|submit|upload|create|fix|contact|share|write|do|make)"
ENGLISH_TASK_RE = re.compile(rf"(?:\b(?:(?:i|we)\s+(?:will|shall|must|have\s+to|need\s+to|am\s+going\s+to|are\s+going\s+to|committed\s+to)|you\s+(?:must|have\s+to|need\s+to)|(?:please|can\s+you|could\s+you))\s+{ACTION_VERBS}\b|^\s*(?:please\s+)?{ACTION_VERBS}\b)", re.I)
HEBREW_TASK_RE = re.compile(r"(?:אני|אנחנו)\s+(?:אשלח|נשלח|אתקשר|נתקשר|אכין|נכין|אסיים|נסיים|אעדכן|נעדכן|אקבע|נקבע|אטפל|נטפל)|(?:בבקשה|נא)\s+(?:שלח|תשלח|התקשר|תתקשר|תכין|תעדכן|תקבע)", re.I)
MEETING_RE = re.compile(r"\b(?:let'?s|we\s+will|can\s+we|please)\s+(?:(?:have|schedule|book)\s+)?(?:a\s+)?(?:meeting|call|appointment)\b|\b(?:schedule|book)\s+(?:a\s+)?(?:meeting|call|appointment)\b|(?:בואו?|נקבע)\s+(?:פגישה|ישיבה|שיחה)", re.I)
DECISION_RE = re.compile(r"\b(?:we\s+decided|we\s+agreed|decision:)\b|(?:החלטנו|סיכמנו)", re.I)
NOTE_SIGNAL_RE = re.compile(r"\b(?:offline|unavailable|birthday|anniversary|family|trip|travel|transportation|timing|schedule|vacation|blocked|blocker|risk|important|remember|status|waiting|depends?|preference|decided|agreed)\b|(?:לא זמין|יום הולדת|יום נישואין|משפחה|נסיעה|תחבורה|חסום|סיכון|חשוב|לזכור|סטטוס|החלטנו|סיכמנו)", re.I)


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
    # Spoken wall-clock times such as "tomorrow at 10" refer to the user's local
    # conversation time. Return a timezone-free value so the client persists it
    # in its configured local timezone instead of shifting it by the UTC offset.
    return value.replace(tzinfo=None).isoformat()


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


def _tokens(value: str) -> set[str]:
    return {token.casefold() for token in re.findall(r"[\w\u0590-\u05ff]+", value) if len(token) > 1}


def _best_source_ids(item: AnalysisItem, segments: list[Segment]) -> list[str]:
    valid = {segment.id for segment in segments if segment.id}
    supplied = [source for source in item.sourceSegmentIds if source in valid]
    if supplied:
        return supplied
    wanted = _tokens(f"{item.title} {item.body or ''}")
    scored = []
    for segment in segments:
        if not segment.id:
            continue
        segment_tokens = _tokens(segment.text)
        score = len(wanted & segment_tokens) / max(len(wanted), 1)
        scored.append((score, segment.id))
    if not scored:
        return []
    score, source = max(scored, key=lambda value: value[0])
    return [source] if score > 0.0 else []


def _merge_rule_items(result: Analysis, segments: list[Segment], conversation_date: datetime) -> None:
    for candidate in analyze_rules(segments, conversation_date).items:
        candidate_sources = set(candidate.sourceSegmentIds)
        duplicate = any(
            item.kind == candidate.kind and candidate_sources.intersection(item.sourceSegmentIds)
            for item in result.items
        )
        if not duplicate:
            result.items.append(candidate)


def _similar_text(left: str, right: str) -> bool:
    left_tokens = _tokens(left)
    right_tokens = _tokens(right)
    if not left_tokens or not right_tokens:
        return False
    return len(left_tokens & right_tokens) / min(len(left_tokens), len(right_tokens)) >= 0.7


def _remove_action_only_notes(result: Analysis, segments: list[Segment]) -> None:
    action_sources = {
        source
        for item in result.items if item.kind in {"task", "event"}
        for source in item.sourceSegmentIds
    }
    kept: list[AnalysisItem] = []
    for item in result.items:
        source_text = " ".join(segment.text for segment in segments if segment.id in item.sourceSegmentIds)
        action_only_note = (
            item.kind in {"note", "takeaway", "summary"}
            and bool(item.sourceSegmentIds)
            and set(item.sourceSegmentIds).issubset(action_sources)
            and bool(ENGLISH_TASK_RE.search(source_text) or HEBREW_TASK_RE.search(source_text) or MEETING_RE.search(source_text))
            and not NOTE_SIGNAL_RE.search(source_text)
        )
        if not action_only_note:
            kept.append(item)
    result.items = kept


def _ensure_meaningful_notes(result: Analysis, segments: list[Segment]) -> None:
    existing_notes = [item for item in result.items if item.kind in {"note", "takeaway", "summary"}]
    candidates: list[tuple[int, int, Segment, str]] = []
    for segment in segments:
        if not segment.id:
            continue
        sentences = list(filter(None, re.split(r"(?<=[.!?])\s+|\n+", segment.text.strip())))
        for sentence in sentences:
            token_count = len(_tokens(sentence))
            if token_count < 5 or ENGLISH_TASK_RE.search(sentence) or HEBREW_TASK_RE.search(sentence) or MEETING_RE.search(sentence):
                continue
            signaled = bool(NOTE_SIGNAL_RE.search(sentence) or DECISION_RE.search(sentence))
            if signaled or token_count >= 9:
                candidates.append((1 if signaled else 0, token_count, segment, sentence))

    candidates.sort(key=lambda value: (value[0], value[1]), reverse=True)
    for _, _, segment, sentence in candidates:
        if len(existing_notes) >= 12:
            break
        if any(_similar_text(sentence, f"{item.title} {item.body or ''}") for item in existing_notes):
            continue
        note = AnalysisItem(
            kind="note",
            title=sentence.strip()[:180],
            body=sentence.strip(),
            status="open",
            priority="none",
            sourceSegmentIds=[segment.id],
            confidence=0.62,
            confirmed=False,
        )
        result.items.append(note)
        existing_notes.append(note)

    if existing_notes or not segments:
        return
    fallback = max((segment for segment in segments if segment.id), key=lambda segment: len(segment.text), default=None)
    if fallback and len(_tokens(fallback.text)) >= 5:
        result.items.append(AnalysisItem(
            kind="note",
            title=fallback.text.strip()[:180],
            body=fallback.text.strip(),
            status="open",
            priority="none",
            sourceSegmentIds=[fallback.id],
            confidence=0.62,
            confirmed=False,
        ))


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
- A task is allowed only for an unambiguous first-person commitment ("I will send the file") or a direct request/command ("please send the file" or "can you call Amir?").
- A statement about what another person may do, a prediction, or a future fact is a note unless the transcript explicitly records an accepted assignment.
- Do not convert advice, predictions, opinions, descriptions, or phrases like "you need to understand" into tasks.
- An event is allowed only for an explicit proposal to schedule/have a meeting, call, or appointment. Ordinary mentions of meetings are not events.
- Preserve a meeting proposal without a date as needs_review with startsAt null. Never invent a date or time.
- Every task/event must be needs_review and confirmed=false.
- Every extracted item must include sourceSegmentIds using only the exact segment `id` values shown in the transcript.
- Extract important factual notes and explicit decisions as note/takeaway items. This includes family plans, travel and transportation details, birthdays, anniversaries, availability, status updates, blockers, risks, preferences, ownership information, reminders, and facts someone would want to find later.
- A date, factual statement, or general recommendation is a note, not a task. A task requires an explicit commitment or direct request for a concrete action.
- Notes are first-class output. Return a separate sourced note for every distinct useful topic even when tasks or events also exist. One event is not a complete result for a multi-topic transcript.
- For a substantive transcript, return useful notes even when there are no tasks or events. Do not return an empty items list merely because nothing is actionable.
- Return a useful concise summary even when there are no actionable items.
- Dated tasks and events create the timeline. Never invent dates.
- Every date field must contain an exact ISO 8601 value or null. Never put natural-language dates such as "tomorrow" or "next weekend" in a date field.
- Put the overall summary only in the top-level summary field; do not create an item with kind summary.
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
            "keep_alive": "5m",
            "options": {"temperature": 0},
        })
        response.raise_for_status()
        payload = response.json()
        content = payload.get("message", {}).get("content", "").strip()
        if not content:
            raise RuntimeError(f"Ollama returned no final analysis (reason: {payload.get('done_reason', 'unknown')}).")
        result = Analysis.model_validate_json(content)
        _merge_rule_items(result, segments, conversation_date)
        for item in result.items:
            item.sourceSegmentIds = _best_source_ids(item, segments)
            source_text = " ".join(segment.text for segment in segments if segment.id in item.sourceSegmentIds)
            if item.kind == "task" and source_text and not (ENGLISH_TASK_RE.search(source_text) or HEBREW_TASK_RE.search(source_text)):
                item.kind = "note"
                item.assignee = None
                item.dueAt = None
                item.priority = "none"
            if item.kind == "summary":
                item.kind = "note"
                item.priority = "none"
            item.confirmed = False
            if item.kind in {"task", "event"}:
                item.status = "needs_review"
            else:
                item.status = "open"
            if item.kind == "task":
                item.startsAt = None
                item.endsAt = None
                source_due_at = _date(source_text, conversation_date) if source_text else None
                if source_due_at:
                    item.dueAt = source_due_at
            if item.kind == "event":
                item.dueAt = None
                source_starts_at = _date(source_text, conversation_date) if source_text else None
                if source_starts_at:
                    item.startsAt = source_starts_at
            if item.kind == "event" and not item.startsAt and not item.uncertaintyReason:
                item.uncertaintyReason = "Add a date and time before accepting this event into the calendar."
        _remove_action_only_notes(result, segments)
        _ensure_meaningful_notes(result, segments)
        if not result.summary.strip():
            result.summary = " ".join(segment.text.strip() for segment in segments[:4])[:800]
        return result
