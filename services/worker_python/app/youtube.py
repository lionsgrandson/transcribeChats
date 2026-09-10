import asyncio
import html
import json
import re
import shutil
import uuid
from pathlib import Path
from urllib.parse import urlparse

import httpx
from yt_dlp import YoutubeDL
from yt_dlp.utils import DownloadError

from .engine import transcribe
from .settings import settings

_ALLOWED_HOSTS = {
    "youtube.com",
    "www.youtube.com",
    "m.youtube.com",
    "music.youtube.com",
    "youtu.be",
}


def _validate_url(url: str) -> str:
    value = url.strip()
    if not value:
        raise ValueError("Paste a YouTube link first.")
    try:
        parsed = urlparse(value)
    except ValueError as error:
        raise ValueError("That is not a valid YouTube link.") from error
    if parsed.scheme not in {"http", "https"} or (parsed.hostname or "").lower() not in _ALLOWED_HOSTS:
        raise ValueError("Only youtube.com and youtu.be links are supported.")
    return value


def _language_candidates(language_mode: str) -> list[str]:
    if language_mode == "he":
        return ["he", "iw", "he-IL", "iw-IL"]
    if language_mode == "en":
        return ["en", "en-US", "en-GB", "en-CA", "en-AU"]
    if language_mode == "mixed":
        return ["he", "iw", "en", "en-US", "en-GB"]
    return ["en", "he", "iw"]


def _pick_language(track_map: dict, language_mode: str) -> str | None:
    if not track_map:
        return None
    keys = list(track_map.keys())
    lowered = {key.lower(): key for key in keys}
    for candidate in _language_candidates(language_mode):
        exact = lowered.get(candidate.lower())
        if exact:
            return exact
    for candidate in _language_candidates(language_mode):
        prefix = candidate.lower().split("-", 1)[0]
        for key in keys:
            if key.lower().split("-", 1)[0] == prefix:
                return key
    return keys[0] if language_mode == "auto" else None


def _pick_caption_track(info: dict, language_mode: str) -> tuple[str, dict] | None:
    for collection_name in ("subtitles", "automatic_captions"):
        tracks = info.get(collection_name) or {}
        language = _pick_language(tracks, language_mode)
        if not language:
            continue
        formats = tracks.get(language) or []
        for preferred_ext in ("json3", "vtt"):
            for item in formats:
                if item.get("ext") == preferred_ext and item.get("url"):
                    return preferred_ext, item
        for item in formats:
            if item.get("url"):
                return item.get("ext") or "vtt", item
    return None


def _collapse_lines(lines: list[str]) -> str:
    output: list[str] = []
    previous = ""
    for raw in lines:
        value = re.sub(r"\s+", " ", html.unescape(raw)).strip()
        if not value or value == previous:
            continue
        output.append(value)
        previous = value
    return "\n".join(output).strip()


def _parse_json3(payload: str) -> str:
    data = json.loads(payload)
    lines: list[str] = []
    for event in data.get("events", []):
        text = "".join(segment.get("utf8", "") for segment in event.get("segs", []))
        if text.strip():
            lines.append(text)
    return _collapse_lines(lines)


def _parse_vtt(payload: str) -> str:
    lines: list[str] = []
    for raw in payload.splitlines():
        value = raw.strip()
        if not value or value == "WEBVTT" or value.isdigit():
            continue
        if "-->" in value or value.startswith(("NOTE", "Kind:", "Language:")):
            continue
        value = re.sub(r"<[^>]+>", "", value)
        if value:
            lines.append(value)
    return _collapse_lines(lines)


def _download_caption(track: tuple[str, dict]) -> str:
    extension, item = track
    headers = {"User-Agent": "Mozilla/5.0 TranscribeChats/1.0"}
    with httpx.Client(timeout=45, follow_redirects=True, headers=headers) as client:
        response = client.get(item["url"])
        response.raise_for_status()
        payload = response.text
    if extension == "json3":
        return _parse_json3(payload)
    return _parse_vtt(payload)


def _extract_info(url: str) -> dict:
    options = {
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
        "skip_download": True,
        "extract_flat": False,
    }
    with YoutubeDL(options) as ydl:
        info = ydl.extract_info(url, download=False)
    if not isinstance(info, dict):
        raise RuntimeError("YouTube did not return usable video information.")
    if info.get("_type") == "playlist":
        raise ValueError("Paste a single YouTube video link, not a playlist link.")
    return info


def _download_audio(url: str, target_dir: Path) -> Path:
    target_dir.mkdir(parents=True, exist_ok=True)
    output_template = str(target_dir / "%(id)s.%(ext)s")
    options = {
        "format": "bestaudio/best",
        "outtmpl": output_template,
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
        "restrictfilenames": True,
        "max_filesize": settings.max_upload_bytes,
    }
    with YoutubeDL(options) as ydl:
        info = ydl.extract_info(url, download=True)
        requested = (info.get("requested_downloads") or []) if isinstance(info, dict) else []
        if requested and requested[0].get("filepath"):
            candidate = Path(requested[0]["filepath"])
            if candidate.exists():
                return candidate
        if isinstance(info, dict):
            candidate = Path(ydl.prepare_filename(info))
            if candidate.exists():
                return candidate
    files = [path for path in target_dir.iterdir() if path.is_file()]
    if not files:
        raise RuntimeError("YouTube audio download finished without producing a media file.")
    return max(files, key=lambda path: path.stat().st_size)


async def import_youtube_transcript(url: str, language_mode: str, context: str) -> dict:
    value = _validate_url(url)
    if language_mode not in {"auto", "en", "he", "mixed"}:
        raise ValueError("Invalid language mode.")

    try:
        info = await asyncio.to_thread(_extract_info, value)
    except DownloadError as error:
        raise RuntimeError(f"Could not read that YouTube video: {error}") from error

    title = str(info.get("title") or "YouTube video")
    video_id = str(info.get("id") or "")
    webpage_url = str(info.get("webpage_url") or value)
    duration = info.get("duration")

    caption_track = _pick_caption_track(info, language_mode)
    if caption_track:
        try:
            caption_text = await asyncio.to_thread(_download_caption, caption_track)
            if len(caption_text) >= 80:
                return {
                    "title": title,
                    "sourceName": f"YouTube · {title}",
                    "transcript": caption_text,
                    "method": "captions",
                    "videoId": video_id,
                    "webpageUrl": webpage_url,
                    "durationSeconds": int(duration) if duration is not None else None,
                }
        except (httpx.HTTPError, json.JSONDecodeError, UnicodeDecodeError):
            pass

    temp_dir = settings.media_temp_dir / f"youtube-{uuid.uuid4()}"
    try:
        try:
            audio_path = await asyncio.to_thread(_download_audio, value, temp_dir)
        except DownloadError as error:
            raise RuntimeError(f"Could not download audio from that YouTube video: {error}") from error
        if audio_path.stat().st_size > settings.max_upload_bytes:
            raise ValueError("The YouTube audio exceeds the configured local worker file limit.")
        segments, _languages, _duration_ms, _used_diarization = await transcribe(audio_path, language_mode, context[:2000])
        if not segments:
            raise ValueError("No speech was detected in the YouTube video.")
        transcript = "\n".join(f"{segment.speaker_label}: {segment.text}" for segment in segments if segment.text.strip())
        return {
            "title": title,
            "sourceName": f"YouTube · {title}",
            "transcript": transcript,
            "method": "whisper",
            "videoId": video_id,
            "webpageUrl": webpage_url,
            "durationSeconds": int(duration) if duration is not None else None,
        }
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)
