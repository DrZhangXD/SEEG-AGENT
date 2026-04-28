"""Session-level registry of which recordings are currently 'open'."""

from __future__ import annotations

from threading import Lock

from .edf_loader import RecordingMeta, get_meta

_OPEN: dict[str, RecordingMeta] = {}
_LOCK = Lock()


def open_recording(path: str) -> RecordingMeta:
    meta = get_meta(path)
    with _LOCK:
        _OPEN[meta.recording_id] = meta
    return meta


def list_open() -> list[RecordingMeta]:
    with _LOCK:
        return list(_OPEN.values())


def get(recording_id: str) -> RecordingMeta | None:
    with _LOCK:
        return _OPEN.get(recording_id)


def close(recording_id: str) -> bool:
    with _LOCK:
        return _OPEN.pop(recording_id, None) is not None
