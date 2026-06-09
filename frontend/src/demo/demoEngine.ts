// In-browser SEEG simulator for the static GitHub Pages demo.
//
// Everything here is deterministic and self-contained: it generates plausible
// SEEG signals with numpy-style math and serializes them into the *exact* same
// Plotly JSON shapes the FastAPI backend emits (see backend/app/viz/plotly_fig.py).
// The React components can therefore render the demo without knowing it is fake.

import type {
  ChannelInfo,
  Contact,
  ElectrodeSet,
  PlotlyFigure,
  RecordingMeta,
} from "../api/client";

// ── Deterministic RNG (mulberry32) ──────────────────────────────────────────
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function linspace(a: number, b: number, n: number): number[] {
  if (n <= 1) return [a];
  const out = new Array<number>(n);
  const step = (b - a) / (n - 1);
  for (let i = 0; i < n; i++) out[i] = a + step * i;
  return out;
}

function logspace(a: number, b: number, n: number): number[] {
  const la = Math.log10(Math.max(a, 1e-3));
  const lb = Math.log10(Math.max(b, a + 1));
  return linspace(la, lb, n).map((v) => 10 ** v);
}

const round = (v: number, d = 3) => {
  const f = 10 ** d;
  return Math.round(v * f) / f;
};

// ── The demo recording ───────────────────────────────────────────────────────
// 6 SEEG leads (76 contacts) + a few physiological channels, matching the
// Nihon-Kohden naming the loader recognizes.
const LEADS: [string, number][] = [
  ["A", 12],
  ["B", 12],
  ["C", 14],
  ["D", 12],
  ["E", 14],
  ["F", 12],
];

export const DEMO_SFREQ = 2000;
export const DEMO_DURATION = 120;

function buildChannels(): ChannelInfo[] {
  const chans: ChannelInfo[] = [];
  let idx = 0;
  for (const [lead, n] of LEADS) {
    for (let c = 1; c <= n; c++) {
      const clean = `${lead}${c}`;
      chans.push({
        index: idx++,
        raw_name: `EEG ${clean}-Ref`,
        clean_name: clean,
        kind: "seeg",
        lead,
        contact_index: c,
      });
    }
  }
  const extras: [string, ChannelInfo["kind"]][] = [
    ["EKG1", "ekg"],
    ["EMG1", "emg"],
    ["EOG1", "eog"],
    ["BP1", "bp"],
  ];
  for (const [name, kind] of extras) {
    chans.push({
      index: idx++,
      raw_name: `POL ${name}`,
      clean_name: name,
      kind,
      lead: null,
      contact_index: null,
    });
  }
  return chans;
}

const DEMO_CHANNELS = buildChannels();
const SEEG_NAMES = DEMO_CHANNELS.filter((c) => c.kind === "seeg").map((c) => c.clean_name);

export const DEMO_RECORDING_ID = "demo-rec-0001";

export function demoMeta(path?: string, filename?: string): RecordingMeta {
  return {
    recording_id: DEMO_RECORDING_ID,
    path: path ?? "demo/demo_seeg_sample.edf",
    filename: filename ?? "demo_seeg_sample.edf",
    sfreq: DEMO_SFREQ,
    n_channels: DEMO_CHANNELS.length,
    n_seeg: SEEG_NAMES.length,
    duration_sec: DEMO_DURATION,
    channels: DEMO_CHANNELS,
  };
}

export const DEMO_FILES = [
  {
    name: "demo_seeg_sample.edf",
    path: "demo/demo_seeg_sample.edf",
    size: 193 * 1024 * 1024,
  },
  {
    name: "interictal_epoch.edf",
    path: "demo/interictal_epoch.edf",
    size: 88 * 1024 * 1024,
  },
];

// Treat a couple of channels as the "epileptogenic" focus so HFO/IED/spikes
// concentrate there — makes the demo look clinically plausible.
const FOCUS = new Set(["A1", "A2", "B3"]);

