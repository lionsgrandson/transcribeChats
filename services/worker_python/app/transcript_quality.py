from __future__ import annotations

import re
from dataclasses import dataclass
from difflib import SequenceMatcher

from .schemas import Segment

_MIN_DUPLICATE_LINE_RUN = 5
_MAX_PHRASE_TOKENS = 24
_GENERIC_SPEAKER_RE = re.compile(r"^(?:speaker|דובר(?:ת)?)\s*\d+$", re.I)
_SPEAKER_LINE_RE = re.compile(r"^\s*([^:\n]{1,40})\s*:\s*(.*)$")
_WORD_RE = re.compile(r"[\w\u0590-\u05ff]+", re.UNICODE)


@dataclass(frozen=True)
class TranscriptQualityResult:
    transcript: str
    notes: list[str]


def _normalize_text(value: str, *, strip_speaker: bool = False) -> str:
    text = value.strip()
    if strip_speaker:
        match = _SPEAKER_LINE_RE.match(text)
        if match:
            text = match.group(2)
    return " ".join(token.casefold() for token in _WORD_RE.findall(text))


def _normalized_tokens(tokens: list[str]) -> tuple[str, ...]:
    return tuple(_normalize_text(token) for token in tokens)


def _similar(left: str, right: str) -> bool:
    if not left or not right:
        return False
    if left == right:
        return True
    if min(len(left), len(right)) < 16:
        return False
    return SequenceMatcher(a=left, b=right, autojunk=False).ratio() >= 0.97


def _collapse_repeated_phrase_runs(text: str) -> tuple[str, int]:
    """Collapse obvious ASR loops while preserving up to two spoken repetitions."""
    tokens = text.split()
    if len(tokens) < 8:
        return text.strip(), 0

    result: list[str] = []
    removed_repetitions = 0
    index = 0
    while index < len(tokens):
        best: tuple[int, int] | None = None
        max_block = min(_MAX_PHRASE_TOKENS, (len(tokens) - index) // 4)
        for block_size in range(2, max_block + 1):
            block_tokens = _normalized_tokens(tokens[index:index + block_size])
            if not any(block_tokens) or len(" ".join(block_tokens)) < 6:
                continue
            repetitions = 1
            while index + (repetitions + 1) * block_size <= len(tokens):
                next_tokens = _normalized_tokens(
                    tokens[index + repetitions * block_size:index + (repetitions + 1) * block_size]
                )
                if next_tokens != block_tokens:
                    break
                repetitions += 1
            if repetitions >= 4:
                covered = block_size * repetitions
                if best is None or covered > best[0] * best[1]:
                    best = (block_size, repetitions)

        if best is None:
            result.append(tokens[index])
            index += 1
            continue

        block_size, repetitions = best
        keep_repetitions = 2
        result.extend(tokens[index:index + block_size * keep_repetitions])
        removed_repetitions += repetitions - keep_repetitions
        index += block_size * repetitions

    return " ".join(result).strip(), removed_repetitions


def _speaker_quality_note(lines: list[str]) -> str | None:
    labels: list[str] = []
    labelled_lines = 0
    for line in lines:
        match = _SPEAKER_LINE_RE.match(line)
        if not match:
            continue
        labelled_lines += 1
        label = match.group(1).strip()
        if label not in labels:
            labels.append(label)
    if labelled_lines < 2 or len(labels) != 1:
        return None
    if not _GENERIC_SPEAKER_RE.match(labels[0]):
        return None
    return (
        f"Only the generic label '{labels[0]}' appears across the transcript. "
        "Speaker attribution is not reliable, so the audit must not assume one person said everything "
        "or assign a statement to a specific participant unless the wording itself makes that clear."
    )


def sanitize_transcript_text(transcript: str) -> TranscriptQualityResult:
    raw_lines = transcript.splitlines()
    speaker_note = _speaker_quality_note(raw_lines)
    notes: list[str] = [speaker_note] if speaker_note else []

    prepared: list[str] = []
    phrase_loops = 0
    for line in raw_lines:
        collapsed, removed = _collapse_repeated_phrase_runs(line)
        phrase_loops += removed
        if collapsed.strip():
            prepared.append(collapsed.strip())

    cleaned: list[str] = []
    duplicate_lines_removed = 0
    index = 0
    while index < len(prepared):
        base = _normalize_text(prepared[index], strip_speaker=True)
        end = index + 1
        while end < len(prepared):
            candidate = _normalize_text(prepared[end], strip_speaker=True)
            if not base or not _similar(base, candidate):
                break
            end += 1
        run_length = end - index
        if run_length >= _MIN_DUPLICATE_LINE_RUN:
            keep = min(2, run_length)
            cleaned.extend(prepared[index:index + keep])
            duplicate_lines_removed += run_length - keep
        else:
            cleaned.extend(prepared[index:end])
        index = end

    if phrase_loops:
        notes.append(
            f"Collapsed {phrase_loops} repeated phrase-loop occurrences that looked like ASR looping. "
            "Their repetition count must not be treated as behavioral, emotional, or psychiatric evidence."
        )
    if duplicate_lines_removed:
        notes.append(
            f"Collapsed {duplicate_lines_removed} near-identical consecutive transcript lines that looked like "
            "transcription/segmentation looping. Repetition frequency was excluded from the audit evidence."
        )

    return TranscriptQualityResult(transcript="\n".join(cleaned).strip(), notes=notes)


def sanitize_segments(segments: list[Segment]) -> tuple[list[Segment], list[str]]:
    if not segments:
        return [], []

    prepared: list[Segment] = []
    phrase_loops = 0
    for segment in segments:
        collapsed, removed = _collapse_repeated_phrase_runs(segment.text)
        phrase_loops += removed
        if not collapsed:
            continue
        confidence = segment.confidence
        if removed and confidence is not None:
            confidence = min(confidence, 0.45)
        prepared.append(segment.model_copy(update={"text": collapsed, "confidence": confidence}))

    cleaned: list[Segment] = []
    duplicate_segments_removed = 0
    index = 0
    while index < len(prepared):
        base = _normalize_text(prepared[index].text)
        end = index + 1
        while end < len(prepared):
            candidate = _normalize_text(prepared[end].text)
            if not base or not _similar(base, candidate):
                break
            end += 1
        run_length = end - index
        if run_length >= _MIN_DUPLICATE_LINE_RUN:
            keep = min(2, run_length)
            cleaned.extend(prepared[index:index + keep])
            duplicate_segments_removed += run_length - keep
        else:
            cleaned.extend(prepared[index:end])
        index = end

    cleaned = [segment.model_copy(update={"sequence_no": index}) for index, segment in enumerate(cleaned)]
    notes: list[str] = []
    if phrase_loops:
        notes.append(f"Collapsed {phrase_loops} repeated phrase-loop occurrences in ASR segments.")
    if duplicate_segments_removed:
        notes.append(f"Collapsed {duplicate_segments_removed} duplicate ASR segments from consecutive loop runs.")
    return cleaned, notes
