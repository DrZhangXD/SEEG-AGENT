import { create } from "zustand";

import type { PlotlyFigure, RecordingMeta } from "../api/client";

export interface AnalysisResult {
  id: string;
  title: string;
  kind: "waveform" | "psd" | "tfr" | "bandpower" | "hfo" | "ied" | "connectivity";
  figures: PlotlyFigure[];
  channels?: string[];
  createdAt: number;
}

export interface PreprocessingSettings {
  // 工频陷波：null = 关闭
  notch_hz: number | null;
  // 带通：null = 不滤
  bp_low: number | null;
  bp_high: number | null;
  // 默认时间窗（秒）
  t_waveform: number;
  t_tfr: number;
  t_hfo: number;
  t_ied: number;
  t_connectivity: number;
  t_report: number;
  // PSD 频率范围
  psd_fmin: number;
  psd_fmax: number;
  // TFR 频率范围
  tfr_fmin: number;
  tfr_fmax: number;
  tfr_n_freqs: number;
  // HFO 阈值
  hfo_rms_z: number;
  hfo_ll_z: number;
  // IED 阈值
  ied_z: number;
  ied_sharp_z: number;
  ied_l_freq: number;
  ied_h_freq: number;
  // 连接性
  conn_method: "coh" | "plv" | "wpli" | "imcoh";
  conn_band: string;
  conn_epoch_sec: number;
  // 综合报告通道上限
  report_max_channels: number;
}

export const DEFAULT_PREPROCESSING: PreprocessingSettings = {
  notch_hz: 50,
  bp_low: 1,
  bp_high: 70,
  t_waveform: 10,
  t_tfr: 20,
  t_hfo: 60,
  t_ied: 60,
  t_connectivity: 30,
  t_report: 60,
  psd_fmin: 1,
  psd_fmax: 200,
  tfr_fmin: 2,
  tfr_fmax: 150,
  tfr_n_freqs: 40,
  hfo_rms_z: 5,
  hfo_ll_z: 5,
  ied_z: 6,
  ied_sharp_z: 4,
  ied_l_freq: 10,
  ied_h_freq: 70,
  conn_method: "coh",
  conn_band: "gamma",
  conn_epoch_sec: 2,
  report_max_channels: 16,
};

interface AppState {
  recording: RecordingMeta | null;
  selectedChannels: string[]; // clean_name list
  llmProvider: string;
  results: AnalysisResult[];
  busy: boolean;
  preprocessing: PreprocessingSettings;
  showSettings: boolean;
  setRecording: (r: RecordingMeta | null) => void;
  setSelected: (names: string[]) => void;
  toggleChannel: (name: string) => void;
  setLlmProvider: (p: string) => void;
  addResult: (r: AnalysisResult) => void;
  clearResults: () => void;
  setBusy: (b: boolean) => void;
  setPreprocessing: (patch: Partial<PreprocessingSettings>) => void;
  resetPreprocessing: () => void;
  setShowSettings: (b: boolean) => void;
}

// localStorage 持久化预处理设置
const PP_KEY = "seeg-agent.preprocessing";
function loadPP(): PreprocessingSettings {
  try {
    const raw = localStorage.getItem(PP_KEY);
    if (!raw) return DEFAULT_PREPROCESSING;
    return { ...DEFAULT_PREPROCESSING, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_PREPROCESSING;
  }
}
function savePP(p: PreprocessingSettings) {
  try {
    localStorage.setItem(PP_KEY, JSON.stringify(p));
  } catch {
    /* ignore quota errors */
  }
}

export const useAppStore = create<AppState>((set) => ({
  recording: null,
  selectedChannels: [],
  llmProvider: "claude-sonnet-4.6",
  results: [],
  busy: false,
  preprocessing: loadPP(),
  showSettings: false,
  setRecording: (r) => set({ recording: r, selectedChannels: [], results: [] }),
  setSelected: (names) => set({ selectedChannels: names }),
  toggleChannel: (name) =>
    set((s) => ({
      selectedChannels: s.selectedChannels.includes(name)
        ? s.selectedChannels.filter((n) => n !== name)
        : [...s.selectedChannels, name],
    })),
  setLlmProvider: (p) => set({ llmProvider: p }),
  addResult: (r) => set((s) => ({ results: [r, ...s.results].slice(0, 30) })),
  clearResults: () => set({ results: [] }),
  setBusy: (b) => set({ busy: b }),
  setPreprocessing: (patch) =>
    set((s) => {
      const next = { ...s.preprocessing, ...patch };
      savePP(next);
      return { preprocessing: next };
    }),
  resetPreprocessing: () => {
    savePP(DEFAULT_PREPROCESSING);
    set({ preprocessing: DEFAULT_PREPROCESSING });
  },
  setShowSettings: (b) => set({ showSettings: b }),
}));
