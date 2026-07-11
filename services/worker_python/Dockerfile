FROM python:3.12-slim

ARG INSTALL_DIARIZATION=false
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    MODEL_CACHE_DIR=/models \
    MEDIA_TEMP_DIR=/tmp/transcribe-chats

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt requirements-diarization.txt ./
RUN if [ "$INSTALL_DIARIZATION" = "true" ]; then pip install -r requirements-diarization.txt; else pip install -r requirements.txt; fi
COPY app ./app
RUN mkdir -p /models /tmp/transcribe-chats && useradd --create-home --uid 10001 worker && chown -R worker:worker /models /tmp/transcribe-chats /app
USER worker

EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD curl -fsS http://127.0.0.1:8787/health/ready || exit 1
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8787"]
