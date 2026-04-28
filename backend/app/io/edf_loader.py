"""EDF loading with recording_id-based caching of the MNE Raw object."""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from pathlib import Path
from threading import Lock

import mne

_RAW_CACHE: dict[str, mne.io.BaseRaw] = {}
_META_CACHE: dict[str, "RecordingMeta"] = {}
_LOCK = Lock()

# Strip Nihon-Kohden style prefixes/suffixes to get the clean SEEG contact name.
_PREFIX_RE = re.compile(r"^(EEG|POL|ECG|EMG|EOG)\s+", re.IGNORECASE)
_SUFFIX_RE = re.compile(r"-Ref$", re.IGNORECASE)
# Clean SEEG contact: one or two letters followed by a number (e.g. A1, Lh10).
_SEEG_CONTACT_RE = re.compile(r"^[A-Za-z]{1,3}\d+$")
_NON_SEEG_TOKENS = ("EKG", "ECG", "EMG", "EOG", "BP")


@dataclass
class ChannelInfo:
    index: int
    raw_name: str
    clean_name: str
    kind: str  # "seeg" | "ekg" | "emg" | "eog" | "bp" | "other"
    lead: str | None  # e.g. "A" for A1..A8
    contact_index: int | None  # 1-based contact along the lead


@dataclass
class RecordingMeta:
    recording_id: str
    path: str
    filename: str
    sfreq: float
    n_channels: int
    n_seeg: int
    duration_sec: float
    channels: list[ChannelInfo]

    def to_dict(self) -> dict:
        return {
            "recording_id": self.recording_id,
            "path": self.path,
            "filename": self.filename,
            "sfreq": self.sfreq,
            "n_channels": self.n_channels,
            "n_seeg": self.n_seeg,
            "duration_sec": self.duration_sec,
            "channels": [c.__dict__ for c in self.channels],
        }


def _hash_file(path: Path, chunk: int = 1 << 20) -> str:
    h = hashlib.sha256()
    h.update(str(path.stat().st_size).encode())
    with path.open("rb") as f:
        h.update(f.read(chunk))
        f.seek(max(0, path.stat().st_size - chunk))
        h.update(f.read(chunk))
    return h.hexdigest()[:16]


def classify_channel(raw_name: str) -> ChannelInfo:
    idx = -1  # filled in by caller
    s = _PREFIX_RE.sub("", raw_name).strip()
    s = _SUFFIX_RE.sub("", s).strip()
    clean = s

    upper = clean.upper()
    if upper.startswith("EKG") or upper.startswith("ECG"):
        return ChannelInfo(idx, raw_name, clean, "ekg", None, None)
    if upper.startswith("EMG"):
        return ChannelInfo(idx, raw_name, clean, "emg", None, None)
    if upper.startswith("EOG"):
        return ChannelInfo(idx, raw_name, clean, "eog", None, None)
    if upper.startswith("BP"):
        return ChannelInfo(idx, raw_name, clean, "bp", None, None)

    m = _SEEG_CONTACT_RE.match(clean)
    if m:
        lead = re.match(r"^[A-Za-z]+", clean).group(0)
        contact = int(re.search(r"\d+", clean).group(0))
        return ChannelInfo(idx, raw_name, clean, "seeg", lead, contact)

    return ChannelInfo(idx, raw_name, clean, "other", None, None)


def load_recording(path: str | Path, *, preload: bool = False) -> tuple[str, mne.io.BaseRaw]:
    """Load an EDF file, returning (recording_id, Raw). Cached by file hash."""
    p = Path(path).resolve()
    if not p.exists():
        raise FileNotFoundError(p)
    rid = _hash_file(p)
    with _LOCK:
        raw = _RAW_CACHE.get(rid)
        if raw is None:
            raw = mne.io.read_raw_edf(str(p), preload=preload, verbose="ERROR")
            _RAW_CACHE[rid] = raw
    return rid, raw


def get_meta(path: str | Path) -> RecordingMeta:
    rid, raw = load_recording(path, preload=False)
    with _LOCK:
        cached = _META_CACHE.get(rid)
        if cached is not None:
            return cached

    channels: list[ChannelInfo] = []
    for i, name in enumerate(raw.ch_names):
        info = classify_channel(name)
        info.index = i
        channels.append(info)

    p = Path(path).resolve()
    meta = RecordingMeta(
        recording_id=rid,
        path=str(p),
        filename=p.name,
        sfreq=float(raw.info["sfreq"]),
        n_channels=len(raw.ch_names),
        n_seeg=sum(1 for c in channels if c.kind == "seeg"),
        duration_sec=float(raw.times[-1]),
        channels=channels,
    )
    with _LOCK:
        _META_CACHE[rid] = meta
    return meta


def get_raw_by_id(recording_id: str) -> mne.io.BaseRaw | None:
    return _RAW_CACHE.get(recording_id)


def get_meta_by_id(recording_id: str) -> RecordingMeta | None:
    return _META_CACHE.get(recording_id)
