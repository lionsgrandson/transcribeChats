from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # large-v3 is slower than the old "small" default, but it is substantially
    # more accurate for real conversations and multilingual Hebrew/English audio.
    asr_model: str = "large-v3"
    asr_device: str = "cuda"
    asr_compute_type: str = "float16"
    asr_beam_size: int = 8
    asr_patience: float = 1.2
    asr_vad_min_silence_ms: int = 500
    asr_speech_pad_ms: int = 250
    media_temp_dir: Path = Path("/tmp/transcribe-chats")
    model_cache_dir: Path = Path("/models")
    max_upload_bytes: int = 2_147_483_648
    cors_origins: str = "http://localhost:4173,http://127.0.0.1:4173"
    enable_diarization: bool = False
    pyannote_token: str | None = None
    pyannote_model: str = "pyannote/speaker-diarization-community-1"
    pyannote_metrics_enabled: bool = False
    ollama_url: str | None = None
    # start-all.mjs can automatically choose a larger model on machines with
    # enough memory. This remains the standalone Docker/default fallback.
    ollama_model: str = "qwen3:30b"

    @property
    def origins(self) -> list[str]:
        return [value.strip() for value in self.cors_origins.split(",") if value.strip()]


settings = Settings()
settings.media_temp_dir.mkdir(parents=True, exist_ok=True)
settings.model_cache_dir.mkdir(parents=True, exist_ok=True)
