import asyncio
import gc
import os
import threading
import uuid
from pathlib import Path

from .diarization import (
    MAX_SPEAKERS,
    apply_explicit_speaker_names,
    assign_turns_by_overlap,
    diarize_acoustically,
    expected_speaker_count,
)
from .schemas import Segment
from .settings import settings
from .transcript_quality import sanitize_segments

_model = None
_model_lock = threading.Lock()
_diarization_pipeline = None
_diarization_lock = threading.Lock()


def model_loaded() -> bool:
    return _model is not None


def _clear_cuda_cache() -> None:
    try:
        import torch
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
    except (ImportError, RuntimeError):
        pass


def release_model() -> None:
    global _model
    with _model_lock:
        _model = None
    gc.collect()
    _clear_cuda_cache()


def release_diarization_model() -> None:
    global _diarization_pipeline
    with _diarization_lock:
        _diarization_pipeline = None
    gc.collect()
    _clear_cuda_cache()


def _pyannote_available() -> bool:
    if not settings.enable_diarization or not settings.pyannote_token:
        return False
    try:
        import pyannote.audio  # noqa: F401
        return True
    except ImportError:
        return False


def pyannote_available() -> bool:
    return _pyannote_available()


def diarization_available() -> bool:
    return True


def _get_model():
    global _model
    if _model is None:
        with _model_lock:
            if _model is None:
                from faster_whisper import WhisperModel
                _model = WhisperModel(
                    settings.asr_model,
                    device=settings.asr_device,
                    compute_type=settings.asr_compute_type,
                    download_root=str(settings.model_cache_dir),
                )
    return _model


def _get_diarization_pipeline():
    global _diarization_pipeline
    if _diarization_pipeline is None:
        with _diarization_lock:
            if _diarization_pipeline is None:
                os.environ["PYANNOTE_METRICS_ENABLED"] = "1" if settings.pyannote_metrics_enabled else "0"
                from pyannote.audio import Pipeline
                pipeline = Pipeline.from_pretrained(settings.pyannote_model, token=settings.pyannote_token)
                if settings.pyannote_device == "cuda":
                    try:
                        import torch
                        pipeline.to(torch.device("cuda"))
                    except (ImportError, RuntimeError):
                        pass
                _diarization_pipeline = pipeline
    return _diarization_pipeline


def detect_text_language(text: str, fallback: str = "auto") -> str:
    hebrew = sum("\u0590" <= character <= "\u05ff" for character in text)
    latin = sum(character.isascii() and character.isalpha() for character in text)
    if hebrew and latin:
        smaller, larger = sorted((hebrew, latin))
        if smaller / max(larger, 1) >= 0.18:
            return "mixed"
    if hebrew:
        return "he"
    if latin:
        return "en"
    return fallback


def _transcribe_sync(path: Path, language_mode: str, context: str) -> tuple[list[Segment], list[str], int | None]:
    model = _get_model()
    language = language_mode if language_mode in {"en", "he"} else None
    mixed = language_mode in {"mixed", "auto"}
    prompt_parts = ["עברית English. Speakers may switch naturally between Hebrew and English."] if mixed else []
    clean_context = " ".join(context.split())[:1500]
    if clean_context:
        prompt_parts.append(
            f"Known names, spellings, terminology, and conversation context: {clean_context}. "
            "Use these spellings only when they match the audio."
        )

    raw_segments, info = model.transcribe(
        str(path),
        language=language,
        task="transcribe",
        beam_size=settings.asr_beam_size,
        patience=settings.asr_patience,
        temperature=0.0,
        vad_filter=True,
        vad_parameters={
            "min_silence_duration_ms": settings.asr_vad_min_silence_ms,
            "speech_pad_ms": settings.asr_speech_pad_ms,
        },
        word_timestamps=True,
        multilingual=mixed,
        language_detection_segments=5 if mixed else 3,
        language_detection_threshold=0.4 if mixed else 0.5,
        condition_on_previous_text=False,
        initial_prompt=" ".join(prompt_parts) or None,
        hotwords=clean_context[:1000] or None,
        hallucination_silence_threshold=1.5,
    )
    segments: list[Segment] = []
    for value in raw_segments:
        text = value.text.strip()
        if not text:
            continue
        confidence = None
        if value.avg_logprob is not None:
            confidence = max(0.0, min(1.0, 1.0 + float(value.avg_logprob)))
        segment_language = detect_text_language(text, info.language or language or "auto")
        segments.append(
            Segment(
                id=str(uuid.uuid4()),
                sequence_no=len(segments),
                start_ms=round(value.start * 1000),
                end_ms=round(value.end * 1000),
                text=text,
                language=segment_language,
                confidence=confidence,
            )
        )

    segments, _quality_notes = sanitize_segments(segments)
    duration = round(info.duration * 1000) if getattr(info, "duration", None) else (segments[-1].end_ms if segments else None)
    detected = []
    for segment in segments:
        values = ["he", "en"] if segment.language == "mixed" else [segment.language]
        for value in values:
            if value not in {"auto", "mixed"} and value not in detected:
                detected.append(value)
    return segments, detected or ([info.language] if info.language else ([language] if language else [])), duration


def _diarize_sync(path: Path, segments: list[Segment], context: str, speaker_count_hint: int | None) -> bool:
    if not _pyannote_available() or len(segments) < 2:
        return False
    pipeline = _get_diarization_pipeline()
    count = expected_speaker_count(context, speaker_count_hint)
    kwargs = {"num_speakers": count} if count else {"min_speakers": 1, "max_speakers": MAX_SPEAKERS}
    output = pipeline(str(path), **kwargs)
    annotation = getattr(output, "exclusive_speaker_diarization", None)
    if annotation is None:
        annotation = getattr(output, "speaker_diarization", output)
    turns = [
        (round(turn.start * 1000), round(turn.end * 1000), str(speaker))
        for turn, _track, speaker in annotation.itertracks(yield_label=True)
    ]
    separated = assign_turns_by_overlap(segments, turns)
    apply_explicit_speaker_names(segments, context)
    return separated


async def transcribe(
    path: Path,
    language_mode: str,
    context: str = "",
    speaker_count_hint: int | None = None,
) -> tuple[list[Segment], list[str], int | None, str, int]:
    segments, languages, duration = await asyncio.to_thread(_transcribe_sync, path, language_mode, context)
    method = "none"

    if _pyannote_available():
        release_model()
        try:
            if await asyncio.to_thread(_diarize_sync, path, segments, context, speaker_count_hint):
                method = "pyannote"
        except Exception:
            method = "none"
        finally:
            release_diarization_model()

    if method == "none":
        separated = await asyncio.to_thread(diarize_acoustically, path, segments, context, speaker_count_hint)
        if separated:
            method = "acoustic"

    apply_explicit_speaker_names(segments, context)
    speaker_count = len({segment.speaker_label for segment in segments if segment.speaker_label}) or 1
    return segments, languages, duration, method, speaker_count
