import json
import re
from datetime import datetime, timedelta

import httpx

from .schemas import Analysis, AnalysisItem, Segment
from .settings import settings
from .transcript_quality import sanitize_segments

ACTION_VERBS = r"(?:ask|send|call|email|schedule|book|prepare|deliver|finish|complete|update|review|check|confirm|arrange|organize|handle|research|draft|test|investigate|remind|follow\s+up|pay|buy|submit|upload|create|fix|contact|share|write|implement|build|change|add|remove|backup|migrate)"
ENGLISH_TASK_RE = re.compile(
    rf"(?:\b(?:(?:i|we)\s+(?:will|shall|must|have\s+to|need\s+to|am\s+going\s+to|are\s+going\s+to|committed\s+to)|(?:i|we)['’]ll|you\s+(?:must|have\s+to|need\s+to)|(?:please|can\s+you|could\s+you|would\s+you|will\s+you))\s+{ACTION_VERBS}\b|^\s*(?:please\s+)?{ACTION_VERBS}\b)",
    re.I,
)
HEBREW_TASK_RE = re.compile(
    r"(?:אני|אנחנו)\s+(?:אשלח|נשלח|אתקשר|נתקשר|אכין|נכין|אסיים|נסיים|אעדכן|נעדכן|אקבע|נקבע|אטפל|נטפל|אבדוק|נבדוק|אאשר|נאשר|אסדר|נסדר|אארגן|נארגן|אחקור|נחקור|אכתוב|נכתוב|אצור|ניצור|אתקן|נתקן|אעלה|נעלה|אבנה|נבנה|אשלם|נשלם|אגבה|נגבה)"
    r"|(?:אני|אנחנו)\s+(?:צריך|צריכה|צריכים|חייב|חייבת|חייבים)\s+ל(?:שלוח|התקשר|הכין|סיים|עדכן|קבוע|טפל|בדוק|אשר|סדר|ארגן|חקור|כתוב|יצור|תקן|העלות|בנות|שלם|גבות)"
    r"|(?:בבקשה|נא)\s+(?:שלח|תשלח|התקשר|תתקשר|תכין|תסיים|תעדכן|תקבע|תטפל|תבדוק|תאשר|תסדר|תארגן|תחקור|תכתוב|תיצור|תתקן|תעלה|תבנה|תשלם|תגבה)"
    r"|^\s*(?:שלח|תשלח|התקשר|תתקשר|תכין|תסיים|תעדכן|תקבע|תטפל|תבדוק|תאשר|תסדר|תארגן|תחקור|תכתוב|תיצור|תתקן|תעלה|תבנה|תשלם|תגבה)\b",
    re.I,
)
NON_ACTION_RE = re.compile(
    r"\b(?:need\s+to|have\s+to|must)\s+(?:understand|know|remember|realize|consider|think|feel)\b"
    r"|(?:צריך|צריכה|צריכים|חייב|חייבת|חייבים)\s+ל(?:הבין|דעת|זכור|חשוב|שקול|הרגיש)",
    re.I,
)
EVENT_NOUN_RE = re.compile(
    r"\b(?:meeting|call|appointment|demo|interview|workshop|visit|presentation|launch|delivery|trip|flight|deadline|renewal|expiration)\b"
    r"|(?:פגישה|ישיבה|שיחה|שיחת|דמו|ראיון|סדנה|ביקור|מצגת|השקה|אספקה|נסיעה|טיסה|דדליין|חידוש|תפוגה)",
    re.I,
)
MEETING_RE = re.compile(
    r"\b(?:let'?s|can\s+we|please)\b.{0,70}\b(?:meeting|call|appointment)\b"
    r"|\b(?:we\s+will)\b.{0,45}\b(?:have|schedule|book)\b.{0,35}\b(?:meeting|call|appointment)\b"
    r"|\b(?:schedule|book)\b.{0,35}\b(?:meeting|call|appointment)\b"
    r"|(?:בואו?|נקבע).{0,45}(?:פגישה|ישיבה|שיחה)",
    re.I,
)
PLANNED_EVENT_RE = re.compile(
    r"\b(?:there\s+(?:is|will\s+be)|we\s+have|i\s+have|is\s+scheduled|is\s+planned|is\s+booked|is\s+set|will\s+be)\b"
    r"|(?:יש\s+(?:לנו|לי)?|תהיה|יהיה|נקבעה|נקבע|קבענו|מתוכננת|מתוכנן|סגורה|סגור)\s*",
    re.I,
)
PAST_EVENT_RE = re.compile(
    r"\b(?:had\s+(?:a\s+)?(?:meeting|call|appointment)|yesterday|last\s+(?:week|monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b"
    r"|(?:הייתה\s+(?:פגישה|ישיבה|שיחה)|היה\s+(?:דמו|ראיון|ביקור)|אתמול|שבוע\s+שעבר|נפגשנו)",
    re.I,
)
DECISION_RE = re.compile(r"\b(?:we\s+decided|we\s+agreed|decision:)\b|(?:החלטנו|סיכמנו)", re.I)
NOTE_SIGNAL_RE = re.compile(
    r"\b(?:risk|important|status|waiting|depends?|preference|budget|cost|price|inventory|warehouse|accounting|crm|erp|integration|migration|backup|supplier|customer|client|system|platform|company|contract|invoice|order|data|api)\b"
    r"|(?:סיכון|חשוב|סטטוס|תקציב|עלות|מחיר|מלאי|מחסן|הנהלת\s+חשבונות|אינטגרציה|הגירה|גיבוי|ספק|לקוח|מערכת|חברה|חוזה|חשבונית|הזמנה|נתונים)",
    re.I,
)