function channelSeed(name: string): number {
  return hashStr(`seeg::${name}`);
}

// ── Per-sample signal model ──────────────────────────────────────────────────
// Returns a synthetic LFP value (µV) for one channel at time t.
function lfpValue(
  name: string,
  t: number,
  rnd: () => number,
  opts: { filtered: boolean; lineHz: number | null },
): number {
  const seed = channelSeed(name);
  const phase = (seed % 628) / 100;
  const alpha = 35 * Math.sin(2 * Math.PI * 10 * t + phase);
  const theta = 18 * Math.sin(2 * Math.PI * 6 * t + phase * 0.5);
  const beta = 8 * Math.sin(2 * Math.PI * 20 * t + phase * 1.7);
  // 1/f-ish background via summed low-frequency components.
  let background = 0;
  for (let k = 1; k <= 4; k++) {
    background += (12 / k) * Math.sin(2 * Math.PI * (0.7 * k) * t + (seed % (k * 97)));
  }
  const noise = (rnd() - 0.5) * (opts.filtered ? 18 : 30);
  let v = alpha + theta + beta + background + noise;

  if (!opts.filtered) {
    if (opts.lineHz) v += 22 * Math.sin(2 * Math.PI * opts.lineHz * t);
    v += 9 * Math.sin(2 * Math.PI * 120 * t + phase); // broadband high freq
  }

  // Interictal spikes on focus channels: sharp biphasic transient ~ every 1.3 s.
  if (FOCUS.has(name)) {
    const period = 1.3;
    const local = t % period;
    if (local < 0.06) {
      const u = (local - 0.03) / 0.012;
      v += 180 * Math.exp(-u * u) - 60 * Math.exp(-(((local - 0.05) / 0.01) ** 2));
    }
  }
  return v;
}

// ── Waveform ─────────────────────────────────────────────────────────────────
function autoOffset(rows: number[][]): number {
  let mx = 0;
  for (const row of rows) {
    if (!row.length) continue;
    mx = Math.max(mx, Math.max(...row) - Math.min(...row));
  }
  return mx * 1.2 || 1.0;
}

export function waveformFig(
  channels: string[],
  tStart: number,
  tStop: number,
  filtered: boolean,
  lineHz: number | null,
  title: string,
): PlotlyFigure {
  const n = Math.min(1400, Math.max(400, Math.round((tStop - tStart) * 220)));
  const times = linspace(tStart, tStop, n).map((v) => round(v, 4));
  const rnd = mulberry32(hashStr(`wave::${channels.join(",")}::${filtered}`));
  const rows = channels.map((name) =>
    times.map((t) => round(lfpValue(name, t, rnd, { filtered, lineHz }), 2)),
  );
  const offset = autoOffset(rows);
  const data = channels.map((label, i) => ({
    type: "scattergl",
    x: times,
    y: rows[i].map((v) => round(v + i * offset, 2)),
    mode: "lines",
    name: label,
    line: { width: 1 },
  }));
  const layout = {
    title,
    xaxis: { title: "时间 (s)" },
    yaxis: {
      title: "通道（叠加，单位 µV + 偏移）",
      tickmode: "array",
      tickvals: channels.map((_, i) => i * offset),
      ticktext: channels,
    },
    showlegend: false,
    margin: { l: 60, r: 20, t: 40, b: 40 },
  };
  return { data, layout };
}

