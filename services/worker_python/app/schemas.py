from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator


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

    @field_validator("startsAt", "endsAt", "dueAt", "reminderAt", mode="before")
    @classmethod
    def normalize_optional_datetime(cls, value):
        if value is None or value == "":
            return None
        try:
            parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
            return parsed.isoformat()
        except (TypeError, ValueError):
            return None

    @field_validator("tags", "sourceSegmentIds", mode="before")
    @classmethod
    def normalize_optional_lists(cls, value):
        return value if isinstance(value, list) else []


class Analysis(BaseModel):
    summary: str
    items: list[AnalysisItem] = Field(default_factory=list)


class AnalysisRequest(BaseModel):
    segments: list[Segment]
    recorded_at: str | None = None
    context: str = ""


class LearningRequest(BaseModel):
    title: str = ""
    transcript: str
    context: str = ""


class StudyTopic(BaseModel):
    id: str
    title: str
    parentId: str | None = None
    summary: str
    keyPoints: list[str] = Field(default_factory=list)
    examples: list[str] = Field(default_factory=list)
    commonMistakes: list[str] = Field(default_factory=list)
    prerequisites: list[str] = Field(default_factory=list)


class StudyFlashcard(BaseModel):
    id: str
    topicId: str
    front: str
    back: str
    difficulty: Literal["easy", "medium", "hard"] = "medium"


class StudyQuestion(BaseModel):
    id: str
    topicId: str
    type: Literal["multiple_choice", "short_answer", "explain", "code"]
    prompt: str
    choices: list[str] = Field(default_factory=list)
    answer: str
    explanation: str
    difficulty: Literal["easy", "medium", "hard"] = "medium"


class StudyTask(BaseModel):
    id: str
    topicId: str
    title: str
    instruction: str
    successCriteria: str
    difficulty: Literal["easy", "medium", "hard"] = "medium"


class StudyAnalysis(BaseModel):
    title: str
    suggestedPath: list[str] = Field(default_factory=list)
    overview: str
    learningObjectives: list[str] = Field(default_factory=list)
    topics: list[StudyTopic] = Field(default_factory=list)
    flashcards: list[StudyFlashcard] = Field(default_factory=list)
    quiz: list[StudyQuestion] = Field(default_factory=list)
    test: list[StudyQuestion] = Field(default_factory=list)
    tasks: list[StudyTask] = Field(default_factory=list)
    reviewScheduleDays: list[int] = Field(default_factory=lambda: [1, 3, 7, 14, 30])


class SocialAuditObservation(BaseModel):
    title: str
    evidence: list[str] = Field(default_factory=list)
    interpretation: str
    alternatives: list[str] = Field(default_factory=list)
    confidence: float = Field(default=0.5, ge=0, le=1)


class SocialNorm(BaseModel):
    norm: str
    whyItMatters: str
    example: str


class SocialExperiment(BaseModel):
    title: str
    action: str
    whatToNotice: str


class SocialAuditAnalysis(BaseModel):
    title: str
    summary: str
    emotional: list[SocialAuditObservation] = Field(default_factory=list)
    logical: list[SocialAuditObservation] = Field(default_factory=list)
    social: list[SocialAuditObservation] = Field(default_factory=list)
    habitsAndPatterns: list[SocialAuditObservation] = Field(default_factory=list)
    possibleBlindSpots: list[SocialAuditObservation] = Field(default_factory=list)
    strengths: list[str] = Field(default_factory=list)
    socialNormsWorthLearning: list[SocialNorm] = Field(default_factory=list)
    lessons: list[str] = Field(default_factory=list)
    reflectionQuestions: list[str] = Field(default_factory=list)
    experiments: list[SocialExperiment] = Field(default_factory=list)
    uncertaintyNotes: list[str] = Field(default_factory=list)


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
