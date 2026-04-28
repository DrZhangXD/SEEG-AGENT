"""Pure-function SEEG LFP analyses over an in-memory MNE Raw.

Each function takes a Raw (possibly already filtered / cropped) and an explicit
list of channel `clean_name`s (SEEG contact labels without Nihon-Kohden prefixes).
The caller is responsible for resolving clean_name → raw ch_name via
`RecordingMeta.channels` before invoking.
"""

from __future__ import annotations

from dataclasses import dataclass

import mne
import numpy as np


@dataclass
class WaveformResult:
    times: list[float]  # seconds
    channels: list[str]  # clean names in order
    data_uv: list[list[float]]  # [n_channels, n_samples], microvolts
    sfreq: float


def get_waveform(
    raw: mne.io.BaseRaw,
    picks_raw_names: list[str],
    channel_labels: list[str],
    t_start: float = 0.0,
    t_stop: float | None = None,
    max_points: int = 5000,
) -> WaveformResult:
    """Return a decimated waveform for the given channels within [t_start, t_stop]."""
    tmax = raw.times[-1] if t_stop is None else min(t_stop, raw.times[-1])
    if tmax <= t_start:
        raise ValueError(f"invalid time window [{t_start}, {tmax}]")

    cropped = raw.copy().pick(picks_raw_names).crop(tmin=t_start, tmax=tmax)
    cropped.load_data()
    data = cropped.get_data() * 1e6  # V → µV
    n_samples = data.shape[1]
    if n_samples > max_points:
        stride = int(np.ceil(n_samples / max_points))
        data = data[:, ::stride]
        times = cropped.times[::stride] + t_start
    else:
        times = cropped.times + t_start

    return WaveformResult(
        times=times.tolist(),
        channels=channel_labels,
        data_uv=data.tolist(),
        sfreq=float(cropped.info["sfreq"]),
    )


def filter_raw(
    raw: mne.io.BaseRaw,
    picks_raw_names: list[str] | None,
    l_freq: float | None,
    h_freq: float | None,
    notch: list[float] | None,
) -> mne.io.BaseRaw:
    """Return a new Raw with notch + band-pass filtering applied."""
    out = raw.copy().pick(picks_raw_names) if picks_raw_names else raw.copy()
    out.load_data()
    if notch:
        out.notch_filter(freqs=notch, verbose="ERROR")
    if l_freq is not None or h_freq is not None:
        out.filter(l_freq=l_freq, h_freq=h_freq, verbose="ERROR")
    return out


@dataclass
class PSDResult:
    freqs: list[float]
    channels: list[str]
    psd_db: list[list[float]]  # 10*log10, [n_channels, n_freqs]


def compute_psd(
    raw: mne.io.BaseRaw,
    picks_raw_names: list[str],
    channel_labels: list[str],
    fmin: float = 1.0,
    fmax: float = 200.0,
    n_fft: int | None = None,
) -> PSDResult:
    nyq = raw.info["sfreq"] / 2.0
    fmax = min(fmax, nyq - 1)
    n_fft = n_fft or int(2 ** np.ceil(np.log2(raw.info["sfreq"] * 2)))
    spectrum = raw.copy().pick(picks_raw_names).compute_psd(
        method="welch",
        fmin=fmin,
        fmax=fmax,
        n_fft=n_fft,
        verbose="ERROR",
    )
    psd, freqs = spectrum.get_data(return_freqs=True)
    psd_db = 10.0 * np.log10(psd + 1e-20)
    return PSDResult(
        freqs=freqs.tolist(),
        channels=channel_labels,
        psd_db=psd_db.tolist(),
    )


@dataclass
class TFRResult:
    times: list[float]
    freqs: list[float]
    channels: list[str]
    power_db: list[list[list[float]]]  # [n_channels, n_freqs, n_times]