ENGLISH_WEEKDAYS = {"monday": 0, "tuesday": 1, "wednesday": 2, "thursday": 3, "friday": 4, "saturday": 5, "sunday": 6}
HEBREW_WEEKDAYS = {"שני": 0, "שלישי": 1, "רביעי": 2, "חמישי": 3, "שישי": 4, "שבת": 5, "ראשון": 6}


def _has_explicit_time(text: str) -> bool:
    return bool(re.search(r"\b(?:[01]?\d|2[0-3]):[0-5]\d\b", text) or re.search(r"(?:\bat\b|בשעה|ב-)\s*(?:[01]?\d|2[0-3])\b", text, re.I))


def _time_parts(text: str) -> tuple[int, int] | None:
    match = re.search(r"\b([01]?\d|2[0-3]):([0-5]\d)\b", text)
    if match:
        return int(match.group(1)), int(match.group(2))
    match = re.search(r"(?:\bat\b|בשעה|ב-)\s*([01]?\d|2[0-3])\b", text, re.I)
    return (int(match.group(1)), 0) if match else None


def _weekday_value(text: str, reference: datetime) -> datetime | None:
    target = None
    for name, value in ENGLISH_WEEKDAYS.items():
        if re.search(rf"\b{name}\b", text, re.I):
            target = value
            break
    if target is None:
        for name, value in HEBREW_WEEKDAYS.items():
            if re.search(rf"(?:ביום\s+|יום\s+|ב)?{name}\b", text):
                target = value
                break
    if target is None:
        return None
    delta = (target - reference.weekday()) % 7
    return reference + timedelta(days=delta)


