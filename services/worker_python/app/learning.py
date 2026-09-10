import json

import httpx

from .schemas import ChatGptRepairRequest, LearningRequest, SocialAuditAnalysis, StudyAnalysis
from .settings import settings


async def _structured(prompt: str, schema_model):
    if not settings.ollama_url:
        raise RuntimeError("Ollama is not configured for the transcription worker.")
    schema = schema_model.model_json_schema()
    async with httpx.AsyncClient(timeout=1200) as client:
        response = await client.post(
            f"{settings.ollama_url.rstrip('/')}/api/chat",
            json={
                "model": settings.ollama_model,
                "messages": [{"role": "user", "content": prompt}],
                "format": schema,
                "stream": False,
                "think": False,
                "keep_alive": "10m",
                "options": {"temperature": 0.1},
            },
        )
        response.raise_for_status()
        payload = response.json()
        content = payload.get("message", {}).get("content", "").strip()
        if not content:
            raise RuntimeError(f"Ollama returned no structured output (reason: {payload.get('done_reason', 'unknown')}).")
        return schema_model.model_validate_json(content)


async def create_study_pack(request: LearningRequest) -> StudyAnalysis:
    schema = StudyAnalysis.model_json_schema()
    prompt = f"""You are building a high-quality personal study library from a lecture/course transcript.

Your job is not merely to summarize. Build material that makes the learner prove mastery through active recall and practice.

Rules:
- Stay grounded in the source transcript. Do not invent course facts.
- Correct obvious speech-to-text noise only when the intended meaning is clear.
- Create a useful nested topic hierarchy. `suggestedPath` should be a short library path such as ["Java", "Classes", "Inheritance"].
- Topics must use stable short IDs and parentId to express hierarchy. Root topics use parentId=null.
- Each topic needs a concise explanation, key points, examples when supported, prerequisites, and common mistakes.
- Learning objectives must describe things the learner should be able to DO or EXPLAIN, not vague reading goals.
- Flashcards should test atomic facts, distinctions, syntax, rules, or concepts.
- Quiz questions should give quick active-recall coverage.
- The test must be harder than the quiz and cover explanation, application, edge cases, and code questions when the subject involves programming.
- Multiple-choice questions must have plausible distractors and exactly one best answer.
- For short-answer/explain/code questions, choices must be an empty list.
- Every question needs the correct answer and a teaching explanation.
- Practice tasks must require observable work and include explicit success criteria.
- Include enough material to cover every substantive topic in the transcript without bloating trivial points.
- Prefer 10-25 flashcards for a normal lesson, 8-15 quiz questions, and 8-15 test questions. Scale up only when the transcript genuinely contains many topics.
- reviewScheduleDays should default to a sensible spaced-repetition sequence such as [1,3,7,14,30].
- Output only JSON matching this schema: {json.dumps(schema, ensure_ascii=False)}

Requested title: {request.title}
Context supplied by learner: {request.context}

SOURCE TRANSCRIPT:
{request.transcript}
"""
    return await _structured(prompt, StudyAnalysis)


async def create_social_audit(request: LearningRequest) -> SocialAuditAnalysis:
    schema = SocialAuditAnalysis.model_json_schema()
    prompt = f"""Analyze this conversation as an evidence-based communication coach.

The purpose is to help the learner notice habits, reasoning patterns, emotional communication, and social norms they may not naturally notice. This is NOT therapy, diagnosis, lie detection, or mind-reading.

Rules:
- Separate observable evidence from interpretation.
- Never diagnose a mental health condition, personality disorder, neurotype, attachment style, or hidden motive.
- Never state another person's intent, emotion, or belief as fact unless they explicitly said it.
- For every non-obvious interpretation, include plausible alternative explanations.
- Confidence must reflect how strongly the transcript supports the observation. Use lower confidence when context is missing.
- Emotional observations may cover tone implied by words, validation, escalation/de-escalation, emotional bids, defensiveness, reassurance, and unmet communication needs, but only as possibilities supported by text.
- Logical observations may cover assumptions, contradictions, missing evidence, overgeneralization, strong reasoning, question quality, and whether conclusions follow from what was said.
- Social observations may cover turn-taking, reciprocity, boundaries, politeness, directness, status/power cues, interruptions visible in transcript structure, topic shifts, repair attempts, and expectations that are common social norms.
- habitsAndPatterns should identify repeated communication behaviors visible in THIS conversation. Do not claim a lifelong pattern from one sample.
- possibleBlindSpots should be framed as things worth checking, not verdicts.
- strengths matter. Include things the learner did effectively.
- socialNormsWorthLearning should explain concrete social conventions or expectations that would help in similar situations, with examples.
- lessons should be practical and specific.
- experiments should be small behaviors the learner can try in future conversations and observe the result.
- uncertaintyNotes must explicitly list important missing context that could change the interpretation.
- Do not moralize ordinary differences in communication style.
- If the transcript contains conflict, present reasonable interpretations of all sides instead of automatically siding with the learner.
- Output only JSON matching this schema: {json.dumps(schema, ensure_ascii=False)}

Conversation title: {request.title}
Context supplied by learner: {request.context}

SOURCE TRANSCRIPT:
{request.transcript}
"""
    return await _structured(prompt, SocialAuditAnalysis)


