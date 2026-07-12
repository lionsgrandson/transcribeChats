import asyncio
import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from .analysis import analyze as analyze_segments
from .engine import diarization_available, model_loaded, release_model, transcribe
from .schemas import Analysis, AnalysisRequest, HealthResponse, TranscriptionJobStatus, TranscriptionResponse
from .settings import settings

SUPPORTED_EXTENSIONS = {".mp3", ".m4a", ".mp4", ".mov", ".wav", ".webm", ".mpeg", ".mpga", ".ogg", ".flac"}
logger = logging.getLogger("transcribe-chats.worker")
jobs: dict[str, TranscriptionJobStatus] = {}
job_semaphore = asyncio.Semaphore(1)

app = FastAPI(title="TranscribeChats Worker", version="0.6.0", docs_url="/docs")
app.add_middleware(CORSMiddleware, allow_origins=settings.origins, allow_credentials=False, allow_methods=["GET", "POST"], allow_headers=["*"])


@app.get("/health/live", response_model=HealthResponse)
async def health_live() -> HealthResponse:
    return HealthResponse(status="live", model_loaded=model_loaded(), asr_model=settings.asr_model, device=settings.asr_device, diarization_available=diarization_available())


@app.get("/health/ready", response_model=HealthResponse)
async def health_ready() -> HealthResponse:
    return HealthResponse(status="ready", model_loaded=model_loaded(), asr_model=settings.asr_model, device=settings.asr_device, diarization_available=diarization_available())


def validate_input(filename: str | None, language_mode: str) -> str:
    suffix = Path(filename or "recording.webm").suffix.lower()
    if suffix not in SUPPORTED_EXTENSIONS:
        raise HTTPException(status_code=415, detail="Unsupported audio or video format.")
    if language_mode not in {"auto", "en", "he", "mixed"}:
        raise HTTPException(status_code=422, detail="Invalid language mode.")
    return suffix


async def save_upload(file: UploadFile, suffix: str) -> Path:
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
        return target
    except Exception:
        target.unlink(missing_ok=True)
        raise
    finally:
        await file.close()


async def build_result(path: Path, language_mode: str, analyze: bool, recorded_at: str | None, context: str) -> TranscriptionResponse:
    segments, languages, duration, used_diarization = await transcribe(path, language_mode, context[:2000])
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


async def run_job(job_id: str, target: Path, language_mode: str, analyze: bool, recorded_at: str | None, context: str) -> None:
    try:
        async with job_semaphore:
            jobs[job_id] = TranscriptionJobStatus(job_id=job_id, status="processing", progress=25, stage="Transcribing locally")
            result = await build_result(target, language_mode, False, recorded_at, context)
            jobs[job_id] = TranscriptionJobStatus(job_id=job_id, status="processing", progress=85, stage="Analyzing transcript")
            if analyze:
                release_model()
                try:
                    reference = datetime.fromisoformat(recorded_at.replace("Z", "+00:00")) if recorded_at else datetime.now(timezone.utc)
                except ValueError:
                    reference = datetime.now(timezone.utc)
                result.analysis = await analyze_segments(result.segments, reference, context[:4000])
            jobs[job_id] = TranscriptionJobStatus(job_id=job_id, status="ready", progress=100, stage="Ready", result=result)
    except Exception as error:
        detail = error.detail if isinstance(error, HTTPException) else str(error) or "Transcription failed."
        logger.exception("Transcription job %s failed", job_id)
        jobs[job_id] = TranscriptionJobStatus(job_id=job_id, status="failed", progress=0, stage="Failed", error=str(detail))
    finally:
        target.unlink(missing_ok=True)


@app.post("/v1/jobs", response_model=TranscriptionJobStatus, status_code=202)
async def create_transcription_job(
    file: UploadFile = File(...),
    language_mode: str = Form("auto"),
    context: str = Form(""),
    analyze: bool = Form(True),
    recorded_at: str | None = Form(None),
) -> TranscriptionJobStatus:
    suffix = validate_input(file.filename, language_mode)
    target = await save_upload(file, suffix)
    job_id = str(uuid.uuid4())
    status = TranscriptionJobStatus(job_id=job_id, status="queued", progress=15, stage="Queued")
    jobs[job_id] = status
    asyncio.create_task(run_job(job_id, target, language_mode, analyze, recorded_at, context))
    return status


@app.get("/v1/jobs/{job_id}", response_model=TranscriptionJobStatus)
async def get_transcription_job(job_id: str) -> TranscriptionJobStatus:
    status = jobs.get(job_id)
    if not status:
        raise HTTPException(status_code=404, detail="Transcription job not found. The worker may have restarted.")
    return status


@app.post("/v1/analyze", response_model=Analysis)
async def analyze_transcript(request: AnalysisRequest) -> Analysis:
    if not request.segments:
        raise HTTPException(status_code=400, detail="A transcript is required before Ollama analysis.")
    try:
        reference = datetime.fromisoformat(request.recorded_at.replace("Z", "+00:00")) if request.recorded_at else datetime.now(timezone.utc)
    except ValueError:
        reference = datetime.now(timezone.utc)
    release_model()
    try:
        return await analyze_segments(request.segments, reference, request.context[:4000])
    except Exception as error:
        logger.exception("Ollama analysis failed")
        raise HTTPException(status_code=502, detail=f"Ollama analysis failed: {error}") from error


@app.post("/v1/transcribe", response_model=TranscriptionResponse)
async def transcribe_file(
    file: UploadFile = File(...),
    language_mode: str = Form("auto"),
    context: str = Form(""),
    analyze: bool = Form(True),
    recorded_at: str | None = Form(None),
) -> TranscriptionResponse:
    suffix = validate_input(file.filename, language_mode)
    target = await save_upload(file, suffix)
    try:
        return await build_result(target, language_mode, analyze, recorded_at, context)
    finally:
        target.unlink(missing_ok=True)
