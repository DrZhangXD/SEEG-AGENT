"""Electrode coordinate endpoints."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, UploadFile

from ..io import electrode_io as E
from ..io.edf_loader import get_meta_by_id
from ..io.session_store import get as get_session

router = APIRouter(prefix="/api/electrodes", tags=["electrodes"])


@router.get("/{recording_id}")
def get_electrodes(recording_id: str) -> dict:
    es = E.get_set(recording_id)
    if es is None:
        return {"recording_id": recording_id, "source": None, "contacts": []}
    return es.to_dict()


@router.post("/{recording_id}/synthesize")
def synthesize(recording_id: str) -> dict:
    if not (get_session(recording_id) or get_meta_by_id(recording_id)):
        raise HTTPException(404, "录制未打开")
    es = E.synthesize(recording_id)
    E.store_set(es)
    return es.to_dict()


@router.post("/{recording_id}/upload")
async def upload_csv(recording_id: str, file: UploadFile) -> dict:
    if not (get_session(recording_id) or get_meta_by_id(recording_id)):
        raise HTTPException(404, "录制未打开")
    if not file.filename or not file.filename.lower().endswith((".csv", ".tsv")):
        raise HTTPException(400, "仅支持 .csv / .tsv 文件")
    try:
        text = (await file.read()).decode("utf-8-sig")
        es = E.parse_csv(text, recording_id)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    meta = get_session(recording_id) or get_meta_by_id(recording_id)
    if meta is not None:
        es = E.filter_to_recording(es, meta)
    E.store_set(es)
    return es.to_dict()


@router.delete("/{recording_id}")
def clear(recording_id: str) -> dict:
    E.clear_set(recording_id)
    return {"cleared": True}
