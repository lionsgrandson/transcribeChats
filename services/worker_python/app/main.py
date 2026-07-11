import os
import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from .analysis import analyze as analyze_segments
from .engine import diarization_available, model_loaded, transcribe
from .schemas import HealthResponse, TranscriptionResponse
from .settings import settings

SUPPORTED_EXTENSIONS = {".mp3", ".m4a", ".mp4", ".mov", ".wav", ".webm", ".mpeg", ".mpga", ".ogg", ".flac"}

app = FastAPI(title="TranscribeChats Worker", version="0.2.0", docs_url="/docs")
app.add_middleware(CORSMiddleware, allow_origins=settings.origins, allow_credentials=False, allow_methods=["GET", "POST"], allow_headers=["*"])


@app.get("/health/live", response_model=HealthResponse)
async def health_live() -> HealthResponse:
    return HealthResponse(status="live", model_loaded=model_loaded(), asr_model=settings.asr_model, device=settings.asr_device, diarization_available=diarization_available())


@app.get("/health/ready", response_model=HealthResponse)
async def health_ready() -> HealthResponse:
    return HealthResponse(status="ready", model_loaded=model_loaded(), asr_model=settings.asr_model, device=settings.asr_device, diarization_available=diarization_available())


@app.post("/v1/transcribe", response_model=TranscriptionResponse)
async def transcribe_file(
    file: UploadFile = File(...),
    language_mode: str = Form("auto"),
    context: str = Form(""),
    analyze: bool = Form(True),
    recorded_at: str | None = Form(None),
) -> TranscriptionResponse:
    suffix = Path(file.filename or "recording.webm").suffix.lower()
    if suffix not in SUPPORTED_EXTENSIONS:
        raise HTTPException(status_code=415, detail="Unsupported audio or video format.")
    if language_mode not in {"auto", "en", "he", "mixed"}:
        raise HTTPException(status_code=422, detail="Invalid language mode.")
    target = settings.media_temp_dir / f"{uuid.uuid4()}{suffix}"
    total = 0
    try:
        with target.open("wb") as destination:
            while chunk := await file.read(1024 * 1024):
                total += len(chunk)
                if total > settings.max_upload_bytes:
                    raise HTTPException(status_code=413, detail="File exceeds the configured worker limit.")
                destination.write(chunk)
        if total == 0:
            raise HTTPException(status_code=400, detail="The uploaded file is empty.")
        segments, languages, duration, used_diarization = await transcribe(target, language_mode)
        if not segments:
            raise HTTPException(status_code=422, detail="No speech was detected in the media.")
        analysis_result = None
        if analyze:
            try:
                reference = datetime.fromisoformat(recorded_at.replace("Z", "+00:00")) if recorded_at else datetime.now(timezone.utc)
            except ValueError:
                reference = datetime.now(timezone.utc)
            analysis_result = await analyze_segments(segments, reference, context[:4000])
        return TranscriptionResponse(duration_ms=duration, detected_languages=languages, segments=segments, analysis=analysis_result, engine="faster-whisper", model=settings.asr_model, diarization_enabled=used_diarization)
    finally:
        await file.close()
        if target.exists():
            target.unlink(missing_ok=True)
