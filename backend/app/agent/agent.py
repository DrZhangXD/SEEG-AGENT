"""Pydantic AI agent over the SEEG analysis toolset.

The agent is stateless with respect to Python state; every tool call receives
the active `recording_id` via a `RunDeps` object. Tool results are structured
dicts: text the LLM can read, plus a `figure`/`figures` payload that the
WebSocket layer forwards to the frontend for Plotly rendering.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from pydantic_ai import Agent, RunContext

from ..analysis import signal as S
from ..io.edf_loader import get_raw_by_id
from ..io.session_store import get as get_meta
from ..viz import plotly_fig as V
from .providers import get_model


@dataclass
class RunDeps:
    recording_id: str | None = None
    # emitter lets tool calls push figure results out to the WS without
    # round-tripping through the LLM response text.
    emit_figure: Any = None
    produced_figures: list[dict[str, Any]] = field(default_factory=list)


SYSTEM_PROMPT = """你是一个 SEEG 颅内脑电 LFP 分析助手。

能力：
- 基础分析：波形、滤波波形、PSD（功率谱密度）、时频图（Morlet）、频段功率。
- 痫绑分析：HFO（Ripple 80–250Hz / Fast Ripple 250–500Hz）、IED（间期痫样放电/尖棘波）、
  频段连接性（coh / plv / wpli / imcoh × delta/theta/alpha/beta/gamma/high_gamma）。
- 通道使用 SEEG 触点的 clean_name（例如 "A1"、"A2"、"B3"），不要带 "EEG "、"POL "、"-Ref" 前缀/后缀。
- 如果用户没有明确指定通道，优先使用前 4 个 SEEG 通道。HFO/IED 默认看前 60 秒；连接性默认 30 秒。
- 工具会把 Plotly 图表推送给前端渲染；你的文字回答要精炼地解释发现：
  哪个通道高频振荡发放率最高？哪个通道 IED 数量最多？哪对通道相干性最强？这些往往与致痫灶相关。
