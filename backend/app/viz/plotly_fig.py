"""Serialize analysis results into Plotly JSON that the frontend renders."""

from __future__ import annotations

from typing import Any

from ..analysis.signal import (
    BandPowerResult,
    ConnectivityResult,
    HFOResult,
    IEDResult,
    PSDResult,
    TFRResult,
    WaveformResult,
)


def waveform_fig(r: WaveformResult, title: str = "波形") -> dict[str, Any]:
    traces = []
    # stack traces with y-offsets so overlays are readable
    offset_step = _auto_offset([row for row in r.data_uv])
    for i, (label, row) in enumerate(zip(r.channels, r.data_uv)):
        y = [v + i * offset_step for v in row]
        traces.append({
            "type": "scattergl",
            "x": r.times,
            "y": y,
            "mode": "lines",
            "name": label,
            "line": {"width": 1},
        })
    layout = {
        "title": title,
        "xaxis": {"title": "时间 (s)"},
        "yaxis": {
            "title": "通道（叠加，单位 µV + 偏移）",
            "tickmode": "array",
            "tickvals": [i * offset_step for i in range(len(r.channels))],
            "ticktext": r.channels,
        },
        "showlegend": False,
        "margin": {"l": 60, "r": 20, "t": 40, "b": 40},
    }
    return {"data": traces, "layout": layout}


def _auto_offset(rows: list[list[float]]) -> float:
    if not rows:
        return 0.0
    mx = 0.0
    for row in rows:
        if not row:
            continue
        span = max(row) - min(row)
        mx = max(mx, span)
    return mx * 1.2 or 1.0


def psd_fig(r: PSDResult, title: str = "功率谱密度 (PSD)") -> dict[str, Any]:
    traces = [
        {
            "type": "scattergl",
            "x": r.freqs,
            "y": row,
            "mode": "lines",
            "name": label,
        }
        for label, row in zip(r.channels, r.psd_db)
    ]
    layout = {
        "title": title,
        "xaxis": {"title": "频率 (Hz)", "type": "log"},
        "yaxis": {"title": "功率 (dB)"},
        "margin": {"l": 60, "r": 20, "t": 40, "b": 40},
    }
    return {"data": traces, "layout": layout}


def tfr_fig(r: TFRResult, channel_index: int = 0, title: str | None = None) -> dict[str, Any]:
    """Plot TFR for a single channel as a heatmap (baseline-corrected dB)."""
    ch = r.channels[channel_index]
    z = r.power_db[channel_index]
    trace = {
        "type": "heatmap",
        "x": r.times,
        "y": r.freqs,
        "z": z,
        "colorscale": "RdBu",
        "zmid": 0,
        "colorbar": {"title": "ΔdB"},
    }
    layout = {
        "title": title or f"时频图 · {ch}",
        "xaxis": {"title": "时间 (s)"},
        "yaxis": {"title": "频率 (Hz)", "type": "log"},
        "margin": {"l": 60, "r": 20, "t": 40, "b": 40},
    }
    return {"data": [trace], "layout": layout}


def hfo_fig(r: HFOResult, title: str | None = None) -> dict[str, Any]:
    """Two-panel layout: per-channel HFO rate (bar) + event scatter (time × channel)."""
    band_zh = {"ripple": "Ripple (80–250Hz)", "fast_ripple": "Fast Ripple (250–500Hz)"}.get(
        r.band, r.band
    )
    title = title or f"HFO 检测 · {band_zh}"
    rate_chans = list(r.rate_per_min.keys())
    rate_vals = [r.rate_per_min[c] for c in rate_chans]
    rate_trace = {
        "type": "bar",
        "x": rate_chans,
        "y": rate_vals,
        "name": "events / min",
        "marker": {"color": "#f87171"},
        "yaxis": "y2",
    }
    scatter_trace = {
        "type": "scattergl",
        "x": [e.t_start for e in r.events],
        "y": [e.channel for e in r.events],
        "mode": "markers",
        "name": "events",
        "marker": {
            "size": 8,
            "color": [e.peak_freq_hz for e in r.events],
            "colorscale": "Inferno",
            "colorbar": {"title": "峰值频率 (Hz)", "x": 1.02},
            "cmin": r.fmin,
            "cmax": r.fmax,
        },
        "text": [
            f"{e.channel} · {e.t_start:.2f}s · {e.peak_freq_hz:.0f}Hz" for e in r.events
        ],
        "hoverinfo": "text",
    }
    layout = {
        "title": title,
        "grid": {"rows": 2, "columns": 1, "pattern": "independent"},
        "xaxis": {"title": "时间 (s)", "domain": [0, 1]},
        "yaxis": {"title": "通道", "domain": [0, 0.65], "type": "category"},
        "xaxis2": {"title": "通道", "domain": [0, 1], "anchor": "y2", "type": "category"},
        "yaxis2": {"title": "events / min", "domain": [0.75, 1.0]},
        "showlegend": False,
        "margin": {"l": 60, "r": 80, "t": 50, "b": 40},
    }
    rate_trace["xaxis"] = "x2"
    return {"data": [scatter_trace, rate_trace], "layout": layout}


