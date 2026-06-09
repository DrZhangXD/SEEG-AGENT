// In-browser stand-in for the `api` object in ../api/client and for the chat
// WebSocket. Active only when DEMO_MODE is on (static GitHub Pages build).

import type {
  ApiClient,
  Contact,
  CustomProviderView,
  ElectrodeSet,
  PlotlyFigure,
  ProviderInfo,
} from "../api/client";
import {
  bandPowerFig,
  connectivityResult,
  defaultChannels,
  demoMeta,
  DEMO_DURATION,
  DEMO_FILES,
  hfoResult,
  iedResult,
  psdFig,
  reportCards,
  synthesizeElectrodeSet,
  tfrFigs,
  waveformFig,
} from "./demoEngine";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Per-session electrode store so BrainPanel sees what was synthesized/uploaded.
const electrodeStore = new Map<string, ElectrodeSet>();

const DEMO_PROVIDERS: ProviderInfo[] = [
  { id: "demo-claude", label: "Claude Sonnet 4.5 (演示)" },
  { id: "demo-gpt4o", label: "GPT-4o (演示)" },
  { id: "demo-deepseek", label: "DeepSeek-V3 (演示)" },
  { id: "demo-qwen", label: "通义千问 Qwen-Max (演示)" },
];

function parseElectrodeCsv(text: string, recordingId: string): ElectrodeSet {
  const sample = text.split(/\r?\n/)[0] ?? "";
  const delim = sample.includes("\t") && !sample.includes(",") ? "\t" : ",";
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) throw new Error("CSV 至少需要表头 + 一行数据");
  const headers = lines[0].split(delim).map((h) => h.trim().toLowerCase());
  const need = ["channel_name", "x", "y", "z"];
  for (const h of need) {
    if (!headers.includes(h)) throw new Error(`CSV 缺少必填列：${h}`);
  }
  const idx = (name: string) => headers.indexOf(name);
  const contacts: Contact[] = lines.slice(1).map((line) => {
    const cells = line.split(delim);
    return {
      channel_name: cells[idx("channel_name")]?.trim() ?? "",
      x: Number(cells[idx("x")]),
      y: Number(cells[idx("y")]),
      z: Number(cells[idx("z")]),
      hemisphere: idx("hemisphere") >= 0 ? cells[idx("hemisphere")]?.trim() || null : null,
      anat_label: idx("anat_label") >= 0 ? cells[idx("anat_label")]?.trim() || null : null,
      source: "csv",
    };
  });
  return { recording_id: recordingId, source: "csv", contacts };
}

function isFiltered(req: { l_freq?: number | null; h_freq?: number | null; notch?: number[] | null }) {
  return req.l_freq != null || req.h_freq != null || (req.notch != null && req.notch.length > 0);
}

