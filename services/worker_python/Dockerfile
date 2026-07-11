FROM nvidia/cuda:12.8.1-cudnn-runtime-ubuntu24.04

ARG INSTALL_DIARIZATION=false
ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DEFAULT_TIMEOUT=600 \
    PIP_RETRIES=10 \
    MODEL_CACHE_DIR=/models \
    MEDIA_TEMP_DIR=/tmp/transcribe-chats \
    VIRTUAL_ENV=/opt/venv \
    PATH="/opt/venv/bin:$PATH"

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-venv python3-pip python3-av ffmpeg curl \
    && python3 -m venv --system-site-packages /opt/venv \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt requirements-diarization.txt ./
RUN if [ "$INSTALL_DIARIZATION" = "true" ]; then pip install --retries 10 --timeout 600 -r requirements-diarization.txt; else pip install --retries 10 --timeout 600 -r requirements.txt; fi
COPY app ./app
RUN mkdir -p /models /tmp/transcribe-chats && useradd --create-home --uid 10001 worker && chown -R worker:worker /models /tmp/transcribe-chats /app
USER worker

EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD curl -fsS http://127.0.0.1:8787/health/ready || exit 1
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8787"]
