import { api } from "../api/client";
import { useAppStore } from "../store/appStore";

export function AnalysisToolbar() {
  const recording = useAppStore((s) => s.recording);
  const selected = useAppStore((s) => s.selectedChannels);
  const addResult = useAppStore((s) => s.addResult);
  const busy = useAppStore((s) => s.busy);
  const setBusy = useAppStore((s) => s.setBusy);
  const pp = useAppStore((s) => s.preprocessing);
  const setShowSettings = useAppStore((s) => s.setShowSettings);

  function chansOrDefault(): string[] {
    if (selected.length > 0) return selected;
    // Default to first 4 SEEG channels if nothing explicitly selected
    return (
      recording?.channels.filter((c) => c.kind === "seeg").slice(0, 4).map((c) => c.clean_name) ??
      []
    );
  }

  async function run<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
    if (!recording) return null;
    setBusy(true);
    try {
      return await fn();
    } catch (e) {
      alert(`${label} 失败: ${e}`);
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function onWaveform(withFilter: boolean) {
    const channels = chansOrDefault();
    if (!recording || channels.length === 0) return;
    const filterParams = withFilter
      ? {
          notch: pp.notch_hz != null ? [pp.notch_hz] : null,
          l_freq: pp.bp_low,
          h_freq: pp.bp_high,
        }
      : {};
    const res = await run("波形", () =>
      api.waveform({
        recording_id: recording.recording_id,
        channels,
        t_start: 0,
        t_stop: Math.min(pp.t_waveform, recording.duration_sec),
        ...filterParams,
      }),
    );
    if (res) {
      const title = withFilter
        ? `滤波波形 (notch ${pp.notch_hz ?? "off"}Hz · ${pp.bp_low ?? 0}–${pp.bp_high ?? 0}Hz)`
        : "原始波形";
      addResult({
        id: `wf-${Date.now()}`,
        kind: "waveform",
        title,
        figures: [res.figure],
        createdAt: Date.now(),
      });
    }
  }

  async function onPSD() {
    const channels = chansOrDefault();
    if (!recording || channels.length === 0) return;
    const res = await run("PSD", () =>
      api.psd({
        recording_id: recording.recording_id,
        channels,
        fmin: pp.psd_fmin,
        fmax: pp.psd_fmax,
      }),
    );
    if (res)
      addResult({
        id: `psd-${Date.now()}`,
        kind: "psd",
        title: `功率谱密度 (${pp.psd_fmin}–${pp.psd_fmax}Hz)`,
        figures: [res.figure],
        createdAt: Date.now(),
      });
  }

  async function onTFR() {
    const channels = chansOrDefault().slice(0, 4);
    if (!recording || channels.length === 0) return;
    const res = await run("时频图", () =>
      api.tfr({
        recording_id: recording.recording_id,
        channels,
        fmin: pp.tfr_fmin,
        fmax: Math.min(pp.tfr_fmax, recording.sfreq / 2 - 1),
        n_freqs: pp.tfr_n_freqs,
        t_start: 0,
        t_stop: Math.min(pp.t_tfr, recording.duration_sec),
      }),
    );
    if (res)
      addResult({
        id: `tfr-${Date.now()}`,
        kind: "tfr",
        title: `时频图 (${pp.tfr_fmin}–${pp.tfr_fmax}Hz, ${pp.tfr_n_freqs}频点)`,
        figures: res.figures,
        channels: res.channels,
        createdAt: Date.now(),
      });
  }

  async function onBandPower() {
    const channels = chansOrDefault();
    if (!recording || channels.length === 0) return;
    const res = await run("带功率", () =>
      api.bandPower({ recording_id: recording.recording_id, channels }),
    );
    if (res)
      addResult({
        id: `bp-${Date.now()}`,
        kind: "bandpower",
        title: "频段功率",
        figures: [res.figure],
        createdAt: Date.now(),
      });
  }

  async function onHFO(band: "ripple" | "fast_ripple") {
    const channels = chansOrDefault();
    if (!recording || channels.length === 0) return;
    const res = await run(`HFO·${band}`, () =>
      api.hfo({
        recording_id: recording.recording_id,
        channels,
        band,
        rms_z_thresh: pp.hfo_rms_z,
        ll_z_thresh: pp.hfo_ll_z,
        t_start: 0,
        t_stop: Math.min(pp.t_hfo, recording.duration_sec),
      }),
    );
    if (res)
      addResult({
        id: `hfo-${Date.now()}`,
        kind: "hfo",
        title: `HFO 检测 · ${band === "ripple" ? "Ripple" : "Fast Ripple"} (${res.n_events} 事件 / ${res.duration_sec.toFixed(0)}s)`,
        figures: [res.figure],
        createdAt: Date.now(),
      });
  }

  async function onIED() {
    const channels = chansOrDefault();
    if (!recording || channels.length === 0) return;
    const res = await run("IED", () =>
      api.ied({
        recording_id: recording.recording_id,
        channels,
        l_freq: pp.ied_l_freq,
        h_freq: pp.ied_h_freq,
        z_thresh: pp.ied_z,
        sharp_z_thresh: pp.ied_sharp_z,
        t_start: 0,
        t_stop: Math.min(pp.t_ied, recording.duration_sec),
      }),
    );
    if (res)
      addResult({
        id: `ied-${Date.now()}`,
        kind: "ied",
        title: `IED（痫样放电） · ${res.n_events} 事件 / ${res.duration_sec.toFixed(0)}s`,
        figures: [res.figure],
        createdAt: Date.now(),
      });
  }

  async function onReport() {
    const channels = chansOrDefault();
    if (!recording || channels.length === 0) return;
    // Browser cannot render 76 stacked waveforms × 5000pts in 6 figures
    // simultaneously. Cap to ~16 by default; ask before going bigger.
    let maxCh = pp.report_max_channels;
    if (channels.length > maxCh) {
      const ok = window.confirm(
        `已选 ${channels.length} 个通道。\n\n` +
        `综合报告会同时挂载 6 张大图，通道过多会导致浏览器假死或黑屏。\n\n` +
        `点击"确定"用 ${maxCh} 个均匀采样的通道生成报告（推荐），\n` +
        `点击"取消"放弃，改在工具栏挑选个别分析单独跑。\n\n` +
        `（可在右上角 ⚙ 设置里调整通道上限）`,
      );
      if (!ok) return;
    } else {
      maxCh = channels.length;
    }
    const res = await run("综合报告", () =>
      api.report({
        recording_id: recording.recording_id,
        channels,
        t_window_sec: Math.min(pp.t_report, recording.duration_sec),
        notch_hz: pp.notch_hz,
        bp_low: pp.bp_low ?? undefined,
        bp_high: pp.bp_high ?? undefined,
        max_channels: maxCh,
      }),
    );
    if (!res) return;
    const s = res.summary as Record<string, unknown>;
    const sampledNote = s.channels_sampled
      ? ` · 采样 ${(s.channels as string[]).length}/${s.channels_total}通道`
      : "";
    for (const card of res.cards) {
      addResult({
        id: `rep-${Date.now()}-${card.kind}`,
        kind: card.kind,
        title: `[报告] ${card.title}${sampledNote}`,
        figures: [card.figure],
        createdAt: Date.now(),
      });
    }
    console.log("综合报告 summary:", s);
  }

  async function onConnectivity(method: "coh" | "plv" | "wpli") {
    const channels = chansOrDefault();
    if (!recording || channels.length < 2) {
      alert("连接性分析至少需要 2 个通道");
      return;
    }
    const res = await run(`连接性·${method}`, () =>
      api.connectivity({
        recording_id: recording.recording_id,
        channels,
        method,
        band: pp.conn_band,
        epoch_sec: pp.conn_epoch_sec,
        t_start: 0,
        t_stop: Math.min(pp.t_connectivity, recording.duration_sec),
      }),
    );
    if (res)
      addResult({
        id: `conn-${Date.now()}`,
        kind: "connectivity",
        title: `连接性 · ${method.toUpperCase()} · ${res.band}`,
        figures: [res.figure],
        createdAt: Date.now(),
      });
  }

  const disabled = !recording || busy;
  return (
    <div className="toolbar">
      <button disabled={disabled} onClick={() => onWaveform(false)}>
        原始波形
      </button>
      <button disabled={disabled} onClick={() => onWaveform(true)}>
        滤波波形
      </button>
      <button disabled={disabled} onClick={onPSD}>
        PSD
      </button>
      <button disabled={disabled} onClick={onTFR}>
        时频图
      </button>
      <button disabled={disabled} onClick={onBandPower}>
        频段功率
      </button>
      <span className="toolbar-sep" />
      <button disabled={disabled} onClick={() => onHFO("ripple")} title="80–250Hz Ripple 检测">
        HFO·Ripple
      </button>
      <button disabled={disabled} onClick={() => onHFO("fast_ripple")} title="250–500Hz 快波纹">
        HFO·FR
      </button>
      <button disabled={disabled} onClick={onIED} title="痫样放电（尖波/棘波）">
        IED
      </button>
      <button disabled={disabled} onClick={() => onConnectivity("coh")} title="γ 频段相干性">
        连接·Coh
      </button>
      <button disabled={disabled} onClick={() => onConnectivity("wpli")} title="加权相位滞后指数">
        连接·wPLI
      </button>
      <span className="toolbar-sep" />
      <button
        disabled={disabled}
        onClick={onReport}
        title="一键运行：滤波波形 + PSD + 频段功率 + HFO Ripple + IED + γ Coh"
        className="primary"
      >
        一键综合报告
      </button>
      <button
        disabled={busy}
        onClick={() => setShowSettings(true)}
        title="打开预处理参数 / LLM Provider 设置"
        className="ghost-btn"
      >
        ⚙ 参数
      </button>
      <span className="muted hint">
        {selected.length > 0 ? `已选 ${selected.length} 通道` : "未选通道时默认用前 4 个 SEEG"}
      </span>
      {busy && <span className="busy">计算中…</span>}
    </div>
  );
}