export const demoApi: ApiClient = {
  health: async () => {
    await sleep(120);
    return { status: "ok (demo)" };
  },
  listDemo: async () => {
    await sleep(150);
    return DEMO_FILES;
  },
  openFile: async (path: string) => {
    await sleep(300);
    const name = path.split("/").pop() ?? "demo_seeg_sample.edf";
    return demoMeta(path, name);
  },
  listOpen: async () => [demoMeta()],
  getRecording: async (id: string) => ({ ...demoMeta(), recording_id: id }),
  uploadFile: async (file: File) => {
    await sleep(400);
    return demoMeta(`uploads/${file.name}`, file.name);
  },
  waveform: async (req) => {
    await sleep(250);
    const filtered = isFiltered(req);
    const title = filtered
      ? `滤波波形 (notch ${req.notch?.[0] ?? "off"}Hz · ${req.l_freq ?? 0}–${req.h_freq ?? 0}Hz)`
      : "原始波形";
    return {
      kind: "waveform",
      figure: waveformFig(
        req.channels,
        req.t_start ?? 0,
        req.t_stop ?? Math.min(10, DEMO_DURATION),
        filtered,
        filtered ? null : 50,
        title,
      ),
    };
  },
  psd: async (req) => {
    await sleep(280);
    return {
      kind: "psd",
      figure: psdFig(req.channels, req.fmin ?? 1, req.fmax ?? 200, `功率谱密度 (${req.fmin ?? 1}–${req.fmax ?? 200}Hz)`),
    };
  },
  tfr: async (req) => {
    await sleep(400);
    const { figures, channels } = tfrFigs(
      req.channels,
      req.fmin ?? 2,
      req.fmax ?? 150,
      req.n_freqs ?? 40,
      req.t_start ?? 0,
      req.t_stop ?? 20,
    );
    return { kind: "tfr", figures, channels };
  },
  bandPower: async (req) => {
    await sleep(260);
    return { kind: "bandpower", figure: bandPowerFig(req.channels) };
  },
  hfo: async (req) => {
    await sleep(350);
    const r = hfoResult(req.channels, req.band ?? "ripple", req.t_start ?? 0, req.t_stop ?? 60);
    return {
      kind: "hfo",
      figure: r.figure,
      n_events: r.n_events,
      band: r.band,
      duration_sec: r.duration_sec,
      rate_per_min: r.rate_per_min,
    };
  },
  ied: async (req) => {
    await sleep(330);
    const r = iedResult(req.channels, req.t_start ?? 0, req.t_stop ?? 60);
    return {
      kind: "ied",
      figure: r.figure,
      n_events: r.n_events,
      duration_sec: r.duration_sec,
      rate_per_min: r.rate_per_min,
    };
  },
  connectivity: async (req) => {
    await sleep(360);
    const r = connectivityResult(req.channels, req.method ?? "coh", req.band ?? "gamma");
    return {
      kind: "connectivity",
      figure: r.figure,
      method: r.method,
      band: r.band,
      channels: r.channels,
    };
  },
  report: async (req) => {
    await sleep(600);
    const { cards, summary } = reportCards(
      req.channels,
      req.t_window_sec ?? 60,
      req.notch_hz ?? null,
      req.bp_low ?? 1,
      req.bp_high ?? 70,
      req.max_channels ?? 16,
    );
    return { kind: "report", cards, summary };
  },
  getElectrodes: async (recordingId: string) => {
    return (
      electrodeStore.get(recordingId) ?? {
        recording_id: recordingId,
        source: null,
        contacts: [],
      }
    );
  },
  synthesizeElectrodes: async (recordingId: string) => {
    await sleep(300);
    const es = synthesizeElectrodeSet();
    es.recording_id = recordingId;
    electrodeStore.set(recordingId, es);
    return es;
  },
  uploadElectrodes: async (recordingId: string, file: File) => {
    await sleep(300);
    const text = await file.text();
    const es = parseElectrodeCsv(text, recordingId);
    electrodeStore.set(recordingId, es);
    return es;
  },
  clearElectrodes: async (recordingId: string) => {
    electrodeStore.delete(recordingId);
    return { cleared: true };
  },
  listProviders: async () => DEMO_PROVIDERS,
  listCustomProviders: async () => [] as CustomProviderView[],
  upsertProvider: async (req) => ({
    id: req.id,
    label: req.label,
    provider_type: req.provider_type,
    model_name: req.model_name,
    base_url: req.base_url ?? null,
    has_api_key: Boolean(req.api_key),
    custom: true,
  }),
  deleteProvider: async (id: string) => ({ deleted: id }),
};

// ── Mock chat WebSocket ──────────────────────────────────────────────────────
type Listener = ((ev: { data: string }) => void) | null;

