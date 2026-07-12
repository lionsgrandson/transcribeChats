import re
import subprocess
from pathlib import Path

import numpy as np

from .schemas import Segment

SAMPLE_RATE = 16_000
MAX_SPEAKERS = 4


def participant_names(context: str) -> list[str]:
    marker = re.search(r"(?:people|participants|speakers|משתתפים|דוברים)\s*:\s*([^.;\n·]+)", context, re.I)
    candidate = marker.group(1) if marker else context.split("·", 1)[0] if "," in context else ""
    values = re.split(r"\s*,\s*|\s+(?:and|&)\s+", candidate)
    names: list[str] = []
    for value in values:
        clean = re.sub(r"\([^)]*\)|\[[^]]*\]", "", value).strip(" -")
        if clean and len(clean) <= 50 and len(clean.split()) <= 4 and clean.casefold() not in {"meeting", "call", "conversation"}:
            names.append(clean)
    return names[:MAX_SPEAKERS]


def _decode_audio(path: Path) -> np.ndarray:
    process = subprocess.run([
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-i", str(path),
        "-ac", "1", "-ar", str(SAMPLE_RATE), "-f", "s16le", "-acodec", "pcm_s16le", "-",
    ], capture_output=True, check=True)
    return np.frombuffer(process.stdout, dtype=np.int16).astype(np.float32) / 32768.0


def _voice_embedding(samples: np.ndarray) -> np.ndarray:
    if samples.size < 800:
        return np.zeros(28, dtype=np.float32)
    threshold = max(float(np.max(np.abs(samples))) * 0.04, 0.003)
    active = samples[np.abs(samples) >= threshold]
    if active.size >= 800:
        samples = active
    frame_size = 1024
    frame_count = max(1, min(180, samples.size // frame_size))
    offsets = np.linspace(0, max(0, samples.size - frame_size), frame_count, dtype=int)
    frames = np.stack([np.pad(samples[offset:offset + frame_size], (0, max(0, offset + frame_size - samples.size)))[:frame_size] for offset in offsets])
    frames = frames - frames.mean(axis=1, keepdims=True)
    spectrum = np.abs(np.fft.rfft(frames * np.hanning(frame_size), axis=1)) ** 2
    frequencies = np.fft.rfftfreq(frame_size, 1 / SAMPLE_RATE)
    edges = np.geomspace(80, 4000, 25)
    bands = []
    for low, high in zip(edges[:-1], edges[1:]):
        mask = (frequencies >= low) & (frequencies < high)
        bands.append(float(np.log1p(spectrum[:, mask].mean()) if np.any(mask) else 0))
    band_vector = np.asarray(bands, dtype=np.float32)
    band_vector -= band_vector.mean()
    band_vector /= band_vector.std() + 1e-6
    average_spectrum = spectrum.mean(axis=0) + 1e-8
    total = average_spectrum.sum()
    centroid = float((frequencies * average_spectrum).sum() / total / 4000)
    bandwidth = float(np.sqrt((((frequencies - centroid * 4000) ** 2) * average_spectrum).sum() / total) / 4000)
    zcr = float(np.mean(np.abs(np.diff(np.signbit(samples)))))
    energy = float(np.log1p(np.mean(samples * samples) * 1000))
    return np.concatenate([band_vector, np.asarray([centroid, bandwidth, zcr, energy], dtype=np.float32)])


def _kmeans(values: np.ndarray, count: int) -> np.ndarray:
    centroids = [values[0]]
    while len(centroids) < count:
        distances = np.min(np.stack([np.sum((values - center) ** 2, axis=1) for center in centroids]), axis=0)
        centroids.append(values[int(np.argmax(distances))])
    centers = np.stack(centroids)
    labels = np.zeros(len(values), dtype=int)
    for _ in range(30):
        next_labels = np.argmin(np.sum((values[:, None, :] - centers[None, :, :]) ** 2, axis=2), axis=1)
        if np.array_equal(labels, next_labels) and _ > 0:
            break
        labels = next_labels
        for index in range(count):
            members = values[labels == index]
            if len(members):
                centers[index] = members.mean(axis=0)
    return labels


def _automatic_speaker_count(values: np.ndarray) -> int:
    if len(values) < 3:
        return 1
    labels = _kmeans(values, 2)
    groups = [values[labels == index] for index in range(2)]
    if any(len(group) == 0 for group in groups):
        return 1
    centers = [group.mean(axis=0) for group in groups]
    between = float(np.linalg.norm(centers[0] - centers[1]))
    within = float(np.mean([np.linalg.norm(value - centers[index]) for index, group in enumerate(groups) for value in group]))
    singleton_penalty = 1.35 if min(len(group) for group in groups) == 1 else 1.0
    return 2 if between > max(1.4, (within + 0.2) * 2.0 * singleton_penalty) else 1


def label_segments(segments: list[Segment], embeddings: np.ndarray, context: str) -> bool:
    if len(segments) < 2 or len(embeddings) != len(segments):
        return False
    names = participant_names(context)
    normalized = (embeddings - embeddings.mean(axis=0)) / (embeddings.std(axis=0) + 1e-6)
    speaker_count = min(len(names), len(segments), MAX_SPEAKERS) if len(names) >= 2 else _automatic_speaker_count(normalized)
    if speaker_count < 2:
        return False
    labels = _kmeans(normalized, speaker_count)
    ordered_clusters: list[int] = []
    for label in labels:
        value = int(label)
        if value not in ordered_clusters:
            ordered_clusters.append(value)
    display_names = names if len(names) >= len(ordered_clusters) else [f"Speaker {index + 1}" for index in range(len(ordered_clusters))]
    mapping = {cluster: display_names[index] for index, cluster in enumerate(ordered_clusters)}
    for segment, label in zip(segments, labels):
        segment.speaker_label = mapping[int(label)]
    return len(set(segment.speaker_label for segment in segments)) > 1


def diarize_acoustically(path: Path, segments: list[Segment], context: str) -> bool:
    if len(segments) < 2:
        return False
    try:
        audio = _decode_audio(path)
        embeddings = []
        for segment in segments:
            start = max(0, round(segment.start_ms * SAMPLE_RATE / 1000))
            end = min(len(audio), round(segment.end_ms * SAMPLE_RATE / 1000))
            embeddings.append(_voice_embedding(audio[start:end]))
        return label_segments(segments, np.stack(embeddings), context)
    except (OSError, subprocess.SubprocessError, ValueError):
        return False


def apply_participant_names(segments: list[Segment], context: str) -> None:
    names = participant_names(context)
    labels: list[str] = []
    for segment in segments:
        if segment.speaker_label not in labels:
            labels.append(segment.speaker_label)
    if len(names) < len(labels):
        return
    mapping = {label: names[index] for index, label in enumerate(labels)}
    for segment in segments:
        segment.speaker_label = mapping[segment.speaker_label]
