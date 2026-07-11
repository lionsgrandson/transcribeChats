from typing import Literal

from pydantic import BaseModel, Field


class Segment(BaseModel):
    id: str | None = None
    sequence_no: int
    speaker_label: str = "Speaker 1"
    start_ms: int
    end_ms: int
    text: str
    language: str = "auto"
    confidence: float | None = None


class AnalysisItem(BaseModel):
    kind: Literal["task", "event", "note", "takeaway", "summary"]
    title: str
    body: str | None = None
    status: Literal["needs_review", "open", "completed", "dismissed"] = "needs_review"
    priority: Literal["none", "low", "medium", "high", "urgent"] = "none"
    assignee: str | None = None
    startsAt: str | None = None
    endsAt: str | None = None
    dueAt: str | None = None
    reminderAt: str | None = None
    tags: list[str] = Field(default_factory=list)
    sourceSegmentIds: list[str] = Field(default_factory=list)
    confidence: float = Field(default=0.7, ge=0, le=1)
    uncertaintyReason: str | None = None
    confirmed: bool = False


class Analysis(BaseModel):
    summary: str
    items: list[AnalysisItem] = Field(default_factory=list)


class TranscriptionResponse(BaseModel):
    duration_ms: int | None = None
    detected_languages: list[str]
    segments: list[Segment]
    analysis: Analysis | None = None
    engine: str
    model: str
    diarization_enabled: bool


class TranscriptionJobStatus(BaseModel):
    job_id: str
    status: Literal["queued", "processing", "ready", "failed"]
    progress: int = Field(ge=0, le=100)
    stage: str
    result: TranscriptionResponse | None = None
    error: str | None = None


class HealthResponse(BaseModel):
    status: Literal["ready", "live"]
    model_loaded: bool
    asr_model: str
    device: str
    diarization_available: bool