function pickAnalysis(message: string): {
  kind: "waveform" | "psd" | "tfr" | "bandpower" | "hfo" | "ied" | "connectivity";
  title: string;
  figures: PlotlyFigure[];
  reply: string;
} {
  const m = message.toLowerCase();
  const chans = defaultChannels();
  const has = (...keys: string[]) => keys.some((k) => m.includes(k) || message.includes(k));

  if (has("psd", "功率谱", "频谱")) {
    return {
      kind: "psd",
      title: "功率谱密度 (PSD)",
      figures: [psdFig(chans, 1, 200, "功率谱密度 (PSD)")],
      reply: `已对 ${chans.join("、")} 运行 Welch PSD（1–200 Hz）。可见清晰的 50 Hz 工频峰及其谐波，α(~10 Hz) 节律突出；${chans[0]} 在高 γ 频段功率偏高，提示可能的致痫倾向。`,
    };
  }
  if (has("时频", "tfr", "morlet", "time-freq")) {
    const r = tfrFigs(chans, 2, 150, 40, 0, 20);
    return {
      kind: "tfr",
      title: `时频图 · ${r.channels[0]}`,
      figures: r.figures.slice(0, 2),
      reply: `已对前 ${r.channels.length} 个通道做 Morlet 小波时频分析（2–150 Hz，基线校正 dB）。约第 8 秒出现一段高 γ 爆发，能量集中在 60–100 Hz。`,
    };
  }
  if (has("hfo", "ripple", "高频", "纹波", "快波")) {
    const band = has("fast", "fr", "快") ? "fast_ripple" : "ripple";
    const r = hfoResult(chans, band as "ripple" | "fast_ripple", 0, 60);
    const top = Object.entries(r.rate_per_min).sort((a, b) => b[1] - a[1])[0];
    return {
      kind: "hfo",
      title: `HFO 检测 · ${band === "ripple" ? "Ripple" : "Fast Ripple"}`,
      figures: [r.figure],
      reply: `在 60 s 窗内检测到 ${r.n_events} 个 ${band === "ripple" ? "Ripple(80–250Hz)" : "Fast Ripple(250–500Hz)"} 事件。发生率最高的是 ${top?.[0]}（${top?.[1].toFixed(1)} 次/分），与致痫区一致。注意：HFO 仅作筛查，需人工排除伪迹。`,
    };
  }
  if (has("ied", "痫样", "放电", "spike", "尖波", "棘波")) {
    const r = iedResult(chans, 0, 60);
    const top = Object.entries(r.rate_per_min).sort((a, b) => b[1] - a[1])[0];
    return {
      kind: "ied",
      title: "IED（痫样放电）检测",
      figures: [r.figure],
      reply: `检测到 ${r.n_events} 个痫样放电（IED）。${top?.[0]} 放电最频繁（${top?.[1].toFixed(1)} 次/分），波形呈典型尖-慢复合。`,
    };
  }
  if (has("连接", "coh", "connectivity", "相干", "plv", "wpli", "网络")) {
    const r = connectivityResult(chans, "coh", "gamma");
    return {
      kind: "connectivity",
      title: "连接性 · Coherence · gamma",
      figures: [r.figure],
      reply: `已计算 ${chans.join("、")} 的 γ 频段(30–80Hz) 相干矩阵。相邻触点与致痫区内部相干性最高，提示局部强耦合。`,
    };
  }
  if (has("频段功率", "band power", "bandpower", "band")) {
    return {
      kind: "bandpower",
      title: "频段功率热图",
      figures: [bandPowerFig(chans)],
      reply: `已计算各通道 δ/θ/α/β/γ/high_γ/ripple 频段功率（dB）。${chans[0]} 的高频段功率明显高于其余通道。`,
    };
  }
  // default → filtered waveform
  return {
    kind: "waveform",
    title: "滤波波形 (1–70Hz)",
    figures: [waveformFig(chans, 0, 10, true, null, "滤波波形 (notch 50Hz · 1–70Hz)")],
    reply: `已对 ${chans.join("、")} 做 50 Hz 陷波 + 1–70 Hz 带通滤波并绘制 0–10 s 波形。${chans[0]}/${chans[1]} 可见间歇性尖波，与致痫区吻合。`,
  };
}

class DemoChatSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSING = 2;
  readonly CLOSED = 3;

  readyState = 0;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: Listener = null;

  constructor() {
    setTimeout(() => {
      this.readyState = 1;
      this.onopen?.();
      this.emit({ type: "providers", providers: DEMO_PROVIDERS });
    }, 180);
  }

  private emit(obj: unknown) {
    this.onmessage?.({ data: JSON.stringify(obj) });
  }

  send(raw: string) {
    let msg: { type?: string; message?: string };
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (msg.type !== "ask") return;
    const { kind, title, figures, reply } = pickAnalysis(msg.message ?? "");

    // Stream the reply token-by-token, then push the figure, then finish.
    const tokens = reply.match(/[^\s，。；、]+[，。；、]?|\s+/g) ?? [reply];
    let i = 0;
    const streamNext = () => {
      if (this.readyState !== 1) return;
      if (i < tokens.length) {
        this.emit({ type: "delta", text: tokens[i] });
        i += 1;
        setTimeout(streamNext, 45);
        return;
      }
      this.emit({ type: "figure", kind, title, figures });
      setTimeout(() => this.emit({ type: "done", text: reply }), 120);
    };
    setTimeout(streamNext, 250);
  }

  close() {
    this.readyState = 3;
    this.onclose?.();
  }
}

// Install a WebSocket shim that simulates only the /ws/chat endpoint and
// delegates everything else to the native implementation.
export function installDemoWebSocket() {
  const Native = window.WebSocket;
  class PatchedWebSocket extends DemoChatSocket {
    constructor(url: string) {
      super();
      if (!url.includes("/ws/chat")) {
        return new Native(url) as unknown as PatchedWebSocket;
      }
    }
  }
  (window as unknown as { WebSocket: unknown }).WebSocket = PatchedWebSocket;
}
