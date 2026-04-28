"""Smoke tests against the two demo EDF files."""

from __future__ import annotations

from pathlib import Path

import pytest

from app.io.edf_loader import classify_channel, get_meta

DEMO_DIR = Path(__file__).resolve().parents[2] / "demo"
DEMO_FILES = sorted(DEMO_DIR.glob("*.edf"))


@pytest.mark.parametrize("path", DEMO_FILES, ids=lambda p: p.name)
def test_can_read_demo_edf(path: Path) -> None:
    meta = get_meta(path)
    assert meta.n_channels > 0
    assert meta.sfreq > 100
    assert meta.duration_sec > 1.0
    # 只要有 SEEG 通道或至少能解析出通道分类即可
    assert any(c.kind in {"seeg", "ekg", "emg", "bp", "other"} for c in meta.channels)


def test_channel_classification() -> None:
    cases = {
        "EEG A1-Ref": ("A1", "seeg", "A", 1),
        "POL A3": ("A3", "seeg", "A", 3),
        "POL B10": ("B10", "seeg", "B", 10),
        "POL EKG1": ("EKG1", "ekg", None, None),
        "POL EMGL1": ("EMGL1", "emg", None, None),
        "POL BP1": ("BP1", "bp", None, None),
        "POL E": ("E", "other", None, None),  # bare letter, not A-lead
    }
    for raw, (clean, kind, lead, contact) in cases.items():
        c = classify_channel(raw)
        assert c.clean_name == clean, raw
        assert c.kind == kind, raw
        assert c.lead == lead, raw
        assert c.contact_index == contact, raw