// ── PSD ──────────────────────────────────────────────────────────────────────
export function psdFig(channels: string[], fmin: number, fmax: number, title: string): PlotlyFigure {
  const freqs = logspace(Math.max(fmin, 0.5), fmax, 220).map((v) => round(v, 3));
  const data = channels.map((name) => {
    const rnd = mulberry32(channelSeed(name) ^ 0x9e3779b9);
    const lift = FOCUS.has(name) ? 6 : 0;
    const y = freqs.map((f) => {
      let db = 30 - 18 * Math.log10(f); // 1/f background
      db += 11 * Math.exp(-(((f - 10) / 2.2) ** 2)); // alpha peak
      db += 6 * Math.exp(-(((f - 6) / 2.0) ** 2)); // theta
      db += (4 + lift) * Math.exp(-(((Math.log10(f) - Math.log10(70)) / 0.18) ** 2)); // gamma plateau
      // power-line spikes + harmonics
      for (const h of [50, 100, 150]) db += 14 * Math.exp(-(((f - h) / 0.8) ** 2));
      db += (rnd() - 0.5) * 2.5;
      return round(db, 2);
    });
    return { type: "scattergl", x: freqs, y, mode: "lines", name };
  });
  const layout = {
    title,
    xaxis: { title: "频率 (Hz)", type: "log" },
    yaxis: { title: "功率 (dB)" },
    margin: { l: 60, r: 20, t: 40, b: 40 },
  };
  return { data, layout };
}

// ── TFR (one heatmap per channel) ────────────────────────────────────────────
export function tfrFigs(
  channels: string[],
  fmin: number,
  fmax: number,
  nFreqs: number,
  tStart: number,
  tStop: number,
): { figures: PlotlyFigure[]; channels: string[] } {
  const sel = channels.slice(0, 4);
  const freqs = logspace(fmin, fmax, nFreqs).map((v) => round(v, 2));
  const times = linspace(tStart, tStop, 120).map((v) => round(v, 3));
  const figures = sel.map((ch) => {
    const rnd = mulberry32(channelSeed(ch) ^ 0x85ebca6b);
    const burstT = tStart + (tStop - tStart) * (0.35 + 0.3 * rnd());
    const z = freqs.map((f) =>
      times.map((t) => {
        let v = (rnd() - 0.5) * 1.5;
        // high-gamma burst
        const ft = Math.exp(-(((Math.log10(f) - Math.log10(80)) / 0.16) ** 2));
        const tt = Math.exp(-(((t - burstT) / 1.1) ** 2));
        v += (FOCUS.has(ch) ? 9 : 5) * ft * tt;
        // slow theta increase early
        v += 3 * Math.exp(-(((f - 6) / 3) ** 2)) * Math.exp(-(((t - (tStart + 2)) / 2) ** 2));
        return round(v, 2);
      }),
    );
    const trace = {
      type: "heatmap",
      x: times,
      y: freqs,
      z,
      colorscale: "RdBu",
      zmid: 0,
      colorbar: { title: "ΔdB" },
    };
    const layout = {
      title: `时频图 · ${ch}`,
      xaxis: { title: "时间 (s)" },
      yaxis: { title: "频率 (Hz)", type: "log" },
      margin: { l: 60, r: 20, t: 40, b: 40 },
    };
    return { data: [trace], layout };
  });
  return { figures, channels: sel };
}

// ── Band power heatmap ───────────────────────────────────────────────────────
const BANDS = ["delta", "theta", "alpha", "beta", "gamma", "high_gamma", "ripple"];

export function bandPowerFig(channels: string[]): PlotlyFigure {
  const z = channels.map((name) => {
    const rnd = mulberry32(channelSeed(name) ^ 0xc2b2ae35);
    const base = [28, 24, 22, 16, 8, 2, -6];
    return base.map((b, bi) => {
      let v = b + (rnd() - 0.5) * 3;
      if (FOCUS.has(name) && bi >= 4) v += 7; // focus has elevated HF power
      return round(v, 2);
    });
  });
  const trace = {
    type: "heatmap",
    x: BANDS,
    y: channels,
    z,
    colorscale: "Viridis",
    colorbar: { title: "dB" },
  };
  const layout = {
    title: "频段功率热图",
    xaxis: { title: "频段" },
    yaxis: { title: "通道" },
    margin: { l: 60, r: 20, t: 40, b: 60 },
  };
  return { data: [trace], layout };
}

// ── HFO ──────────────────────────────────────────────────────────────────────
interface HFOEvent {
  channel: string;
  t_start: number;
  peak_freq_hz: number;
}