def _date(text: str, reference: datetime) -> str | None:
    value = reference
    found = False
    iso = re.search(r"\b(20\d{2})-(\d{1,2})-(\d{1,2})\b", text)
    slash = re.search(r"\b(\d{1,2})[./](\d{1,2})(?:[./](20\d{2}|\d{2}))?\b", text)
    if iso:
        value = value.replace(year=int(iso.group(1)), month=int(iso.group(2)), day=int(iso.group(3)))
        found = True
    elif slash:
        year = int(slash.group(3)) if slash.group(3) else value.year
        if year < 100:
            year += 2000
        try:
            value = value.replace(year=year, month=int(slash.group(2)), day=int(slash.group(1)))
            found = True
        except ValueError:
            return None
    elif re.search(r"day\s+after\s+tomorrow|מחרתיים", text, re.I):
        value += timedelta(days=2); found = True
    elif re.search(r"tomorrow|מחר", text, re.I):
        value += timedelta(days=1); found = True
    elif re.search(r"today|היום", text, re.I):
        found = True
    else:
        days = re.search(r"\bin\s+(\d{1,2})\s+days?\b|בעוד\s+(\d{1,2})\s+ימים", text, re.I)
        if days:
            value += timedelta(days=int(days.group(1) or days.group(2))); found = True
        else:
            weekday = _weekday_value(text, reference)
            if weekday is not None:
                value = weekday; found = True
    if not found:
        return None
    hour, minute = _time_parts(text) or (0, 0)
    return value.replace(hour=hour, minute=minute, second=0, microsecond=0, tzinfo=None).isoformat()


def _priority(text: str) -> str:
    if re.search(r"urgent|asap|immediately|דחוף|מייד", text, re.I): return "urgent"
    if re.search(r"important|high priority|חשוב|עדיפות גבוהה", text, re.I): return "high"
    return "medium"


def _is_explicit_task(text: str) -> bool:
    return not NON_ACTION_RE.search(text) and bool(ENGLISH_TASK_RE.search(text) or HEBREW_TASK_RE.search(text))


def _looks_like_planned_event(text: str, reference: datetime) -> bool:
    if not EVENT_NOUN_RE.search(text) or PAST_EVENT_RE.search(text): return False
    if MEETING_RE.search(text) or PLANNED_EVENT_RE.search(text): return True
    return _date(text, reference) is not None and not _is_explicit_task(text)


def _date_only_meta(text: str, date_value: str | None, event: bool) -> tuple[list[str], str | None]:
    if not date_value or _has_explicit_time(text): return [], None
    return ["date-only"], ("The date is stated, but the time is not. Add the real time before accepting this event into the calendar." if event else "The due date is stated, but no time was given.")


def analyze_rules(segments: list[Segment], conversation_date: datetime) -> Analysis:
    items: list[AnalysisItem] = []
    for segment in segments:
        for sentence in filter(None, re.split(r"(?<=[.!?])\s+|\n+", segment.text.strip())):
            source = [segment.id] if segment.id else []
            if _is_explicit_task(sentence):
                due = _date(sentence, conversation_date); tags, reason = _date_only_meta(sentence, due, False)
                items.append(AnalysisItem(kind="task", title=sentence[:300], status="needs_review", priority=_priority(sentence), dueAt=due, tags=tags, uncertaintyReason=reason, sourceSegmentIds=source, confidence=0.9, confirmed=False))
            elif _looks_like_planned_event(sentence, conversation_date):
                start = _date(sentence, conversation_date); tags, reason = _date_only_meta(sentence, start, True)
                if not start: reason = "The event is explicit, but its date/time is not. Add it before accepting this event into the calendar."
                items.append(AnalysisItem(kind="event", title=sentence[:300], status="needs_review", startsAt=start, tags=tags, uncertaintyReason=reason, sourceSegmentIds=source, confidence=0.88 if start else 0.74, confirmed=False))
            elif DECISION_RE.search(sentence):
                items.append(AnalysisItem(kind="takeaway", title=sentence[:300], body=sentence.strip(), status="open", sourceSegmentIds=source, confidence=0.86, confirmed=False))
    return Analysis(summary=" ".join(s.text.strip() for s in segments[:4])[:800], items=items)


def _tokens(value: str) -> set[str]:
    return {token.casefold() for token in re.findall(r"[\w\u0590-\u05ff]+", value) if len(token) > 1}


def _similar_text(left: str, right: str) -> bool:
    a, b = _tokens(left), _tokens(right)
    return bool(a and b and len(a & b) / min(len(a), len(b)) >= 0.65)