- 时频图和 HFO 开销较大，避免一次扫整段录制。
- 永远用中文回答。
"""


def _resolve_channels(recording_id: str, clean_names: list[str] | None) -> tuple[list[str], list[str]]:
    meta = get_meta(recording_id)
    if meta is None:
        raise ValueError("请先在前端打开一个 EDF 文件")
    name_to_raw = {c.clean_name: c.raw_name for c in meta.channels if c.kind == "seeg"}
    if clean_names:
        missing = [n for n in clean_names if n not in name_to_raw]
        if missing:
            raise ValueError(f"未知通道: {missing}")
        clean = clean_names
    else:
        clean = list(name_to_raw.keys())[:4]
    raw_names = [name_to_raw[c] for c in clean]
    return clean, raw_names


def build_agent(provider_id: str) -> Agent[RunDeps]:
    model = get_model(provider_id)
    agent = Agent(model=model, deps_type=RunDeps, system_prompt=SYSTEM_PROMPT)

    @agent.tool
    def get_recording_info(ctx: RunContext[RunDeps]) -> dict[str, Any]:
        """获取当前打开的 EDF 录制的元信息（通道数、采样率、时长、电极分组）。"""
        if not ctx.deps.recording_id:
            return {"error": "no recording open"}
        meta = get_meta(ctx.deps.recording_id)
        if meta is None:
            return {"error": "recording not found"}
        leads: dict[str, list[str]] = {}
        for c in meta.channels:
            if c.kind == "seeg" and c.lead:
                leads.setdefault(c.lead, []).append(c.clean_name)
        return {
            "filename": meta.filename,
            "sfreq": meta.sfreq,
            "duration_sec": meta.duration_sec,
            "n_channels": meta.n_channels,
            "n_seeg": meta.n_seeg,
            "leads": leads,
        }

    @agent.tool
    def plot_waveform(
        ctx: RunContext[RunDeps],
        channels: list[str] | None = None,
        t_start: float = 0.0,
        t_stop: float = 10.0,
        apply_filter: bool = False,
        l_freq: float = 1.0,
        h_freq: float = 70.0,
        notch_hz: float | None = 50.0,
    ) -> dict[str, Any]:
        """绘制通道波形。apply_filter=True 时应用 notch + 带通滤波。"""
        if not ctx.deps.recording_id:
            return {"error": "no recording open"}
        clean, raw_names = _resolve_channels(ctx.deps.recording_id, channels)
        raw = get_raw_by_id(ctx.deps.recording_id)
        if apply_filter:
            notch = [notch_hz] if notch_hz else None
            raw = S.filter_raw(raw, raw_names, l_freq, h_freq, notch)
            raw_names = raw.ch_names
            title = f"滤波波形 (notch {notch_hz}Hz, {l_freq}–{h_freq}Hz)"
        else:
            title = "波形"
        result = S.get_waveform(raw, raw_names, clean, t_start, t_stop, max_points=5000)
        fig = V.waveform_fig(result, title=title)
        _emit(ctx, "waveform", title, [fig])
        return {"kind": "waveform", "channels": clean, "title": title, "pushed_to_frontend": True}

    @agent.tool
    def plot_psd(
        ctx: RunContext[RunDeps],
        channels: list[str] | None = None,
        fmin: float = 1.0,
        fmax: float = 200.0,
    ) -> dict[str, Any]:
        """计算并绘制 Welch 功率谱密度。"""
        if not ctx.deps.recording_id:
            return {"error": "no recording open"}
        clean, raw_names = _resolve_channels(ctx.deps.recording_id, channels)
        raw = get_raw_by_id(ctx.deps.recording_id)
        result = S.compute_psd(raw, raw_names, clean, fmin=fmin, fmax=fmax)
        # give the LLM a small summary it can reason over
        import numpy as np
        arr = np.array(result.psd_db)
        freqs = np.array(result.freqs)
        peaks = {
            ch: float(freqs[int(np.argmax(arr[i]))])
            for i, ch in enumerate(result.channels)
        }
        fig = V.psd_fig(result)
        _emit(ctx, "psd", f"PSD ({fmin}–{fmax}Hz)", [fig])
        return {"kind": "psd", "channels": clean, "peak_freq_hz": peaks, "pushed_to_frontend": True}

    @agent.tool
    def plot_tfr(
        ctx: RunContext[RunDeps],
        channels: list[str] | None = None,
        fmin: float = 2.0,
        fmax: float = 150.0,
        n_freqs: int = 40,
        t_start: float = 0.0,
        t_stop: float = 20.0,
    ) -> dict[str, Any]:
        """用 Morlet 小波计算时频图（基线校正后的 dB）。"""
        if not ctx.deps.recording_id:
            return {"error": "no recording open"}
        clean, raw_names = _resolve_channels(ctx.deps.recording_id, channels)
        clean, raw_names = clean[:4], raw_names[:4]  # TFR 昂贵
        raw = get_raw_by_id(ctx.deps.recording_id)
        result = S.compute_tfr(
            raw, raw_names, clean, fmin=fmin, fmax=fmax, n_freqs=n_freqs,
            t_start=t_start, t_stop=t_stop,
        )
        figs = [V.tfr_fig(result, channel_index=i) for i in range(len(clean))]
        _emit(ctx, "tfr", "时频图（Morlet）", figs)
        return {"kind": "tfr", "channels": clean, "pushed_to_frontend": True}

    @agent.tool
    def detect_hfo(
        ctx: RunContext[RunDeps],
        channels: list[str] | None = None,
        band: str = "ripple",
        t_start: float = 0.0,
        t_stop: float = 60.0,
    ) -> dict[str, Any]:
        """检测高频震荡（HFO）。band="ripple"(80–250Hz) 或 "fast_ripple"(250–500Hz)。
        SEEG 文献提示 HFO 高发率与致痫区相关。"""
        if not ctx.deps.recording_id:
            return {"error": "no recording open"}
        clean, raw_names = _resolve_channels(ctx.deps.recording_id, channels)
        raw = get_raw_by_id(ctx.deps.recording_id)
        result = S.detect_hfo(
            raw, raw_names, clean, band=band, t_start=t_start, t_stop=t_stop,
        )
        # rank channels by rate
        ranked = sorted(result.rate_per_min.items(), key=lambda kv: -kv[1])
        fig = V.hfo_fig(result)
        title = f"HFO · {band} · {result.n_events} 事件"
        _emit(ctx, "hfo", title, [fig])
        return {
            "kind": "hfo",
            "band": result.band,
            "n_events": result.n_events,
            "duration_sec": result.duration_sec,
            "top_channels_by_rate": ranked[:5],
            "pushed_to_frontend": True,
        }

    @agent.tool
    def detect_ied(
        ctx: RunContext[RunDeps],
        channels: list[str] | None = None,
        z_thresh: float = 6.0,
        t_start: float = 0.0,
        t_stop: float = 60.0,
    ) -> dict[str, Any]:
        """检测 IED（间期痫样放电，尖波/棘波）。返回每通道发放率与事件列表。"""
        if not ctx.deps.recording_id:
            return {"error": "no recording open"}
        clean, raw_names = _resolve_channels(ctx.deps.recording_id, channels)
        raw = get_raw_by_id(ctx.deps.recording_id)
        result = S.detect_ied(
            raw, raw_names, clean, z_thresh=z_thresh,
            t_start=t_start, t_stop=t_stop,
        )
        ranked = sorted(result.rate_per_min.items(), key=lambda kv: -kv[1])
        fig = V.ied_fig(result)
        title = f"IED · {result.n_events} 事件 / {result.duration_sec:.0f}s"
        _emit(ctx, "ied", title, [fig])
        return {
            "kind": "ied",
            "n_events": result.n_events,
            "duration_sec": result.duration_sec,
            "top_channels_by_rate": ranked[:5],
            "pushed_to_frontend": True,
        }

    @agent.tool
    def compute_connectivity(
        ctx: RunContext[RunDeps],
        channels: list[str] | None = None,
        method: str = "coh",
        band: str = "gamma",
        t_start: float = 0.0,
        t_stop: float = 30.0,
    ) -> dict[str, Any]:
        """计算频段连接性矩阵。method ∈ {coh, plv, wpli, imcoh}, band ∈ delta/theta/alpha/beta/gamma/high_gamma。"""
        if not ctx.deps.recording_id:
            return {"error": "no recording open"}
        clean, raw_names = _resolve_channels(ctx.deps.recording_id, channels)
        if len(clean) < 2:
            return {"error": "至少需要 2 个通道"}
        raw = get_raw_by_id(ctx.deps.recording_id)
        result = S.compute_connectivity(
            raw, raw_names, clean,
            method=method, band=band,
            t_start=t_start, t_stop=t_stop,
        )
        # find strongest off-diagonal pair
        import numpy as np
        m = np.array(result.matrix)
        np.fill_diagonal(m, -np.inf)
        ix = int(np.argmax(m))
        i, j = ix // m.shape[1], ix % m.shape[1]
        fig = V.connectivity_fig(result)
        title = f"连接性 · {method.upper()} · {band}"
        _emit(ctx, "connectivity", title, [fig])
        return {
            "kind": "connectivity",
            "method": result.method,
            "band": result.band,
            "strongest_pair": (result.channels[i], result.channels[j], float(m[i, j])),
            "pushed_to_frontend": True,
        }

    @agent.tool
    def plot_band_power(
        ctx: RunContext[RunDeps],
        channels: list[str] | None = None,
    ) -> dict[str, Any]:
        """计算各 LFP 频段（δ/θ/α/β/γ/high_gamma/ripple）的功率并绘制热图。"""
        if not ctx.deps.recording_id:
            return {"error": "no recording open"}
        clean, raw_names = _resolve_channels(ctx.deps.recording_id, channels)
        raw = get_raw_by_id(ctx.deps.recording_id)
        result = S.compute_band_power(raw, raw_names, clean)
        # highlight the channel with strongest high-gamma
        import numpy as np
        arr = np.array(result.power_db)
        hg_idx = result.bands.index("high_gamma") if "high_gamma" in result.bands else 0
        top = int(np.argmax(arr[:, hg_idx]))
        fig = V.band_power_fig(result)
        _emit(ctx, "bandpower", "频段功率热图", [fig])
        return {
            "kind": "bandpower",
            "channels": clean,
            "bands": result.bands,
            "max_high_gamma_channel": result.channels[top],
            "pushed_to_frontend": True,
        }

    return agent


def _emit(
    ctx: RunContext[RunDeps], kind: str, title: str, figures: list[dict[str, Any]]
) -> None:
    payload = {"kind": kind, "title": title, "figures": figures}
    ctx.deps.produced_figures.append(payload)
    if callable(ctx.deps.emit_figure):
        ctx.deps.emit_figure(payload)