export interface HFOResult {
  figure: PlotlyFigure;
  n_events: number;
  band: string;
  duration_sec: number;
  rate_per_min: Record<string, number>;
  fmin: number;
  fmax: number;
}

export function hfoResult(
  channels: string[],
  band: "ripple" | "fast_ripple",
  tStart: number,
  tStop: number,
): HFOResult {
  const [fmin, fmax] = band === "ripple" ? [80, 250] : [250, 500];
  const dur = tStop - tStart;
  const rnd = mulberry32(hashStr(`hfo::${band}::${channels.join(",")}`));
  const events: HFOEvent[] = [];
  const rate: Record<string, number> = {};
  for (const ch of channels) {
    const hot = FOCUS.has(ch);
    const lambda = hot ? (band === "ripple" ? 22 : 9) : band === "ripple" ? 3 : 1;
    const count = Math.max(0, Math.round(lambda * (0.7 + 0.6 * rnd())));
    for (let i = 0; i < count; i++) {
      events.push({
        channel: ch,
        t_start: round(tStart + dur * rnd(), 3),
        peak_freq_hz: round(fmin + (fmax - fmin) * rnd(), 1),
      });
    }
    rate[ch] = round((count / dur) * 60, 2);
  }
  const bandZh =
    band === "ripple" ? "Ripple (80–250Hz)" : "Fast Ripple (250–500Hz)";
  const rateChans = Object.keys(rate);
  const rateTrace = {
    type: "bar",
    x: rateChans,
    y: rateChans.map((c) => rate[c]),
    name: "events / min",
    marker: { color: "#f87171" },
    xaxis: "x2",
    yaxis: "y2",
  };
  const scatterTrace = {
    type: "scattergl",
    x: events.map((e) => e.t_start),
    y: events.map((e) => e.channel),
    mode: "markers",
    name: "events",
    marker: {
      size: 8,
      color: events.map((e) => e.peak_freq_hz),
      colorscale: "Inferno",
      colorbar: { title: "峰值频率 (Hz)", x: 1.02 },
      cmin: fmin,
      cmax: fmax,
    },
    text: events.map((e) => `${e.channel} · ${e.t_start.toFixed(2)}s · ${e.peak_freq_hz.toFixed(0)}Hz`),
    hoverinfo: "text",
  };
  const layout = {
    title: `HFO 检测 · ${bandZh}`,
    grid: { rows: 2, columns: 1, pattern: "independent" },
    xaxis: { title: "时间 (s)", domain: [0, 1] },
    yaxis: { title: "通道", domain: [0, 0.65], type: "category" },
    xaxis2: { title: "通道", domain: [0, 1], anchor: "y2", type: "category" },
    yaxis2: { title: "events / min", domain: [0.75, 1.0] },
    showlegend: false,
    margin: { l: 60, r: 80, t: 50, b: 40 },
  };
  return {
    figure: { data: [scatterTrace, rateTrace], layout },
    n_events: events.length,
    band,
    duration_sec: round(dur, 1),
    rate_per_min: rate,
    fmin,
    fmax,
  };
}

// ── IED ──────────────────────────────────────────────────────────────────────
interface IEDEvent {
  channel: string;
  t_peak: number;
  amplitude_uv: number;
  width_ms: number;
}

export interface IEDResult {
  figure: PlotlyFigure;
  n_events: number;
  duration_sec: number;
  rate_per_min: Record<string, number>;
}

