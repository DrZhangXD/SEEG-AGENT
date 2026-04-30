"""API-level regression tests for V1.1 contracts."""

from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from app.api import files
from app.main import app
from app.settings import settings


DEMO_DIR = Path(__file__).resolve().parents[2] / "demo"


def _open_demo(client: TestClient) -> dict:
    path = sorted(DEMO_DIR.glob("*.edf"))[0]
    r = client.post("/api/files/open", json={"path": str(path)})
    assert r.status_code == 200, r.text
    return r.json()


def test_report_uses_all_requested_channels_for_event_summaries() -> None:
    client = TestClient(app)
    meta = _open_demo(client)
    channels = [c["clean_name"] for c in meta["channels"] if c["kind"] == "seeg"][:6]

    r = client.post(
        "/api/analysis/report",
        json={
            "recording_id": meta["recording_id"],
            "channels": channels,
            "t_window_sec": 2,
            "max_channels": 2,
        },
    )

    assert r.status_code == 200, r.text
    body = r.json()
    assert len(body["summary"]["channels"]) == 2
    assert body["summary"]["event_channels"] == channels

    cards = {card["kind"]: card for card in body["cards"]}
    assert cards["hfo"]["figure"]["data"][1]["x"] == channels
    assert cards["ied"]["figure"]["data"][1]["x"] == channels


def test_open_file_rejects_paths_outside_allowed_data_roots(tmp_path: Path) -> None:
    client = TestClient(app, raise_server_exceptions=False)
    outside = tmp_path / "outside.edf"
    outside.write_bytes(b"not really an edf")

    r = client.post("/api/files/open", json={"path": str(outside)})

    assert r.status_code == 403
    assert "demo" in r.text or "upload" in r.text


def test_upload_file_sanitizes_client_filename(monkeypatch) -> None:
    client = TestClient(app)
    opened_paths: list[Path] = []

    class FakeMeta:
        def to_dict(self) -> dict:
            return {"recording_id": "fake"}

    def fake_open_recording(path: str) -> FakeMeta:
        opened_paths.append(Path(path).resolve())
        return FakeMeta()

    monkeypatch.setattr(files.session_store, "open_recording", fake_open_recording)

    escaped_upload = settings.upload_dir / "escape.edf"
    try:
        r = client.post(
            "/api/files/upload",
            files={"file": ("../escape.edf", b"fake", "application/octet-stream")},
        )
    finally:
        escaped_upload.unlink(missing_ok=True)

    assert r.status_code == 200, r.text
    assert opened_paths
    assert opened_paths[0].parent == settings.upload_dir.resolve()
    assert opened_paths[0].name == "escape.edf"


def test_open_file_reports_invalid_edf_as_bad_request() -> None:
    client = TestClient(app, raise_server_exceptions=False)
    invalid = settings.upload_dir / "invalid-contract.edf"
    invalid.write_bytes(b"not really an edf")
    try:
        r = client.post("/api/files/open", json={"path": str(invalid)})
    finally:
        invalid.unlink(missing_ok=True)

    assert r.status_code == 400
    assert "无法读取 EDF" in r.text
