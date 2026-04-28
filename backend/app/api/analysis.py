"""Analysis endpoints: waveform, filter+waveform, PSD, TFR, band power."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ..analysis import signal as S
from ..io.edf_loader import RecordingMeta, get_raw_by_id
from ..io.session_store import get
from ..viz import plotly_fig as V

router = APIRouter(prefix="/api/analysis", tags=["analysis"])


class BaseReq(BaseModel):
    recording_id: str
    channels: list[str] = Field(
        default_factory=list,
        description="List of clean_name (e.g. 'A1'). Empty → all SEEG channels.",
    )


def _resolve(req: BaseReq) -> tuple[RecordingMeta, list[str], list[str]]:
    meta = get(req.recording_id)
    if meta is None:
        raise HTTPException(404, "录制未打开，请先 /api/files/open")
    raw = get_raw_by_id(req.recording_id)
    if raw is None:
        raise HTTPException(500, "Raw 对象丢失")
    name_to_raw = {c.clean_name: c.raw_name for c in meta.channels if c.kind == "seeg"}
    if req.channels:
        missing = [n for n in req.channels if n not in name_to_raw]
        if missing:
            raise HTTPException(400, f"未知通道: {missing}")
        clean = req.channels
    else:
        clean = list(name_to_raw.keys())
    raw_names = [name_to_raw[c] for c in clean]
    return meta, clean, raw_names


class WaveformReq(BaseReq):
    t_start: float = 0.0
    t_stop: float | None = None
    max_points: int = 5000
    l_freq: float | None = None
    h_freq: float | None = None
    notch: list[float] | None = None


@router.post("/waveform")
def waveform(req: WaveformReq) -> dict:
    meta, clean, raw_names = _resolve(req)
    raw = get_raw_by_id(req.recording_id)
    if req.l_freq is not None or req.h_freq is not None or req.notch:
        raw = S.filter_raw(raw, raw_names, req.l_freq, req.h_freq, req.notch)
        raw_names = raw.ch_names  # picks already applied
    result = S.get_waveform(raw, raw_names, clean, req.t_start, req.t_stop, req.max_points)
    title = "波形"
    if req.l_freq or req.h_freq or req.notch:
        bits = []
        if req.notch:
            bits.append(f"notch {req.notch}")
        if req.l_freq or req.h_freq:
            bits.append(f"{req.l_freq or 0:.0f}–{req.h_freq or 0:.0f}Hz")
        title = f"波形 ({', '.join(bits)})"
    return {"kind": "waveform", "figure": V.waveform_fig(result, title=title)}


class PSDReq(BaseReq):
    fmin: float = 1.0
    fmax: float = 200.0


@router.post("/psd")
def psd(req: PSDReq) -> dict:
    _, clean, raw_names = _resolve(req)
    raw = get_raw_by_id(req.recording_id)
    result = S.compute_psd(raw, raw_names, clean, fmin=req.fmin, fmax=req.fmax)
    return {"kind": "psd", "figure": V.psd_fig(result)}


class TFRReq(BaseReq):
    fmin: float = 2.0
    fmax: float = 150.0
    n_freqs: int = 40
    t_start: float = 0.0
    t_stop: float | None = 20.0  # TFR is expensive; cap default window


@router.post("/tfr")
def tfr(req: TFRReq) -> dict:
    _, clean, raw_names = _resolve(req)
    raw = get_raw_by_id(req.recording_id)
    result = S.compute_tfr(
        raw,
        raw_names,
        clean,
        fmin=req.fmin,
        fmax=req.fmax,
        n_freqs=req.n_freqs,
        t_start=req.t_start,
        t_stop=req.t_stop,
    )
    # One figure per channel (up to 4 to keep payload sane)
    figures = [V.tfr_fig(result, channel_index=i) for i in range(min(4, len(clean)))]
    return {"kind": "tfr", "figures": figures, "channels": result.channels}


class BandPowerReq(BaseReq):
    pass


@router.post("/band_power")
def band_power(req: BandPowerReq) -> dict:
    _, clean, raw_names = _resolve(req)
    raw = get_raw_by_id(req.recording_id)
    result = S.compute_band_power(raw, raw_names, clean)
    return {"kind": "bandpower", "figure": V.band_power_fig(result)}


class HFOReq(BaseReq):
    band: str = "ripple"  # "ripple" | "fast_ripple"
    rms_z_thresh: float = 5.0
    ll_z_thresh: float = 5.0
    win_ms: float = 100.0
    step_ms: float = 50.0
    t_start: float = 0.0
    t_stop: float | None = 60.0  # cap default to keep wall-time reasonable


@router.post("/hfo")
def hfo(req: HFOReq) -> dict:
    _, clean, raw_names = _resolve(req)
    raw = get_raw_by_id(req.recording_id)
    result = S.detect_hfo(
        raw, raw_names, clean,
        band=req.band,
        win_ms=req.win_ms,
        step_ms=req.step_ms,
        rms_z_thresh=req.rms_z_thresh,
        ll_z_thresh=req.ll_z_thresh,
        t_start=req.t_start,
        t_stop=req.t_stop,
    )
    return {
        "kind": "hfo",
        "figure": V.hfo_fig(result),
        "n_events": result.n_events,
        "band": result.band,
        "duration_sec": result.duration_sec,
        "rate_per_min": result.rate_per_min,
    }


class IEDReq(BaseReq):
    l_freq: float = 10.0
    h_freq: float = 70.0
    z_thresh: float = 6.0
    sharp_z_thresh: float = 4.0
    t_start: float = 0.0
    t_stop: float | None = 60.0


@router.post("/ied")
def ied(req: IEDReq) -> dict:
    _, clean, raw_names = _resolve(req)
    raw = get_raw_by_id(req.recording_id)
    result = S.detect_ied(
        raw, raw_names, clean,
        l_freq=req.l_freq, h_freq=req.h_freq,
        z_thresh=req.z_thresh, sharp_z_thresh=req.sharp_z_thresh,
        t_start=req.t_start, t_stop=req.t_stop,
    )
    return {
        "kind": "ied",
        "figure": V.ied_fig(result),
        "n_events": result.n_events,
        "duration_sec": result.duration_sec,
        "rate_per_min": result.rate_per_min,
    }


class ConnectivityReq(BaseReq):
    method: str = "coh"  # "coh" | "plv" | "wpli" | "imcoh"
    band: str = "gamma"
    t_start: float = 0.0
    t_stop: float | None = 30.0
    epoch_sec: float = 2.0


class ReportReq(BaseReq):
    t_window_sec: float = 60.0  # cap report window from t=0
    notch_hz: float | None = 50.0
    bp_low: float = 1.0
    bp_high: float = 70.0
    max_channels: int = 16  # cap to keep browser alive; 0 = no cap


@router.post("/report")
def comprehensive_report(req: ReportReq) -> dict:
    """One-click comprehensive analysis: 滤波波形 + PSD + 频段功率 + HFO Ripple + IED + Coh.

    Returns a list of figure cards. Designed so the frontend can drop them
    straight into the result stack without extra plumbing.

    Channel cap: by default we render at most `max_channels` channels in the
    bundled figures — 76 SEEG traces stacked in a single Plotly waveform will
    crash the browser. HFO/IED still summarize all channels in their per-channel
    rate bars; only the dense plots (waveform/PSD/TFR) get capped.
    """
    meta, clean_full, raw_names_full = _resolve(req)
    raw = get_raw_by_id(req.recording_id)
    t_stop = min(req.t_window_sec, raw.times[-1])

    if req.max_channels > 0 and len(clean_full) > req.max_channels:
        # Sample evenly across the lead/contact ordering so the report
        # represents the whole montage rather than just the first lead.
        stride = max(1, len(clean_full) // req.max_channels)
        idx = list(range(0, len(clean_full), stride))[: req.max_channels]
        clean = [clean_full[i] for i in idx]
        raw_names = [raw_names_full[i] for i in idx]
    else:
        clean = clean_full
        raw_names = raw_names_full

    cards: list[dict] = []
    summary: dict = {
        "recording": meta.filename,
        "channels": clean,
        "channels_total": len(clean_full),
        "channels_sampled": len(clean) < len(clean_full),
        "t_stop": t_stop,
    }

    # 1. 滤波波形 (前 10 s)
    rfilt = S.filter_raw(raw, raw_names, req.bp_low, req.bp_high, [req.notch_hz] if req.notch_hz else None)
    wf_t = min(10.0, t_stop)
    wf = S.get_waveform(rfilt, rfilt.ch_names, clean, 0.0, wf_t, max_points=5000)
    cards.append({
        "kind": "waveform",
        "title": f"滤波波形 (notch {req.notch_hz}Hz, {req.bp_low}–{req.bp_high}Hz)",
        "figure": V.waveform_fig(wf, title=f"滤波波形 · 0–{wf_t:.0f}s"),
    })

    # 2. PSD
    psd_r = S.compute_psd(raw, raw_names, clean, fmin=1.0, fmax=200.0)
    cards.append({
        "kind": "psd",
        "title": "功率谱密度",
        "figure": V.psd_fig(psd_r),
    })

    # 3. 频段功率
    bp_r = S.compute_band_power(raw, raw_names, clean)
    cards.append({
        "kind": "bandpower",
        "title": "频段功率热图",
        "figure": V.band_power_fig(bp_r),
    })

    # 4. HFO ripple
    hfo_r = S.detect_hfo(raw, raw_names, clean, band="ripple", t_stop=t_stop)
    cards.append({
        "kind": "hfo",
        "title": f"HFO·Ripple ({hfo_r.n_events} 事件 / {hfo_r.duration_sec:.0f}s)",
        "figure": V.hfo_fig(hfo_r),
    })
    summary["hfo_ripple_n_events"] = hfo_r.n_events
    summary["hfo_ripple_top"] = sorted(hfo_r.rate_per_min.items(), key=lambda kv: -kv[1])[:3]

    # 5. IED
    ied_r = S.detect_ied(raw, raw_names, clean, t_stop=t_stop)
    cards.append({
        "kind": "ied",
        "title": f"IED ({ied_r.n_events} 事件 / {ied_r.duration_sec:.0f}s)",
        "figure": V.ied_fig(ied_r),
    })
    summary["ied_n_events"] = ied_r.n_events
    summary["ied_top"] = sorted(ied_r.rate_per_min.items(), key=lambda kv: -kv[1])[:3]

    # 6. Connectivity (γ coherence) — only if ≥2 channels
    if len(clean) >= 2:
        try:
            con_r = S.compute_connectivity(
                raw, raw_names, clean,
                method="coh", band="gamma",
                t_start=0.0, t_stop=min(30.0, t_stop),
            )
            cards.append({
                "kind": "connectivity",
                "title": "连接性 · Coh · gamma",
                "figure": V.connectivity_fig(con_r),
            })
        except ValueError as e:
            summary["connectivity_error"] = str(e)

    return {"kind": "report", "cards": cards, "summary": summary}


@router.post("/connectivity")
def connectivity(req: ConnectivityReq) -> dict:
    _, clean, raw_names = _resolve(req)
    if len(clean) < 2:
        raise HTTPException(400, "至少需要选择 2 个通道")
    raw = get_raw_by_id(req.recording_id)
    result = S.compute_connectivity(
        raw, raw_names, clean,
        method=req.method, band=req.band,
        t_start=req.t_start, t_stop=req.t_stop,
        epoch_sec=req.epoch_sec,
    )
    return {
        "kind": "connectivity",
        "figure": V.connectivity_fig(result),
        "method": result.method,
        "band": result.band,
        "channels": result.channels,
    }