export function iedResult(channels: string[], tStart: number, tStop: number): IEDResult {
  const dur = tStop - tStart;
  const rnd = mulberry32(hashStr(`ied::${channels.join(",")}`));
  const events: IEDEvent[] = [];
  const rate: Record<string, number> = {};
  for (const ch of channels) {
    const hot = FOCUS.has(ch);
    const count = Math.max(0, Math.round((hot ? 14 : 2) * (0.7 + 0.6 * rnd())));
    for (let i = 0; i < count; i++) {
      events.push({
        channel: ch,
        t_peak: round(tStart + dur * rnd(), 3),
        amplitude_uv: round((hot ? 180 : 90) * (0.6 + 0.8 * rnd()) * (rnd() > 0.5 ? 1 : -1), 1),
        width_ms: round(25 + 60 * rnd(), 1),
      });
    }
    rate[ch] = round((count / dur) * 60, 2);
  }
  const rateChans = Object.keys(rate);
  const rateTrace = {
    type: "bar",
    x: rateChans,
    y: rateChans.map((c) => rate[c]),
    marker: { color: "#fbbf24" },
    xaxis: "x2",
    yaxis: "y2",
  };
  const scatterTrace = {
    type: "scattergl",
    x: events.map((e) => e.t_peak),
    y: events.map((e) => e.channel),
    mode: "markers",
    marker: {
      size: 7,
      color: events.map((e) => Math.abs(e.amplitude_uv)),
      colorscale: "YlOrRd",
      colorbar: { title: "幅值 (µV)", x: 1.02 },
    },
    text: events.map(
      (e) =>
        `${e.channel} · ${e.t_peak.toFixed(2)}s · ${e.amplitude_uv.toFixed(0)}µV · ${e.width_ms.toFixed(0)}ms`,
    ),
    hoverinfo: "text",
  };
  const layout = {
    title: "IED（痫样放电）检测",
    grid: { rows: 2, columns: 1, pattern: "independent" },
    xaxis: { title: "时间 (s)", domain: [0, 1] },
    yaxis: { title: "通道", domain: [0, 0.65], type: "category" },
    xaxis2: { title: "通道", domain: [0, 1], anchor: "y2", type: "category" },
    yaxis2: { title: "events / min", domain: [0.75, 1.0] },
    showlegend: false,
    margin: { l: 60, r: 80, t: 50, b: 40 },
  };
  return {
    figure: { data: [scatterTrace, rateTrace], layout },
    n_events: events.length,
    duration_sec: round(dur, 1),
    rate_per_min: rate,
  };
}

// ── Connectivity ─────────────────────────────────────────────────────────────
const BAND_RANGE: Record<string, [number, number]> = {
  delta: [1, 4],
  theta: [4, 8],
  alpha: [8, 13],
  beta: [13, 30],
  gamma: [30, 80],
  high_gamma: [80, 150],
};

export interface ConnResult {
  figure: PlotlyFigure;
  method: string;
  band: string;
  channels: string[];
}

export function connectivityResult(
  channels: string[],
  method: "coh" | "plv" | "wpli" | "imcoh",
  band: string,
): ConnResult {
  const [fmin, fmax] = BAND_RANGE[band] ?? [30, 80];
  const rnd = mulberry32(hashStr(`conn::${method}::${band}::${channels.join(",")}`));
  const n = channels.length;
  const matrix: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    matrix[i][i] = 1;
    for (let j = i + 1; j < n; j++) {
      const neighbour = Math.abs(i - j) === 1 ? 0.35 : 0;
      const focus = FOCUS.has(channels[i]) && FOCUS.has(channels[j]) ? 0.25 : 0;
      let v = 0.15 + 0.55 * rnd() + neighbour + focus;
      v = Math.min(0.98, v);
      matrix[i][j] = round(v, 3);
      matrix[j][i] = matrix[i][j];
    }
  }
  const methodZh =
    { coh: "Coherence", plv: "PLV", wpli: "wPLI", imcoh: "imCoh" }[method] ?? method;
  const trace = {
    type: "heatmap",
    x: channels,
    y: channels,
    z: matrix,
    colorscale: "Plasma",
    zmin: 0,
    colorbar: { title: methodZh },
  };
  const layout = {
    title: `连接性 · ${methodZh} · ${band} (${fmin}–${fmax}Hz)`,
    xaxis: { title: "通道", type: "category" },
    yaxis: { title: "通道", type: "category", autorange: "reversed" },
    margin: { l: 60, r: 20, t: 50, b: 60 },
  };
  return { figure: { data: [trace], layout }, method, band, channels };
}