def _best_source_ids(item: AnalysisItem, segments: list[Segment]) -> list[str]:
    valid = {s.id for s in segments if s.id}
    supplied = list(dict.fromkeys(s for s in item.sourceSegmentIds if s in valid))
    if supplied: return supplied
    wanted = _tokens(f"{item.title} {item.body or ''}")
    scored = [(len(wanted & _tokens(s.text)) / max(len(wanted), 1), s.id) for s in segments if s.id]
    score, source = max(scored, default=(0, None), key=lambda row: row[0])
    return [source] if source and score > 0 else []


def _merge_rule_items(result: Analysis, segments: list[Segment], conversation_date: datetime) -> None:
    for candidate in analyze_rules(segments, conversation_date).items:
        sources = set(candidate.sourceSegmentIds)
        if not any(item.kind == candidate.kind and sources.intersection(item.sourceSegmentIds) and _similar_text(candidate.title, f"{item.title} {item.body or ''}") for item in result.items):
            result.items.append(candidate)


def _remove_action_only_notes(result: Analysis, segments: list[Segment]) -> None:
    action_sources = {sid for item in result.items if item.kind in {"task", "event"} for sid in item.sourceSegmentIds}
    segment_map = {s.id: s.text for s in segments if s.id}
    kept = []
    for item in result.items:
        source_text = " ".join(segment_map.get(sid, "") for sid in item.sourceSegmentIds)
        pure_action = item.kind in {"note", "takeaway", "summary"} and item.sourceSegmentIds and set(item.sourceSegmentIds).issubset(action_sources) and (_is_explicit_task(source_text) or MEETING_RE.search(source_text)) and not NOTE_SIGNAL_RE.search(source_text) and _similar_text(f"{item.title} {item.body or ''}", source_text)
        if not pure_action: kept.append(item)
    result.items = kept


def _ensure_meaningful_notes(result: Analysis, segments: list[Segment]) -> None:
    if any(item.kind in {"note", "takeaway", "summary"} for item in result.items): return
    candidates = []
    for segment in segments:
        if not segment.id: continue
        for sentence in filter(None, re.split(r"(?<=[.!?])\s+|\n+", segment.text.strip())):
            count = len(_tokens(sentence))
            if count < 6 or _is_explicit_task(sentence) or MEETING_RE.search(sentence): continue
            score = (2 if NOTE_SIGNAL_RE.search(sentence) else 0) + (1 if re.search(r"(?:₪|\$|€|\b\d[\d,.]*\b)", sentence) else 0)
            if score or count >= 14: candidates.append((score, count, segment, sentence))
    for _, _, segment, sentence in sorted(candidates, key=lambda row: (row[0], row[1]), reverse=True)[:4]:
        result.items.append(AnalysisItem(kind="note", title=sentence[:140], body=sentence, status="open", priority="none", sourceSegmentIds=[segment.id], confidence=0.58, uncertaintyReason="Fallback note: review wording against the source transcript.", confirmed=False))


def _dedupe(result: Analysis) -> None:
    merged: list[AnalysisItem] = []
    for item in result.items:
        duplicate = next((x for x in merged if x.kind == item.kind and ((item.kind in {"note", "takeaway"} and _similar_text(x.title, item.title)) or (item.kind in {"task", "event"} and set(x.sourceSegmentIds).intersection(item.sourceSegmentIds) and _similar_text(x.title, item.title)))), None)
        if not duplicate:
            merged.append(item); continue
        duplicate.sourceSegmentIds = list(dict.fromkeys([*duplicate.sourceSegmentIds, *item.sourceSegmentIds]))
        if len(item.body or "") > len(duplicate.body or ""): duplicate.body = item.body
        duplicate.tags = list(dict.fromkeys([*duplicate.tags, *item.tags]))
        duplicate.confidence = max(duplicate.confidence, item.confidence)
    result.items = merged


