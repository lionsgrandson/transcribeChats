import asyncio
import gc
import os
import threading
import uuid
from pathlib import Path

from .schemas import Segment
from .settings import settings

_model = None
_model_lock = threading.Lock()
_diarization_pipeline = None


def model_loaded() -> bool:
    return _model is not None


def release_model() -> None:
    global _model
    with _model_lock:
        _model = None
    gc.collect()


def diarization_available() -> bool:
    if not settings.enable_diarization or not settings.pyannote_token:
        return False
    try:
        import pyannote.audio  # noqa: F401
        return True
    except ImportError:
        return False


def _get_model():
    global _model
    if _model is None:
        with _model_lock:
            if _model is None:
                from faster_whisper import WhisperModel
                _model = WhisperModel(settings.asr_model, device=settings.asr_device, compute_type=settings.asr_compute_type, download_root=str(settings.model_cache_dir))
    return _model


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


def _transcribe_sync(path: Path, language_mode: str) -> tuple[list[Segment], list[str], int | None]:
    model = _get_model()
    language = language_mode if language_mode in {"en", "he"} else None
    mixed = language_mode in {"mixed", "auto"}
    raw_segments, info = model.transcribe(
        str(path), language=language, task="transcribe", beam_size=5, vad_filter=True,
        word_timestamps=True, multilingual=mixed, language_detection_segments=3,
        condition_on_previous_text=not mixed,
        initial_prompt="עברית English. Speakers may switch naturally between Hebrew and English." if mixed else None,
    )
    segments: list[Segment] = []
    for index, value in enumerate(raw_segments):
        confidence = None
        if value.avg_logprob is not None:
            confidence = max(0.0, min(1.0, 1.0 + float(value.avg_logprob)))
        text = value.text.strip()
        segment_language = detect_text_language(text, info.language or language or "auto")
        segments.append(Segment(id=str(uuid.uuid4()), sequence_no=index, start_ms=round(value.start * 1000), end_ms=round(value.end * 1000), text=text, language=segment_language, confidence=confidence))
    duration = round(info.duration * 1000) if getattr(info, "duration", None) else (segments[-1].end_ms if segments else None)
    detected = []
    for segment in segments:
        values = ["he", "en"] if segment.language == "mixed" else [segment.language]
        for value in values:
            if value not in {"auto", "mixed"} and value not in detected:
                detected.append(value)
    return segments, detected or ([info.language] if info.language else ([language] if language else [])), duration


def _diarize_sync(path: Path, segments: list[Segment]) -> list[Segment]:
    global _diarization_pipeline
    if not diarization_available():
        return segments
    os.environ["PYANNOTE_METRICS_ENABLED"] = "1" if settings.pyannote_metrics_enabled else "0"
    from pyannote.audio import Pipeline
    if _diarization_pipeline is None:
        _diarization_pipeline = Pipeline.from_pretrained(settings.pyannote_model, token=settings.pyannote_token)
    output = _diarization_pipeline(str(path))
    turns = [(round(turn.start * 1000), round(turn.end * 1000), str(speaker)) for turn, speaker in output.speaker_diarization]
    for segment in segments:
        midpoint = (segment.start_ms + segment.end_ms) // 2
        matching = next((speaker for start, end, speaker in turns if start <= midpoint <= end), None)
        if matching:
            segment.speaker_label = matching.replace("SPEAKER_", "Speaker ").replace("_", " ").title()
    return segments


async def transcribe(path: Path, language_mode: str) -> tuple[list[Segment], list[str], int | None, bool]:
    segments, languages, duration = await asyncio.to_thread(_transcribe_sync, path, language_mode)
    used_diarization = diarization_available()
    if used_diarization:
        segments = await asyncio.to_thread(_diarize_sync, path, segments)
    return segments, languages, duration, used_diarization
