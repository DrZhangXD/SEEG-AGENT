import { useEffect, useMemo, useRef, useState } from "react";
import Plot from "./Plot";

import { api, type ElectrodeSet } from "../api/client";
import { useAppStore } from "../store/appStore";

function leadColor(lead: string): string {
  // Stable hue per lead letter.
  let h = 0;
  for (let i = 0; i < lead.length; i++) h = (h * 31 + lead.charCodeAt(i)) % 360;
  return `hsl(${h}, 70%, 60%)`;
}

function leadOf(name: string): string {
  return name.match(/^[A-Za-z]+/)?.[0] ?? "?";
}

function ellipsoid(rx = 80, ry = 100, rz = 70, n = 24) {
  // Translucent head shell as a Plotly mesh3d.
  const xs: number[] = [];
  const ys: number[] = [];
  const zs: number[] = [];
  for (let i = 0; i <= n; i++) {
    const phi = (Math.PI * i) / n - Math.PI / 2;
    for (let j = 0; j <= n; j++) {
      const theta = (2 * Math.PI * j) / n;
      xs.push(rx * Math.cos(phi) * Math.cos(theta));
      ys.push(ry * Math.cos(phi) * Math.sin(theta));
      zs.push(rz * Math.sin(phi));
    }
  }
  const I: number[] = [];
  const J: number[] = [];
  const K: number[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const a = i * (n + 1) + j;
      const b = a + 1;
      const c = a + n + 1;
      const d = c + 1;
      I.push(a, b);
      J.push(b, d);
      K.push(c, c);
    }
  }
  return {
    type: "mesh3d" as const,
    x: xs,
    y: ys,
    z: zs,
    i: I,
    j: J,
    k: K,
    opacity: 0.08,
    color: "#5aa7ff",
    flatshading: true,
    hoverinfo: "skip" as const,
    showscale: false,
  };
}

export function BrainPanel() {
  const recording = useAppStore((s) => s.recording);
  const selected = useAppStore((s) => s.selectedChannels);
  const toggleChannel = useAppStore((s) => s.toggleChannel);

  const [es, setEs] = useState<ElectrodeSet | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Fetch existing electrodes when recording changes; render only matching sets.
  useEffect(() => {
    if (!recording) return;
    let ignore = false;
    api
      .getElectrodes(recording.recording_id)
      .then((r) => {
        if (!ignore) setEs(r.contacts.length > 0 ? r : null);
      })
      .catch(() => {});
    return () => {
      ignore = true;
    };
  }, [recording]);

  async function onSynthesize() {
    if (!recording) return;
    setBusy(true);
    setErr(null);
    try {
      setEs(await api.synthesizeElectrodes(recording.recording_id));
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function onUpload(file: File) {
    if (!recording) return;
    setBusy(true);
    setErr(null);
    try {
      setEs(await api.uploadElectrodes(recording.recording_id, file));
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function onClear() {
    if (!recording) return;
    await api.clearElectrodes(recording.recording_id);
    setEs(null);
  }

  const activeEs = es && recording && es.recording_id === recording.recording_id ? es : null;

  const traces = useMemo(() => {
    if (!activeEs) return [];
    const byLead = new Map<string, ElectrodeSet["contacts"]>();
    for (const c of activeEs.contacts) {
      const k = leadOf(c.channel_name);
      if (!byLead.has(k)) byLead.set(k, []);
      byLead.get(k)!.push(c);
    }
    const out: object[] = [ellipsoid()];
    for (const [lead, chans] of byLead) {
      out.push({
        type: "scatter3d",
        mode: "markers+text",
        name: `电极 ${lead}`,
        x: chans.map((c) => c.x),
        y: chans.map((c) => c.y),
        z: chans.map((c) => c.z),
        text: chans.map((c) => c.channel_name),
        customdata: chans.map((c) => c.channel_name),
        hovertemplate:
          "%{customdata}<br>" +
          "MNI: (%{x:.1f}, %{y:.1f}, %{z:.1f}) mm<br>" +
          (chans[0].anat_label ? "" : "") +
          "<extra></extra>",
        marker: {
          size: chans.map((c) => (selected.includes(c.channel_name) ? 8 : 4)),
          color: leadColor(lead),
          line: {
            color: chans.map((c) => (selected.includes(c.channel_name) ? "#fff" : "transparent")),
            width: 2,
          },
        },
        textfont: { size: 9, color: "#bbb" },
      });
    }
    return out;
  }, [activeEs, selected]);

  return (
    <div className="brain-panel">
      <div className="signal-header">
        <h3>3D 脑图谱</h3>
        <div className="signal-actions">
          {activeEs && (
            <span className="muted">
              来源：{activeEs.source === "csv" ? "CSV 上传" : "合成占位"}
            </span>
          )}
          {activeEs && <button onClick={onClear}>清除</button>}
        </div>
      </div>
      <div className="toolbar">
        <button disabled={!recording || busy} onClick={onSynthesize}>
          生成合成坐标
        </button>
        <button disabled={!recording || busy} onClick={() => fileInputRef.current?.click()}>
          上传 CSV
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,.tsv"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onUpload(f);
            e.target.value = "";
          }}
        />
        <span className="muted hint">
          CSV 列：channel_name, x, y, z [, hemisphere, anat_label]（MNI152 mm）
        </span>
      </div>
      {err && <div className="error">{err}</div>}
      {!recording && <div className="muted placeholder">请先打开一个 EDF 文件</div>}
      {recording && !activeEs && (
        <div className="muted placeholder">
          点击 "生成合成坐标" 看到 76 个 SEEG 触点的占位 3D 视图，<br />
          或上传真实 MNI152 坐标 CSV。
        </div>
      )}
      {activeEs && (
        <div className="fig-wrap" style={{ height: 360 }}>
          <Plot
            data={traces as Plotly.Data[]}
            layout={{
              autosize: true,
              paper_bgcolor: "transparent",
              font: { color: "#e6e8ee", size: 11 },
              showlegend: true,
              legend: { font: { size: 10 } },
              margin: { l: 0, r: 0, t: 0, b: 0 },
              scene: {
                xaxis: { title: { text: "X (mm)" }, backgroundcolor: "transparent", color: "#888" },
                yaxis: { title: { text: "Y (mm)" }, backgroundcolor: "transparent", color: "#888" },
                zaxis: { title: { text: "Z (mm)" }, backgroundcolor: "transparent", color: "#888" },
                camera: { eye: { x: 1.5, y: 1.5, z: 1.0 } },
                aspectmode: "data",
              },
            }}
            useResizeHandler
            style={{ width: "100%", height: "100%" }}
            config={{ displaylogo: false, responsive: true }}
            onClick={(ev: Plotly.PlotMouseEvent) => {
              const pt = ev.points?.[0];
              const name = pt?.customdata as string | undefined;
              if (name) toggleChannel(name);
            }}
          />
        </div>
      )}
    </div>
  );
}