def _analysis_prompt(transcript: str, schema: dict, conversation_date: datetime, context: str, quality_notes: list[str]) -> str:
    quality = "\n".join(f"- {n}" for n in quality_notes) or "- No sanitizer warnings."
    return f"""Analyze this Hebrew/English conversation as a careful CRM/workspace analyst. Accuracy and evidence matter more than item count.

CLASSIFICATION
- TASK: only an explicit first-person commitment ("I will send it" / "אני אשלח") or a direct request/command ("please send", "can you call Dana?"). Never turn advice, wishes, predictions, explanations, or "you need to understand" into tasks.
- EVENT/TIMELINE: a future meeting, call, appointment, visit, demo, launch, delivery, trip, flight or other dated occurrence belongs on the timeline even when phrased as a fact. "There is a meeting on Thursday" => event, NOT task. A request to arrange/schedule a meeting is a task; add an event only if the meeting itself is established.
- Exact date/day with no time: startsAt/dueAt uses 00:00 only as a date anchor, tag it `date-only`, and say the time was not stated. Never imply midnight is real. If no exact date exists, leave the field null. Never invent dates/times.
- Every task/event: status=`needs_review`, confirmed=false.

NOTES / CONTEXT INTELLIGENCE
- Create one consolidated sourced note for EVERY important company, product, system, project, person, or substantial topic actually discussed.
- Notes should NOT be transcript snippets. Title: `Entity/topic — key conclusion`. Body: 2-5 useful sentences covering what it means IN THIS CONVERSATION, its role/relationship, what was said, dependencies/risks/constraints, decisions, and unresolved questions.
- Merge mentions across the transcript and cite all relevant sourceSegmentIds. Explain how systems/companies connect to the workflow/project.
- Do not add outside facts. Distinguish a speaker's description/opinion from verified fact (e.g. "The speaker described...").
- Preserve numbers and attribution exactly. If ₪2,000,000 is mentioned, attach it only to what the speaker said it referred to; never a nearby company by association.
- Capture decisions as takeaways and important blockers, ownership, integrations, migration plans, budgets, requirements, preferences, risks and open questions as notes.

SUMMARY
- Summarize the WHOLE conversation: objective, important entities/systems and roles, current direction/decisions, significant figures with correct attribution, dependencies/risks, timeline items, and unresolved questions/next steps.
- If transcript quality is uncertain, say so briefly; never infer motives, personality, mental state, gender or behavior from ASR artifacts/repetition.

EVIDENCE
- Every item must use only exact segment ids below. Multiple source ids are encouraged for synthesized notes.
- Put overall summary only in top-level summary; no `summary` item.
- Use names/domain terms from Context only when supported by transcript.
- Date fields: ISO 8601 or null only.
- Output only JSON matching schema: {json.dumps(schema, ensure_ascii=False)}

Conversation date: {conversation_date.isoformat()}
Context: {context}
Transcript quality notes:\n{quality}
Transcript:\n{transcript}"""


def _verification_prompt(transcript: str, draft: Analysis, schema: dict, conversation_date: datetime, context: str) -> str:
    return f"""Audit and correct the draft analysis below against the transcript. Transcript is the only authority. Return complete Analysis JSON only.

Check every item:
1. Remove/convert false tasks; a task requires explicit commitment/direct request.
2. Future planned/datetime meetings and occurrences are events, including factual wording like "there is a meeting Thursday". Do not call them tasks unless someone is asked to arrange them.
3. Every important company/system/project/topic has a consolidated sourced note with useful body context, not a copied sentence.
4. Re-check money, dates, company roles, integrations, migrations and dependencies for correct subject/attribution.
5. Merge duplicates; never invent external facts, motives, identities, dates, times or assignments.
6. Source ids must exist in transcript. Summary must cover the whole conversation.
7. Day/date without time uses 00:00 only as date anchor + `date-only` + explicit unknown-time warning.
8. task/event => needs_review + confirmed=false; notes/takeaways => open + confirmed=false.

Conversation date: {conversation_date.isoformat()}\nContext: {context}\nSchema: {json.dumps(schema, ensure_ascii=False)}\nDRAFT:\n{draft.model_dump_json()}\nTRANSCRIPT:\n{transcript}"""