async def repair_study_chatgpt_output(request: ChatGptRepairRequest) -> StudyAnalysis:
    schema = StudyAnalysis.model_json_schema()
    prompt = f"""Convert the pasted ChatGPT study response below into the application's exact StudyAnalysis schema.

This is a STRUCTURAL REPAIR task, not a new study-generation task.

Rules:
- Preserve the user's useful study content, wording, IDs, topic hierarchy, answers, examples, flashcards, quiz questions, test questions, tasks, and review schedule whenever possible.
- Repair malformed JSON, Markdown escaping, broken quotes, code formatting, and wrapper text instead of discarding content.
- Remove Markdown escape backslashes that only exist because the response was copied from rendered chat.
- Preserve existing IDs exactly whenever they are present and unique.
- Do not invent new subject-matter claims just to fill fields.
- Every question type MUST become one of: multiple_choice, short_answer, explain, code.
- Map variants such as multiple-choice or multiple\\_choice to multiple_choice.
- Map code_writing, code_reasoning, code_review, coding, implementation, or similar programming tasks to code.
- Map scenario, reasoning, analysis, discussion, or explanation-style questions to explain unless short_answer is clearly more appropriate.
- Non-multiple-choice questions must use an empty choices array.
- If a task contains `instructions` as an array, combine those steps into one readable `instruction` string without losing steps.
- If a task contains `successCriteria` as an array, combine the criteria into one readable `successCriteria` string without losing criteria.
- Keep difficulty limited to easy, medium, or hard. Use medium only when the source does not make the level clear.
- Ensure all required strings exist and all required arrays are arrays.
- Keep reviewScheduleDays as positive integers.
- Return only JSON matching this schema: {json.dumps(schema, ensure_ascii=False)}

Fallback title if the response has none: {request.title}

PASTED CHATGPT RESPONSE:
{request.response}
"""
    return await _structured(prompt, StudyAnalysis)


async def repair_audit_chatgpt_output(request: ChatGptRepairRequest) -> SocialAuditAnalysis:
    schema = SocialAuditAnalysis.model_json_schema()
    prompt = f"""Convert the pasted ChatGPT conversation-audit response below into the application's exact SocialAuditAnalysis schema.

This is a STRUCTURAL REPAIR task, not a new psychological or conversational analysis.

Rules:
- Preserve the useful observations and wording from the pasted response whenever possible.
- Repair malformed JSON, Markdown escaping, wrapper prose, missing field names, and array-vs-string mistakes instead of discarding content.
- Do not diagnose anyone and do not add claims about hidden intent.
- emotional, logical, social, habitsAndPatterns, and possibleBlindSpots must contain observation objects with title, evidence, interpretation, alternatives, and confidence.
- Turn a single evidence string into a one-item array. Do the same for alternatives.
- If an observation title is missing, derive a short neutral title from its interpretation without adding a new claim.
- Confidence must be numeric from 0 to 1. Convert percentages and high/medium/low wording when necessary.
- strengths, lessons, reflectionQuestions, and uncertaintyNotes must be arrays of strings.
- socialNormsWorthLearning items must contain norm, whyItMatters, and example.
- experiments items must contain title, action, and whatToNotice.
- Do not omit useful sections merely because the pasted structure used different field names.
- Return only JSON matching this schema: {json.dumps(schema, ensure_ascii=False)}

Fallback title if the response has none: {request.title}

PASTED CHATGPT RESPONSE:
{request.response}
"""
    return await _structured(prompt, SocialAuditAnalysis)
