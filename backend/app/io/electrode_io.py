"""Electrode coordinate handling.

Three sources for the (channel_name → MNI xyz) mapping:

  A. CSV/TSV upload — columns: channel_name, x, y, z [, hemisphere, anat_label]
  B. Synthetic placeholder — derive MNI-ish coordinates from EDF channel names
     using a simple per-lead trajectory (entry point on cortex, depth toward
     midline). Lets the 3D view light up before real coords are available.
  C. (v2 stub) Localize from CT/MRI via FreeSurfer + mne.gui.locate_ieeg.
"""

from __future__ import annotations

import csv
import io
import math
import re
from dataclasses import dataclass

from .edf_loader import RecordingMeta, get_meta_by_id


@dataclass
class Contact:
    channel_name: str  # clean_name (e.g. "A1")
    x: float  # MNI152 mm
    y: float
    z: float
    hemisphere: str | None = None  # "L" | "R"
    anat_label: str | None = None
    source: str = "csv"  # "csv" | "synthetic"


@dataclass
class ElectrodeSet:
    recording_id: str
    contacts: list[Contact]
    source: str  # "csv" | "synthetic"

    def to_dict(self) -> dict:
        return {
            "recording_id": self.recording_id,
            "source": self.source,
            "contacts": [c.__dict__ for c in self.contacts],
        }


_STORE: dict[str, ElectrodeSet] = {}


def get_set(recording_id: str) -> ElectrodeSet | None:
    return _STORE.get(recording_id)


def store_set(es: ElectrodeSet) -> None:
    _STORE[es.recording_id] = es


def clear_set(recording_id: str) -> None:
    _STORE.pop(recording_id, None)


# ── Path A: parse a user-uploaded CSV ───────────────────────────────────────
def parse_csv(text: str, recording_id: str) -> ElectrodeSet:
    # Permit TSV by sniffing the first line.
    sample = text.splitlines()[0] if text.strip() else ""
    delim = "\t" if "\t" in sample and "," not in sample else ","
    reader = csv.DictReader(io.StringIO(text), delimiter=delim)
    if reader.fieldnames is None:
        raise ValueError("CSV 缺少表头")
    headers = {h.strip().lower(): h for h in reader.fieldnames}
    required = ["channel_name", "x", "y", "z"]
    missing = [h for h in required if h not in headers]
    if missing:
        raise ValueError(
            f"CSV 缺少必填列 {missing}；期望表头：channel_name,x,y,z[,hemisphere,anat_label]"
        )

    contacts: list[Contact] = []
    for row in reader:
        try:
            contacts.append(
                Contact(
                    channel_name=row[headers["channel_name"]].strip(),
                    x=float(row[headers["x"]]),
                    y=float(row[headers["y"]]),
                    z=float(row[headers["z"]]),
                    hemisphere=(row.get(headers.get("hemisphere", "")) or "").strip() or None,
                    anat_label=(row.get(headers.get("anat_label", "")) or "").strip() or None,
                    source="csv",
                )
            )
        except (KeyError, ValueError) as e:
            raise ValueError(f"无法解析行 {row}: {e}") from e

    return ElectrodeSet(recording_id=recording_id, contacts=contacts, source="csv")


# ── Path B: synthesize coordinates from channel names ───────────────────────
def synthesize(recording_id: str) -> ElectrodeSet:
    """Generate plausible-looking MNI coords for visualization while real
    coordinates are unavailable. Each electrode lead enters the brain at a
    distinct cortical point and projects radially toward the midline; contacts
    along the lead are spaced 3.5 mm apart (approximating a Behnke-Fried lead).
    """
    meta = get_meta_by_id(recording_id)
    if meta is None:
        raise ValueError("录制未加载，请先打开文件")

    # Collect leads (sorted by lead letter for deterministic placement).
    leads: dict[str, list] = {}
    for c in meta.channels:
        if c.kind == "seeg" and c.lead:
            leads.setdefault(c.lead, []).append(c)
    sorted_leads = sorted(leads.items(), key=lambda kv: kv[0])

    # Place each lead on a circle around the head (rough cortex shell).
    # MNI152 head radius ~ 75 mm. Alternate hemispheres so left/right are obvious.
    R = 70.0
    contacts: list[Contact] = []
    n = max(1, len(sorted_leads))
    for i, (lead, chans) in enumerate(sorted_leads):
        # Distribute around a tilted ring covering both hemispheres.
        theta = 2 * math.pi * i / n
        # Hemisphere chosen by sign of cos(theta).
        hem = "L" if math.cos(theta) >= 0 else "R"
        # Entry point on cortex.
        ex = R * math.cos(theta)
        ey = R * math.sin(theta) * 0.6  # squish AP to keep within MNI box
        ez = 30 * math.sin(2 * theta)  # mild superior-inferior variation
        # Direction toward midline (origin).
        norm = math.sqrt(ex * ex + ey * ey + ez * ez) or 1
        dx, dy, dz = -ex / norm, -ey / norm, -ez / norm

        chans_sorted = sorted(chans, key=lambda c: c.contact_index or 0)
        for c in chans_sorted:
            depth = (c.contact_index or 1) * 3.5  # mm along the lead
            x = ex + dx * depth
            y = ey + dy * depth
            z = ez + dz * depth
            contacts.append(
                Contact(
                    channel_name=c.clean_name,
                    x=float(x),
                    y=float(y),
                    z=float(z),
                    hemisphere=hem,
                    anat_label=f"synthetic-{lead}",
                    source="synthetic",
                )
            )

    return ElectrodeSet(recording_id=recording_id, contacts=contacts, source="synthetic")


# ── Helpers ─────────────────────────────────────────────────────────────────
_LEAD_RE = re.compile(r"^[A-Za-z]+")


def lead_of(channel_name: str) -> str | None:
    m = _LEAD_RE.match(channel_name)
    return m.group(0) if m else None


def filter_to_recording(es: ElectrodeSet, meta: RecordingMeta) -> ElectrodeSet:
    """Drop contacts that don't correspond to any SEEG channel in the recording."""
    valid = {c.clean_name for c in meta.channels if c.kind == "seeg"}
    return ElectrodeSet(
        recording_id=es.recording_id,
        source=es.source,
        contacts=[c for c in es.contacts if c.channel_name in valid],
    )