def ied_fig(r: IEDResult, title: str = "IED（痫样放电）检测") -> dict[str, Any]:
    """Per-channel IED rate (bar) + event scatter (time × channel, colored by amplitude)."""
    rate_chans = list(r.rate_per_min.keys())
    rate_vals = [r.rate_per_min[c] for c in rate_chans]
    rate_trace = {
        "type": "bar",
        "x": rate_chans,
        "y": rate_vals,
        "marker": {"color": "#fbbf24"},
        "xaxis": "x2",
        "yaxis": "y2",
    }
    scatter_trace = {
        "type": "scattergl",
        "x": [e.t_peak for e in r.events],
        "y": [e.channel for e in r.events],
        "mode": "markers",
        "marker": {
            "size": 7,
            "color": [abs(e.amplitude_uv) for e in r.events],
            "colorscale": "YlOrRd",
            "colorbar": {"title": "幅值 (µV)", "x": 1.02},
        },
        "text": [
            f"{e.channel} · {e.t_peak:.2f}s · {e.amplitude_uv:.0f}µV · {e.width_ms:.0f}ms"
            for e in r.events
        ],
        "hoverinfo": "text",
    }
    layout = {
        "title": title,
        "grid": {"rows": 2, "columns": 1, "pattern": "independent"},
        "xaxis": {"title": "时间 (s)", "domain": [0, 1]},
        "yaxis": {"title": "通道", "domain": [0, 0.65], "type": "category"},
        "xaxis2": {"title": "通道", "domain": [0, 1], "anchor": "y2", "type": "category"},
        "yaxis2": {"title": "events / min", "domain": [0.75, 1.0]},
        "showlegend": False,
        "margin": {"l": 60, "r": 80, "t": 50, "b": 40},
    }
    return {"data": [scatter_trace, rate_trace], "layout": layout}


def connectivity_fig(r: ConnectivityResult, title: str | None = None) -> dict[str, Any]:
    """Symmetric channel × channel matrix as a heatmap."""
    method_zh = {"coh": "Coherence", "plv": "PLV", "wpli": "wPLI", "imcoh": "imCoh"}.get(
        r.method, r.method
    )
    title = title or f"连接性 · {method_zh} · {r.band} ({r.fmin:.0f}–{r.fmax:.0f}Hz)"
    trace = {
        "type": "heatmap",
        "x": r.channels,
        "y": r.channels,
        "z": r.matrix,
        "colorscale": "Plasma",
        "zmin": 0,
        "colorbar": {"title": method_zh},
    }
    layout = {
        "title": title,
        "xaxis": {"title": "通道", "type": "category"},
        "yaxis": {"title": "通道", "type": "category", "autorange": "reversed"},
        "margin": {"l": 60, "r": 20, "t": 50, "b": 60},
    }
    return {"data": [trace], "layout": layout}


def band_power_fig(r: BandPowerResult, title: str = "频段功率热图") -> dict[str, Any]:
    trace = {
        "type": "heatmap",
        "x": r.bands,
        "y": r.channels,
        "z": r.power_db,
        "colorscale": "Viridis",
        "colorbar": {"title": "dB"},
    }
    layout = {
        "title": title,
        "xaxis": {"title": "频段"},
        "yaxis": {"title": "通道"},
        "margin": {"l": 60, "r": 20, "t": 40, "b": 60},
    }
    return {"data": [trace], "layout": layout}