// ── One-click comprehensive report ───────────────────────────────────────────
export interface ReportCardLite {
  kind: "waveform" | "psd" | "bandpower" | "hfo" | "ied" | "connectivity";
  title: string;
  figure: PlotlyFigure;
}

export function reportCards(
  channels: string[],
  tWindow: number,
  notchHz: number | null,
  bpLow: number,
  bpHigh: number,
  maxChannels: number,
): { cards: ReportCardLite[]; summary: Record<string, unknown> } {
  const total = channels.length;
  let sampled = channels;
  let didSample = false;
  if (total > maxChannels) {
    const step = total / maxChannels;
    sampled = Array.from({ length: maxChannels }, (_, i) => channels[Math.floor(i * step)]);
    didSample = true;
  }
  const tStop = Math.min(tWindow, DEMO_DURATION);
  const cards: ReportCardLite[] = [
    {
      kind: "waveform",
      title: `滤波波形 (notch ${notchHz ?? "off"}Hz · ${bpLow}–${bpHigh}Hz)`,
      figure: waveformFig(sampled, 0, Math.min(10, tStop), true, null, "滤波波形"),
    },
    { kind: "psd", title: "功率谱密度", figure: psdFig(sampled, 1, 200, "功率谱密度 (PSD)") },
    { kind: "bandpower", title: "频段功率", figure: bandPowerFig(sampled) },
    {
      kind: "hfo",
      title: "HFO · Ripple",
      figure: hfoResult(sampled, "ripple", 0, tStop).figure,
    },
    { kind: "ied", title: "IED", figure: iedResult(sampled, 0, tStop).figure },
    {
      kind: "connectivity",
      title: "γ 连接性 · Coherence",
      figure: connectivityResult(sampled, "coh", "gamma").figure,
    },
  ];
  return {
    cards,
    summary: {
      channels: sampled,
      channels_total: total,
      channels_sampled: didSample,
      t_window_sec: tStop,
    },
  };
}

// ── Electrode synthesis (ported from backend electrode_io.synthesize) ─────────
export function synthesizeElectrodeSet(): ElectrodeSet {
  const byLead = new Map<string, ChannelInfo[]>();
  for (const c of DEMO_CHANNELS) {
    if (c.kind === "seeg" && c.lead) {
      if (!byLead.has(c.lead)) byLead.set(c.lead, []);
      byLead.get(c.lead)!.push(c);
    }
  }
  const sortedLeads = [...byLead.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const R = 70.0;
  const n = Math.max(1, sortedLeads.length);
  const contacts: Contact[] = [];
  sortedLeads.forEach(([lead, chans], i) => {
    const theta = (2 * Math.PI * i) / n;
    const hem = Math.cos(theta) >= 0 ? "L" : "R";
    const ex = R * Math.cos(theta);
    const ey = R * Math.sin(theta) * 0.6;
    const ez = 30 * Math.sin(2 * theta);
    const norm = Math.sqrt(ex * ex + ey * ey + ez * ez) || 1;
    const [dx, dy, dz] = [-ex / norm, -ey / norm, -ez / norm];
    const sorted = [...chans].sort((a, b) => (a.contact_index ?? 0) - (b.contact_index ?? 0));
    for (const c of sorted) {
      const depth = (c.contact_index ?? 1) * 3.5;
      contacts.push({
        channel_name: c.clean_name,
        x: round(ex + dx * depth, 2),
        y: round(ey + dy * depth, 2),
        z: round(ez + dz * depth, 2),
        hemisphere: hem,
        anat_label: `synthetic-${lead}`,
        source: "synthetic",
      });
    }
  });
  return { recording_id: DEMO_RECORDING_ID, source: "synthetic", contacts };
}

export function defaultChannels(): string[] {
  return SEEG_NAMES.slice(0, 4);
}

export { SEEG_NAMES };