def compute_tfr(
    raw: mne.io.BaseRaw,
    picks_raw_names: list[str],
    channel_labels: list[str],
    fmin: float = 2.0,
    fmax: float = 150.0,
    n_freqs: int = 40,
    n_cycles_ratio: float = 0.3,
    t_start: float = 0.0,
    t_stop: float | None = None,
) -> TFRResult:
    tmax = raw.times[-1] if t_stop is None else min(t_stop, raw.times[-1])
    fmax = min(fmax, raw.info["sfreq"] / 2 - 1)
    freqs = np.logspace(np.log10(fmin), np.log10(fmax), n_freqs)
    n_cycles = np.maximum(3, freqs * n_cycles_ratio)

    segment = raw.copy().pick(picks_raw_names).crop(tmin=t_start, tmax=tmax).load_data()
    # tfr_array_morlet expects (n_epochs, n_channels, n_times)
    data = segment.get_data()[np.newaxis, :, :]
    power = mne.time_frequency.tfr_array_morlet(
        data,
        sfreq=segment.info["sfreq"],
        freqs=freqs,
        n_cycles=n_cycles,
        output="power",
        verbose="ERROR",
    )  # shape (1, n_channels, n_freqs, n_times)
    power = power[0]
    # log-power, then subtract per-channel baseline mean for contrast
    logp = 10.0 * np.log10(power + 1e-20)
    logp -= logp.mean(axis=2, keepdims=True)

    # downsample in time to keep payload modest
    n_times = logp.shape[2]
    stride = max(1, n_times // 400)
    logp_ds = logp[:, :, ::stride]
    times = segment.times[::stride] + t_start

    return TFRResult(
        times=times.tolist(),
        freqs=freqs.tolist(),
        channels=channel_labels,
        power_db=logp_ds.tolist(),
    )


# Canonical LFP bands.
BANDS: dict[str, tuple[float, float]] = {
    "delta": (1.0, 4.0),
    "theta": (4.0, 8.0),
    "alpha": (8.0, 13.0),
    "beta": (13.0, 30.0),
    "gamma": (30.0, 80.0),
    "high_gamma": (80.0, 150.0),
    "ripple": (80.0, 250.0),
}


@dataclass
class BandPowerResult:
    channels: list[str]
    bands: list[str]
    power_db: list[list[float]]  # [n_channels, n_bands]


def compute_band_power(
    raw: mne.io.BaseRaw,
    picks_raw_names: list[str],
    channel_labels: list[str],
    bands: dict[str, tuple[float, float]] | None = None,
) -> BandPowerResult:
    bands = bands or BANDS
    nyq = raw.info["sfreq"] / 2.0
    usable = {k: (lo, min(hi, nyq - 1)) for k, (lo, hi) in bands.items() if lo < nyq - 1}

    spectrum = raw.copy().pick(picks_raw_names).compute_psd(
        method="welch",
        fmin=min(lo for lo, _ in usable.values()),
        fmax=max(hi for _, hi in usable.values()),
        verbose="ERROR",
    )
    psd, freqs = spectrum.get_data(return_freqs=True)
    rows = []
    names = list(usable.keys())
    for ch in range(psd.shape[0]):
        row = []
        for name in names:
            lo, hi = usable[name]
            mask = (freqs >= lo) & (freqs <= hi)
            p = psd[ch, mask].mean() if mask.any() else 0.0
            row.append(float(10.0 * np.log10(p + 1e-20)))
        rows.append(row)

    return BandPowerResult(
        channels=channel_labels,
        bands=names,
        power_db=rows,
    )


# ── HFO detection ───────────────────────────────────────────────────────────
@dataclass
class HFOEvent:
    channel: str  # clean_name
    t_start: float  # seconds
    t_stop: float
    peak_freq_hz: float
    rms: float
    line_length: float
    band: str  # "ripple" | "fast_ripple"


@dataclass
class HFOResult:
    band: str  # "ripple" (80–250Hz) | "fast_ripple" (250–500Hz)
    fmin: float
    fmax: float
    rate_per_min: dict[str, float]  # clean_name → events/min
    events: list[HFOEvent]
    n_events: int
    duration_sec: float


def detect_hfo(
    raw: mne.io.BaseRaw,
    picks_raw_names: list[str],
    channel_labels: list[str],
    band: str = "ripple",
    win_ms: float = 100.0,
    step_ms: float = 50.0,
    rms_z_thresh: float = 5.0,
    ll_z_thresh: float = 5.0,
    min_duration_ms: float = 6.0,
    t_start: float = 0.0,
    t_stop: float | None = None,
) -> HFOResult:
    """Line-Length + RMS HFO detector (Staba 2002 / Gardner 2007 hybrid).

    Steps:
      1. Band-pass to [fmin, fmax] (ripple 80–250 Hz, fast_ripple 250–500 Hz).
      2. Slide windows of `win_ms` with `step_ms` stride.
      3. Per-channel z-score of RMS and line-length over the recording.
      4. Mark windows where BOTH z-scores exceed thresholds → candidate HFO.
      5. Merge adjacent windows; reject events shorter than `min_duration_ms`.

    This is a screening detector, not a clinical-grade tool. False-positive
    rates are high during artifacts; user must visually confirm.
    """
    bands = {
        "ripple": (80.0, 250.0),
        "fast_ripple": (250.0, 500.0),
    }
    if band not in bands:
        raise ValueError(f"band must be one of {list(bands)}")
    fmin, fmax = bands[band]

    nyq = raw.info["sfreq"] / 2.0
    if fmax > nyq - 1:
        fmax = nyq - 1
    if fmin >= fmax:
        raise ValueError(f"采样率太低，无法检测 {band}（需要 fmax > {fmin}Hz, 实际 nyquist={nyq}Hz）")

    tmax = raw.times[-1] if t_stop is None else min(t_stop, raw.times[-1])
    if tmax <= t_start:
        raise ValueError(f"invalid time window [{t_start}, {tmax}]")

    out = raw.copy().pick(picks_raw_names).crop(tmin=t_start, tmax=tmax).load_data()
    out.filter(l_freq=fmin, h_freq=fmax, verbose="ERROR")
    sfreq = float(out.info["sfreq"])
    data = out.get_data()  # (n_channels, n_samples) in V

    win = max(2, int(win_ms * 1e-3 * sfreq))
    step = max(1, int(step_ms * 1e-3 * sfreq))
    n_ch, n_samp = data.shape
    starts = np.arange(0, n_samp - win, step)
    if len(starts) < 4:
        return HFOResult(
            band=band, fmin=fmin, fmax=fmax,
            rate_per_min={lbl: 0.0 for lbl in channel_labels},
            events=[], n_events=0, duration_sec=tmax - t_start,
        )

    events: list[HFOEvent] = []
    rate: dict[str, float] = {}
    duration_min = (tmax - t_start) / 60.0 or 1e-9
    for ci in range(n_ch):
        x = data[ci]
        rms = np.empty(len(starts))
        ll = np.empty(len(starts))
        for k, s in enumerate(starts):
            seg = x[s : s + win]
            rms[k] = np.sqrt(np.mean(seg * seg))
            ll[k] = np.mean(np.abs(np.diff(seg)))
        # z-score per channel
        rms_z = (rms - rms.mean()) / (rms.std() + 1e-20)
        ll_z = (ll - ll.mean()) / (ll.std() + 1e-20)
        flag = (rms_z > rms_z_thresh) & (ll_z > ll_z_thresh)
        # group adjacent flagged windows
        grouped: list[tuple[int, int]] = []
        i = 0
        while i < len(flag):
            if flag[i]:
                j = i
                while j + 1 < len(flag) and flag[j + 1]:
                    j += 1
                grouped.append((i, j))
                i = j + 1
            else:
                i += 1
        ch_events = 0
        for a, b in grouped:
            t0 = (starts[a]) / sfreq + t_start
            t1 = (starts[b] + win) / sfreq + t_start
            if (t1 - t0) * 1000.0 < min_duration_ms:
                continue
            seg = x[starts[a] : starts[b] + win]
            # peak freq via FFT inside the event
            if seg.size >= 16:
                spec = np.abs(np.fft.rfft(seg * np.hanning(seg.size)))
                fr = np.fft.rfftfreq(seg.size, d=1.0 / sfreq)
                mask = (fr >= fmin) & (fr <= fmax)
                pk = float(fr[mask][int(np.argmax(spec[mask]))]) if mask.any() else (fmin + fmax) / 2
            else:
                pk = (fmin + fmax) / 2
            events.append(
                HFOEvent(
                    channel=channel_labels[ci],
                    t_start=float(t0),
                    t_stop=float(t1),
                    peak_freq_hz=float(pk),
                    rms=float(rms[a:b + 1].max()),
                    line_length=float(ll[a:b + 1].max()),
                    band=band,
                )
            )
            ch_events += 1
        rate[channel_labels[ci]] = ch_events / duration_min

    return HFOResult(
        band=band, fmin=fmin, fmax=fmax,
        rate_per_min=rate,
        events=events,
        n_events=len(events),
        duration_sec=tmax - t_start,
    )


# ── IED (interictal epileptiform discharge) detection ──────────────────────
@dataclass
class IEDEvent:
    channel: str
    t_peak: float
    amplitude_uv: float
    sharpness: float  # 2nd-derivative magnitude proxy
    width_ms: float


@dataclass
class IEDResult:
    rate_per_min: dict[str, float]
    events: list[IEDEvent]
    n_events: int
    duration_sec: float


def detect_ied(
    raw: mne.io.BaseRaw,
    picks_raw_names: list[str],
    channel_labels: list[str],
    l_freq: float = 10.0,
    h_freq: float = 70.0,
    z_thresh: float = 6.0,
    sharp_z_thresh: float = 4.0,
    min_isi_ms: float = 200.0,
    t_start: float = 0.0,
    t_stop: float | None = None,
) -> IEDResult:
    """Detect interictal epileptiform discharges (sharp transients).

    Heuristic: band-pass to [10, 70] Hz, then flag samples whose absolute
    amplitude AND |2nd-derivative| both exceed per-channel z-score thresholds.
    Group nearby detections into one event per ISI window.
    """
    tmax = raw.times[-1] if t_stop is None else min(t_stop, raw.times[-1])
    if tmax <= t_start:
        raise ValueError(f"invalid time window [{t_start}, {tmax}]")
    out = raw.copy().pick(picks_raw_names).crop(tmin=t_start, tmax=tmax).load_data()
    out.filter(l_freq=l_freq, h_freq=h_freq, verbose="ERROR")
    sfreq = float(out.info["sfreq"])
    data = out.get_data() * 1e6  # → µV

    min_isi = max(1, int(min_isi_ms * 1e-3 * sfreq))
    events: list[IEDEvent] = []
    rate: dict[str, float] = {}
    duration_min = (tmax - t_start) / 60.0 or 1e-9
    for ci, label in enumerate(channel_labels):
        x = data[ci]
        amp_z = (np.abs(x) - np.median(np.abs(x))) / (np.std(x) + 1e-20)
        d2 = np.gradient(np.gradient(x))
        sharp_z = (np.abs(d2) - np.median(np.abs(d2))) / (np.std(d2) + 1e-20)
        flag = (amp_z > z_thresh) & (sharp_z > sharp_z_thresh)
        idx = np.where(flag)[0]
        # enforce min ISI
        kept: list[int] = []
        last = -10**9
        for i in idx:
            if i - last >= min_isi:
                kept.append(int(i))
                last = i
        ch_events = 0
        for i in kept:
            # measure FWHM around the peak in a ±100ms window
            half = int(0.1 * sfreq)
            a = max(0, i - half)
            b = min(len(x), i + half)
            seg = x[a:b]
            if seg.size < 4:
                continue
            peak_amp = float(seg[int(np.argmax(np.abs(seg)))])
            half_amp = abs(peak_amp) / 2
            above = np.where(np.abs(seg) >= half_amp)[0]
            width = (above[-1] - above[0]) / sfreq * 1000.0 if above.size else 0.0
            events.append(
                IEDEvent(
                    channel=label,
                    t_peak=float(i / sfreq + t_start),
                    amplitude_uv=peak_amp,
                    sharpness=float(np.abs(d2[i])),
                    width_ms=float(width),
                )
            )
            ch_events += 1
        rate[label] = ch_events / duration_min

    return IEDResult(
        rate_per_min=rate,
        events=events,
        n_events=len(events),
        duration_sec=tmax - t_start,
    )


# ── Connectivity ────────────────────────────────────────────────────────────
@dataclass
class ConnectivityResult:
    method: str  # "coh" | "plv" | "wpli" | "imcoh"
    band: str
    fmin: float
    fmax: float
    channels: list[str]
    matrix: list[list[float]]  # [n_channels, n_channels], symmetric
    t_start: float
    t_stop: float


def compute_connectivity(
    raw: mne.io.BaseRaw,
    picks_raw_names: list[str],
    channel_labels: list[str],
    method: str = "coh",
    band: str = "gamma",
    fmin: float | None = None,
    fmax: float | None = None,
    t_start: float = 0.0,
    t_stop: float | None = None,
    epoch_sec: float = 2.0,
) -> ConnectivityResult:
    """Compute pairwise spectral connectivity in a frequency band.

    Splits the requested time window into non-overlapping epochs of `epoch_sec`,
    then uses `mne_connectivity.spectral_connectivity_epochs`. Returns the
    mean-over-frequency, symmetric channel × channel matrix.
    """
    from mne_connectivity import spectral_connectivity_epochs

    if fmin is None or fmax is None:
        if band not in BANDS:
            raise ValueError(f"未知频段 {band}，可选 {list(BANDS)}")
        fmin, fmax = BANDS[band]
    nyq = raw.info["sfreq"] / 2.0
    fmax = min(fmax, nyq - 1)

    tmax = raw.times[-1] if t_stop is None else min(t_stop, raw.times[-1])
    if tmax - t_start < epoch_sec * 2:
        raise ValueError(f"窗口太短，至少需要 {epoch_sec * 2}s（实际 {tmax - t_start}s）")
    out = raw.copy().pick(picks_raw_names).crop(tmin=t_start, tmax=tmax).load_data()
    sfreq = float(out.info["sfreq"])

    n_per_epoch = int(epoch_sec * sfreq)
    arr = out.get_data()  # (n_ch, n_samp)
    n_epochs = arr.shape[1] // n_per_epoch
    if n_epochs < 2:
        raise ValueError("epoch 数不足，加大时间窗或减小 epoch_sec")
    arr = arr[:, : n_epochs * n_per_epoch].reshape(arr.shape[0], n_epochs, n_per_epoch)
    arr = arr.transpose(1, 0, 2)  # → (n_epochs, n_ch, n_samp)

    con = spectral_connectivity_epochs(
        arr,
        method=method,
        sfreq=sfreq,
        fmin=fmin,
        fmax=fmax,
        faverage=True,
        verbose="ERROR",
    )
    # con.get_data(output='dense') → (n_ch, n_ch, n_freq=1)
    mat = np.asarray(con.get_data(output="dense"))
    if mat.ndim == 3:
        mat = mat[:, :, 0]
    mat = np.abs(mat)
    # mne-connectivity returns lower-triangular; mirror to full symmetric
    sym = mat + mat.T
    np.fill_diagonal(sym, 1.0 if method in ("coh", "plv") else 0.0)

    return ConnectivityResult(
        method=method,
        band=band,
        fmin=float(fmin),
        fmax=float(fmax),
        channels=channel_labels,
        matrix=sym.tolist(),
        t_start=float(t_start),
        t_stop=float(tmax),
    )
