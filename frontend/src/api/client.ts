import { DEMO_MODE } from "../demo/config";
import { demoApi } from "../demo/demoApi";

// Default is empty so Vite's dev proxy handles /api and /ws.
const BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}: ${await r.text()}`);
  return r.json() as Promise<T>;
}

export interface ChannelInfo {
  index: number;
  raw_name: string;
  clean_name: string;
  kind: "seeg" | "ekg" | "emg" | "eog" | "bp" | "other";
  lead: string | null;
  contact_index: number | null;
}

export interface RecordingMeta {
  recording_id: string;
  path: string;
  filename: string;
  sfreq: number;
  n_channels: number;
  n_seeg: number;
  duration_sec: number;
  channels: ChannelInfo[];
}

export interface DemoFile {
  name: string;
  path: string;
  size: number;
}

export interface PlotlyFigure {
  data: unknown[];
  layout: Record<string, unknown>;
}

export interface SingleFigureResponse {
  kind: "waveform" | "psd" | "bandpower";
  figure: PlotlyFigure;
}

export interface MultiFigureResponse {
  kind: "tfr";
  figures: PlotlyFigure[];
  channels: string[];
}

export interface WaveformReq {
  recording_id: string;
  channels: string[];
  t_start?: number;
  t_stop?: number | null;
  max_points?: number;
  l_freq?: number | null;
  h_freq?: number | null;
  notch?: number[] | null;
}

export interface PSDReq {
  recording_id: string;
  channels: string[];
  fmin?: number;
  fmax?: number;
}

export interface TFRReq {
  recording_id: string;
  channels: string[];
  fmin?: number;
  fmax?: number;
  n_freqs?: number;
  t_start?: number;
  t_stop?: number | null;
}

export interface BandPowerReq {
  recording_id: string;
  channels: string[];
}

export interface HFOReq {
  recording_id: string;
  channels: string[];
  band?: "ripple" | "fast_ripple";
  rms_z_thresh?: number;
  ll_z_thresh?: number;
  win_ms?: number;
  step_ms?: number;
  t_start?: number;
  t_stop?: number | null;
}

export interface HFOResponse {
  kind: "hfo";
  figure: PlotlyFigure;
  n_events: number;
  band: string;
  duration_sec: number;
  rate_per_min: Record<string, number>;
}

export interface IEDReq {
  recording_id: string;
  channels: string[];
  l_freq?: number;
  h_freq?: number;
  z_thresh?: number;
  sharp_z_thresh?: number;
  t_start?: number;
  t_stop?: number | null;
}

export interface IEDResponse {
  kind: "ied";
  figure: PlotlyFigure;
  n_events: number;
  duration_sec: number;
  rate_per_min: Record<string, number>;
}

export interface ConnectivityReq {
  recording_id: string;
  channels: string[];
  method?: "coh" | "plv" | "wpli" | "imcoh";
  band?: string;
  t_start?: number;
  t_stop?: number | null;
  epoch_sec?: number;
}

export interface ConnectivityResponse {
  kind: "connectivity";
  figure: PlotlyFigure;
  method: string;
  band: string;
  channels: string[];
}

export interface ReportReq {
  recording_id: string;
  channels: string[];
  t_window_sec?: number;
  notch_hz?: number | null;
  bp_low?: number;
  bp_high?: number;
  max_channels?: number;
}

export interface ReportCard {
  kind: "waveform" | "psd" | "bandpower" | "hfo" | "ied" | "connectivity";
  title: string;
  figure: PlotlyFigure;
}

export interface ReportResponse {
  kind: "report";
  cards: ReportCard[];
  summary: Record<string, unknown>;
}

const realApi = {
  health: () => request<{ status: string }>("/api/health"),
  listDemo: () => request<DemoFile[]>("/api/files/demo"),
  openFile: (path: string) =>
    request<RecordingMeta>("/api/files/open", {
      method: "POST",
      body: JSON.stringify({ path }),
    }),
  listOpen: () => request<RecordingMeta[]>("/api/files/open"),
  getRecording: (id: string) => request<RecordingMeta>(`/api/files/${id}`),
  uploadFile: async (file: File): Promise<RecordingMeta> => {
    const fd = new FormData();
    fd.append("file", file);
    const r = await fetch(`${BASE}/api/files/upload`, { method: "POST", body: fd });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  },
  waveform: (req: WaveformReq) =>
    request<SingleFigureResponse>("/api/analysis/waveform", {
      method: "POST",
      body: JSON.stringify(req),
    }),
  psd: (req: PSDReq) =>
    request<SingleFigureResponse>("/api/analysis/psd", {
      method: "POST",
      body: JSON.stringify(req),
    }),
  tfr: (req: TFRReq) =>
    request<MultiFigureResponse>("/api/analysis/tfr", {
      method: "POST",
      body: JSON.stringify(req),
    }),
  bandPower: (req: BandPowerReq) =>
    request<SingleFigureResponse>("/api/analysis/band_power", {
      method: "POST",
      body: JSON.stringify(req),
    }),
  hfo: (req: HFOReq) =>
    request<HFOResponse>("/api/analysis/hfo", {
      method: "POST",
      body: JSON.stringify(req),
    }),
  ied: (req: IEDReq) =>
    request<IEDResponse>("/api/analysis/ied", {
      method: "POST",
      body: JSON.stringify(req),
    }),
  connectivity: (req: ConnectivityReq) =>
    request<ConnectivityResponse>("/api/analysis/connectivity", {
      method: "POST",
      body: JSON.stringify(req),
    }),
  report: (req: ReportReq) =>
    request<ReportResponse>("/api/analysis/report", {
      method: "POST",
      body: JSON.stringify(req),
    }),
  getElectrodes: (recordingId: string) =>
    request<ElectrodeSet>(`/api/electrodes/${recordingId}`),
  synthesizeElectrodes: (recordingId: string) =>
    request<ElectrodeSet>(`/api/electrodes/${recordingId}/synthesize`, { method: "POST" }),
  uploadElectrodes: async (recordingId: string, file: File): Promise<ElectrodeSet> => {
    const fd = new FormData();
    fd.append("file", file);
    const r = await fetch(`${BASE}/api/electrodes/${recordingId}/upload`, {
      method: "POST",
      body: fd,
    });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  },
  clearElectrodes: (recordingId: string) =>
    request<{ cleared: boolean }>(`/api/electrodes/${recordingId}`, { method: "DELETE" }),
  listProviders: () => request<ProviderInfo[]>("/api/providers"),
  listCustomProviders: () => request<CustomProviderView[]>("/api/providers/custom"),
  upsertProvider: (req: CreateProviderReq) =>
    request<CustomProviderView>("/api/providers", {
      method: "POST",
      body: JSON.stringify(req),
    }),
  deleteProvider: (id: string) =>
    request<{ deleted: string }>(`/api/providers/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),
};

// In demo mode (static GitHub Pages build) every call is served by an in-browser
// simulator; otherwise we talk to the FastAPI backend.
export type ApiClient = typeof realApi;
export const api: ApiClient = DEMO_MODE ? demoApi : realApi;

export interface ProviderInfo {
  id: string;
  label: string;
  custom?: boolean;
}

export interface CustomProviderView {
  id: string;
  label: string;
  provider_type: "anthropic" | "openai_compat";
  model_name: string;
  base_url: string | null;
  has_api_key: boolean;
  custom: boolean;
}

export interface CreateProviderReq {
  id: string;
  label: string;
  provider_type: "anthropic" | "openai_compat";
  model_name: string;
  api_key: string;
  base_url?: string | null;
}

export interface Contact {
  channel_name: string;
  x: number;
  y: number;
  z: number;
  hemisphere: string | null;
  anat_label: string | null;
  source: "csv" | "synthetic";
}

export interface ElectrodeSet {
  recording_id: string;
  source: "csv" | "synthetic" | null;
  contacts: Contact[];
}

export { BASE };