SALES_CATEGORY_TAGS = {
    "sales:business-context",
    "sales:needs",
    "sales:budget",
    "sales:authority",
    "sales:urgency",
    "sales:price-sensitivity",
    "sales:objection",
    "sales:buying-signal",
    "sales:communication",
    "sales:proposal",
    "sales:next-question",
    "sales:unknown",
}


def _sales_analysis_prompt(transcript: str, schema: dict, conversation_date: datetime, context: str, quality_notes: list[str]) -> str:
    quality = "\n".join(f"- {note}" for note in quality_notes) or "- No sanitizer warnings."
    return f"""Analyze this Hebrew/English client conversation as an evidence-first B2B sales intelligence analyst.

GOAL
Create a practical post-meeting deal brief from what was actually said. Focus on project purchasing signals, not personal profiling.

REQUIRED COVERAGE
- Business context and current situation.
- Needs, pain points, desired outcomes, constraints and implementation concerns.
- Budget: separate explicit budget/price statements from inference. You may estimate a PROJECT purchasing range only when concrete transcript evidence supports it, such as explicit prices, scope or phase tradeoffs, procurement limits, budget reactions, or comparable project figures. Never invent a number from tone, job title, company size, confidence, accent, appearance, or vague wealth signals. If evidence is insufficient, say budget is unknown.
- Decision process and authority: who appears able to decide, approve, influence or block, with uncertainty where applicable.
- Urgency/timeline and why it matters.
- Price sensitivity, objections, risks, competitors/alternatives and buying signals.
- Observable communication and decision patterns that affect how to present the proposal, for example repeatedly asking for concrete examples or returning to implementation risk.
- Recommended proposal framing and the highest-value questions to ask next.

STRICT BOUNDARIES
- Do NOT diagnose psychology, personality, mental health, intelligence, honesty, deception, financial health, personal wealth or personal income.
- Do NOT infer sensitive or protected traits.
- Do NOT infer emotional state from pauses, speaking speed, interruptions or other audio/video cues. This analysis is grounded in transcript content.
- Do NOT label somebody cheap, rich, desperate, narcissistic, psychotic, dishonest or similar.
- Distinguish FACT, STRONG INFERENCE, WEAK INFERENCE and UNKNOWN in the wording.
- Recommendations must be tied to observed evidence and must not pretend certainty.
- Do not create tasks/events. Every item must be kind="note" or kind="takeaway", status="open", priority="none", confirmed=false.

OUTPUT STRUCTURE
- Top-level summary: a concise 3-6 sentence sales brief.
- Produce focused items with tags. Every item must contain "sales-intelligence" plus exactly one primary category tag from:
  sales:business-context, sales:needs, sales:budget, sales:authority, sales:urgency,
  sales:price-sensitivity, sales:objection, sales:buying-signal, sales:communication,
  sales:proposal, sales:next-question, sales:unknown.
- Use confidence from 0 to 1. High confidence requires direct evidence.
- sourceSegmentIds must contain only exact segment ids from the transcript. Cite all materially relevant segments for synthesized conclusions.
- For an UNKNOWN item, sourceSegmentIds may be empty when the point is specifically that the transcript never established it.
- Preserve money, dates and attribution exactly.
- Output only JSON matching schema: {json.dumps(schema, ensure_ascii=False)}

Conversation date: {conversation_date.isoformat()}
Context: {context}
Transcript quality notes:
{quality}
Transcript:
{transcript}"""


