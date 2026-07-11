from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    asr_model: str = "small"
    asr_device: str = "cpu"
    asr_compute_type: str = "int8"
    media_temp_dir: Path = Path("/tmp/transcribe-chats")
    model_cache_dir: Path = Path("/models")
    max_upload_bytes: int = 2_147_483_648
    cors_origins: str = "http://localhost:4173,http://127.0.0.1:4173"
    enable_diarization: bool = False
    pyannote_token: str | None = None
    pyannote_model: str = "pyannote/speaker-diarization-community-1"
    pyannote_metrics_enabled: bool = False
    ollama_url: str | None = None
    ollama_model: str = "qwen3:4b"

    @property
    def origins(self) -> list[str]:
        return [value.strip() for value in self.cors_origins.split(",") if value.strip()]


settings = Settings()
settings.media_temp_dir.mkdir(parents=True, exist_ok=True)
settings.model_cache_dir.mkdir(parents=True, exist_ok=True)
