"""File management endpoints: list demo files, upload, open, inspect."""

from __future__ import annotations

import shutil
from pathlib import Path

from fastapi import APIRouter, HTTPException, UploadFile

from ..io import session_store
from ..io.edf_loader import get_meta_by_id
from ..settings import settings

router = APIRouter(prefix="/api/files", tags=["files"])


def _is_relative_to(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
    except ValueError:
        return False
    return True


def _allowed_file_path(path: Path) -> bool:
    p = path.resolve()
    allowed_roots = (settings.demo_dir.resolve(), settings.upload_dir.resolve())
    return any(_is_relative_to(p, root) for root in allowed_roots)


def _safe_upload_name(filename: str) -> str:
    name = Path(filename).name
    if not name or name in {".", ".."}:
        raise HTTPException(400, "文件名无效")
    if not name.lower().endswith(".edf"):
        raise HTTPException(400, "仅支持 .edf 文件")
    return name


@router.get("/demo")
def list_demo_files() -> list[dict]:
    """EDF files in the project's demo/ folder."""
    demo = settings.demo_dir
    if not demo.exists():
        return []
    return [
        {"name": p.name, "path": str(p), "size": p.stat().st_size}
        for p in sorted(demo.glob("*.edf"))
    ]


@router.post("/upload")
async def upload_file(file: UploadFile) -> dict:
    if not file.filename:
        raise HTTPException(400, "缺少文件名")
    dst = settings.upload_dir / _safe_upload_name(file.filename)
    with dst.open("wb") as f:
        shutil.copyfileobj(file.file, f)
    try:
        meta = session_store.open_recording(str(dst))
    except Exception as e:
        dst.unlink(missing_ok=True)
        raise HTTPException(400, f"无法读取 EDF: {e}") from e
    return meta.to_dict()


@router.post("/open")
def open_recording(body: dict) -> dict:
    """Open a file by absolute path (e.g. a demo file) without copying."""
    path = body.get("path")
    if not path:
        raise HTTPException(400, "缺少 path")
    p = Path(path).resolve()
    if not p.exists():
        raise HTTPException(404, f"文件不存在: {p}")
    if not p.is_file() or p.suffix.lower() != ".edf":
        raise HTTPException(400, "仅支持 .edf 文件")
    if not _allowed_file_path(p):
        raise HTTPException(403, "只允许打开 demo 或 upload 目录内的 EDF 文件")
    try:
        meta = session_store.open_recording(str(p))
    except Exception as e:
        raise HTTPException(400, f"无法读取 EDF: {e}") from e
    return meta.to_dict()


@router.get("/open")
def list_open() -> list[dict]:
    return [m.to_dict() for m in session_store.list_open()]


@router.get("/{recording_id}")
def get_recording(recording_id: str) -> dict:
    meta = session_store.get(recording_id) or get_meta_by_id(recording_id)
    if meta is None:
        raise HTTPException(404, "未找到录制")
    return meta.to_dict()


@router.delete("/{recording_id}")
def close_recording(recording_id: str) -> dict:
    ok = session_store.close(recording_id)
    return {"closed": ok}