def _sales_verification_prompt(transcript: str, draft: Analysis, schema: dict, conversation_date: datetime, context: str) -> str:
    return f"""Audit and correct this sales-intelligence draft against the transcript. Return complete Analysis JSON only.

VERIFY
1. Every factual or inferred claim is supported by cited transcript segments, except explicit UNKNOWN items.
2. Remove invented project budgets. A numeric budget range is allowed only when concrete transcript evidence makes that range defensible.
3. Never infer personal wealth, income, financial condition, personality, mental health, protected traits, honesty/deception, or hidden motives.
4. Communication observations must describe repeated observable conversational behavior, not diagnose the person.
5. Decision authority, urgency, price sensitivity, objections and buying signals must be labeled with appropriate uncertainty.
6. Recommendations and next questions must follow from cited evidence; do not manufacture pressure tactics.
7. Every item is note/takeaway, status=open, priority=none, confirmed=false.
8. Every item has tag sales-intelligence plus exactly one primary sales:* category tag.
9. Re-check all money, dates, roles and attribution.
10. If the transcript is insufficient for budget or authority, explicitly preserve UNKNOWN instead of guessing.

Conversation date: {conversation_date.isoformat()}
Context: {context}
Schema: {json.dumps(schema, ensure_ascii=False)}
DRAFT:
{draft.model_dump_json()}
TRANSCRIPT:
{transcript}"""



async def _ollama(client: httpx.AsyncClient, prompt: str, schema: dict) -> Analysis:
    reasoning = any(token in settings.ollama_model.casefold() for token in ("qwen3", "gpt-oss", "deepseek-r1"))
    last_error = None
    for think in ([True, False] if reasoning else [False]):
        try:
            response = await client.post(f"{settings.ollama_url.rstrip('/')}/api/chat", json={"model": settings.ollama_model, "messages": [{"role": "user", "content": prompt}], "format": schema, "stream": False, "think": think, "keep_alive": "5m", "options": {"temperature": 0}})
            response.raise_for_status(); payload = response.json(); content = payload.get("message", {}).get("content", "").strip()
            if content: return Analysis.model_validate_json(content)
            last_error = RuntimeError(f"Ollama returned no final analysis (reason: {payload.get('done_reason', 'unknown')}).")
        except Exception as error:
            last_error = error
        if not think: break
    raise last_error or RuntimeError("Ollama returned no analysis.")



def _postprocess_sales(result: Analysis, segments: list[Segment]) -> Analysis:
    valid_ids = {segment.id for segment in segments if segment.id}
    processed: list[AnalysisItem] = []
    for item in result.items:
        item.kind = "takeaway" if item.kind == "takeaway" else "note"
        item.status = "open"
        item.priority = "none"
        item.confirmed = False
        item.assignee = None
        item.startsAt = item.endsAt = item.dueAt = item.reminderAt = None
        item.sourceSegmentIds = [source for source in _best_source_ids(item, segments) if source in valid_ids]

        category_tags = [tag for tag in item.tags if tag in SALES_CATEGORY_TAGS]
        primary = category_tags[0] if category_tags else "sales:unknown"
        other_tags = [tag for tag in item.tags if not tag.startswith("sales:") and tag != "sales-intelligence"]
        item.tags = ["sales-intelligence", primary, *other_tags]

        if not item.body:
            item.body = item.title
        if not item.sourceSegmentIds and primary not in {"sales:unknown", "sales:next-question"}:
            item.confidence = min(item.confidence, 0.45)
            item.uncertaintyReason = item.uncertaintyReason or "No direct transcript segment was linked to this conclusion; treat it as low confidence."
        processed.append(item)

    result.items = processed
    _dedupe(result)
    if not result.items:
        result.items.append(AnalysisItem(
            kind="note",
            title="UNKNOWN — insufficient sales evidence",
            body="The transcript did not contain enough grounded information to produce a reliable sales-intelligence brief.",
            status="open",
            priority="none",
            tags=["sales-intelligence", "sales:unknown"],
            sourceSegmentIds=[],
            confidence=1.0,
            confirmed=False,
        ))
    if not result.summary.strip():
        result.summary = "The transcript did not contain enough grounded information to produce a reliable sales brief."
    return result


