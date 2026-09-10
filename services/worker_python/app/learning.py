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


def _study_targets(transcript: str) -> tuple[int, int, int]:
    words = len(transcript.split())
    if words < 600:
        return 6, 4, 5
    if words < 1800:
        return 10, 6, 8
    if words < 5000:
        return 14, 8, 10
    return 18, 10, 12


def _study_needs_expansion(pack: StudyAnalysis, transcript: str) -> bool:
    flashcards, quiz, test = _study_targets(transcript)
    if not pack.topics:
        return True
    if len(pack.flashcards) < flashcards or len(pack.quiz) < quiz or len(pack.test) < test:
        return True
    if len(transcript.split()) >= 800 and any(len(topic.summary.split()) < 70 for topic in pack.topics):
        return True
    return False


async def _expand_study_pack(request: LearningRequest, draft: StudyAnalysis) -> StudyAnalysis:
    schema = StudyAnalysis.model_json_schema()
    flashcards, quiz, test = _study_targets(request.transcript)
    prompt = f"""Audit and expand this draft study pack into a complete self-contained course based ONLY on the source transcript.

The learner's requirement is strict: they should be able to learn the material from the generated pack without going back to the video or transcript for ordinary study.

Rules:
- Preserve useful content and stable IDs from the draft whenever possible.
- Stay grounded in the transcript. Do not add outside facts merely to hit a count.
- Every substantive transcript concept needs a topic.
- Each topic's `summary` is the actual LESSON, not a teaser. Teach definitions, reasoning, relationships, syntax, process, edge cases, and context that the transcript explains. For a normal topic, write several useful paragraphs or an equivalently detailed explanation. Use line breaks when it improves readability.
- `keyPoints` should capture the rules and facts the learner must remember.
- `examples` should contain concrete worked examples, code, commands, scenarios, or applications when the transcript supports them.
- `commonMistakes` should explain likely misunderstandings and why they are wrong.
- `prerequisites` should identify earlier topics that should be understood first.
- Flashcards must cover the important definitions, distinctions, rules, syntax, edge cases, and common mistakes. Target AT LEAST {flashcards} useful cards when the transcript supports that much material.
- Quiz must be a real checkpoint after learning. Target AT LEAST {quiz} questions with broad topic coverage.
- Test must be a real final assessment, harder and broader than the quiz. Target AT LEAST {test} questions, mixing recall, explanation, application, edge cases, and code/reasoning where appropriate.
- Do not make the test a single-question self-check.
- Practice tasks come AFTER learning and assessment. They should be hands-on exercises that prove the learner can apply the material. They are not substitutes for teaching notes.
- Every question needs a correct answer and a teaching explanation.
- Multiple-choice questions need plausible distractors and one best answer. Other question types use an empty choices list.
- Keep question type to exactly one of: multiple_choice, short_answer, explain, code.
- reviewScheduleDays should normally be [1,3,7,14,30].
- Return only JSON matching this schema: {json.dumps(schema, ensure_ascii=False)}

Requested title: {request.title}
Context supplied by learner: {request.context}

DRAFT PACK:
{draft.model_dump_json(indent=2)}

SOURCE TRANSCRIPT:
{request.transcript}
"""
    return await _structured(prompt, StudyAnalysis)


async def create_study_pack(request: LearningRequest) -> StudyAnalysis:
    schema = StudyAnalysis.model_json_schema()
    flashcards, quiz, test = _study_targets(request.transcript)
    prompt = f"""Build a complete self-contained course from this lecture/course transcript.

The learner wants to study from THIS generated pack instead of rewatching the source. This is not a summary task. Teach the material first, then create active recall and assessment.

Rules:
- Stay grounded in the source transcript. Do not invent course facts or silently add outside knowledge.
- Correct obvious speech-to-text noise only when the intended meaning is clear.
- Create a useful nested topic hierarchy. `suggestedPath` should be a short library path such as ["Java", "Classes", "Inheritance"].
- Topics must use stable short IDs and parentId to express hierarchy. Root topics use parentId=null.
- Each topic's `summary` must function as a detailed lesson the learner can study directly. Explain what the concept is, how it works, why it matters in the transcript, important distinctions, relationships to nearby concepts, and edge cases the transcript covers. Do not use one-sentence summaries for substantive topics.
- Put memorable rules and facts in `keyPoints`.
- Put concrete examples, code, commands, scenarios, or worked applications in `examples` whenever supported by the transcript.
- Put likely misconceptions and their correction in `commonMistakes`.
- Learning objectives must describe things the learner should be able to DO or EXPLAIN after studying.
- Flashcards are mandatory when the transcript contains studyable facts. Target AT LEAST {flashcards} useful cards when supported, distributed across the substantive topics.
- Quiz is mandatory when there is enough material. Target AT LEAST {quiz} questions and use it as a broad comprehension checkpoint after learning.
- Test is mandatory when there is enough material. Target AT LEAST {test} questions and make it clearly harder than the quiz, covering explanation, application, edge cases, and code/reasoning when appropriate.
- Never collapse a normal lesson into one quiz/test question.
- Multiple-choice questions must have plausible distractors and exactly one best answer.
- For short-answer/explain/code questions, choices must be an empty list.
- Every question needs the correct answer and a teaching explanation.
- Practice tasks happen after learning. They must require observable work and include explicit success criteria. Do not use tasks as a replacement for the teaching material.
- Include enough material to cover every substantive topic in the transcript without bloating trivial points.
- reviewScheduleDays should normally be [1,3,7,14,30].
- Output only JSON matching this schema: {json.dumps(schema, ensure_ascii=False)}

Requested title: {request.title}
Context supplied by learner: {request.context}

SOURCE TRANSCRIPT:
{request.transcript}
"""
    pack = await _structured(prompt, StudyAnalysis)
    if _study_needs_expansion(pack, request.transcript):
        pack = await _expand_study_pack(request, pack)
    return pack


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