async def analyze_sales(segments: list[Segment], conversation_date: datetime, context: str) -> Analysis:
    if not settings.ollama_url:
        raise RuntimeError("Ollama is not configured for the transcription worker.")
    cleaned, quality_notes = sanitize_segments(segments)
    cleaned = cleaned or segments
    transcript = "\n".join(
        f'<segment id="{segment.id or ""}" start_ms="{segment.start_ms}" end_ms="{segment.end_ms}" speaker="{segment.speaker_label}">{segment.text}</segment>'
        for segment in cleaned
    )
    schema = Analysis.model_json_schema()
    async with httpx.AsyncClient(timeout=900) as client:
        draft = await _ollama(
            client,
            _sales_analysis_prompt(transcript, schema, conversation_date, context, quality_notes),
            schema,
        )
        try:
            verified = await _ollama(
                client,
                _sales_verification_prompt(transcript, draft, schema, conversation_date, context),
                schema,
            )
        except Exception:
            verified = draft
    return _postprocess_sales(verified, cleaned)



def _postprocess(result: Analysis, segments: list[Segment], conversation_date: datetime) -> Analysis:
    _merge_rule_items(result, segments, conversation_date)
    segment_map = {s.id: s.text for s in segments if s.id}
    for item in result.items:
        item.sourceSegmentIds = _best_source_ids(item, segments)
        source = " ".join(segment_map.get(sid, "") for sid in item.sourceSegmentIds)
        if item.kind == "summary": item.kind = "note"
        if item.kind == "task" and source and not _is_explicit_task(source):
            item.kind = "note"
        elif item.kind == "event" and source:
            if _is_explicit_task(source) and not PLANNED_EVENT_RE.search(source): item.kind = "task"
            elif not _looks_like_planned_event(source, conversation_date): item.kind = "note"
        item.confirmed = False
        item.status = "needs_review" if item.kind in {"task", "event"} else "open"
        if item.kind == "task":
            item.startsAt = item.endsAt = None; item.priority = _priority(source or item.title)
            due = _date(source, conversation_date) if source else None
            if due: item.dueAt = due
            tags, reason = _date_only_meta(source, item.dueAt, False)
            if tags: item.tags = list(dict.fromkeys([*item.tags, *tags])); item.uncertaintyReason = item.uncertaintyReason or reason
        elif item.kind == "event":
            item.dueAt = item.reminderAt = None; item.priority = "none"
            start = _date(source, conversation_date) if source else None
            if start: item.startsAt = start
            tags, reason = _date_only_meta(source, item.startsAt, True)
            if tags: item.tags = list(dict.fromkeys([*item.tags, *tags])); item.uncertaintyReason = reason
            elif not item.startsAt: item.uncertaintyReason = item.uncertaintyReason or "The event is explicit, but its date/time is not. Add it before accepting this event into the calendar."
        else:
            item.priority = "none"; item.assignee = None; item.startsAt = item.endsAt = item.dueAt = item.reminderAt = None
        if not item.body and source: item.body = source.strip()
    _remove_action_only_notes(result, segments); _dedupe(result); _ensure_meaningful_notes(result, segments)
    if not result.summary.strip(): result.summary = " ".join(s.text.strip() for s in segments[:8])[:1200]
    return result


async def analyze(segments: list[Segment], conversation_date: datetime, context: str) -> Analysis:
    if not settings.ollama_url: raise RuntimeError("Ollama is not configured for the transcription worker.")
    cleaned, quality_notes = sanitize_segments(segments)
    cleaned = cleaned or segments
    transcript = "\n".join(f'<segment id="{s.id or ""}" start_ms="{s.start_ms}" end_ms="{s.end_ms}" speaker="{s.speaker_label}">{s.text}</segment>' for s in cleaned)
    schema = Analysis.model_json_schema()
    async with httpx.AsyncClient(timeout=900) as client:
        draft = await _ollama(client, _analysis_prompt(transcript, schema, conversation_date, context, quality_notes), schema)
        try:
            verified = await _ollama(client, _verification_prompt(transcript, draft, schema, conversation_date, context), schema)
        except Exception:
            verified = draft
    return _postprocess(verified, cleaned, conversation_date)
