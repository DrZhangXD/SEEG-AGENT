import { useEffect, useState } from "react";

import { api, type DemoFile } from "../api/client";
import { useAppStore } from "../store/appStore";

export function FileLoader() {
  const [demos, setDemos] = useState<DemoFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const recording = useAppStore((s) => s.recording);
  const setRecording = useAppStore((s) => s.setRecording);

  useEffect(() => {
    api.listDemo().then(setDemos).catch((e) => setErr(String(e)));
  }, []);

  async function openDemo(path: string) {
    setBusy(true);
    setErr(null);
    try {
      const meta = await api.openFile(path);
      setRecording(meta);
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function uploadLocal(file: File) {
    setBusy(true);
    setErr(null);
    try {
      const meta = await api.uploadFile(file);
      setRecording(meta);
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="file-loader">
      <h3>数据文件</h3>
      {err && <div className="error">{err}</div>}

      <div className="section-label">Demo 文件</div>
      {demos.length === 0 && <div className="muted">暂无 demo 文件</div>}
      <ul className="demo-list">
        {demos.map((d) => (
          <li key={d.path}>
            <button
              disabled={busy}
              onClick={() => openDemo(d.path)}
              className={recording?.path === d.path ? "active" : ""}
            >
              {d.name}
              <span className="size">{(d.size / 1024 / 1024).toFixed(1)} MB</span>
            </button>
          </li>
        ))}
      </ul>

      <div className="section-label">上传 EDF</div>
      <input
        type="file"
        accept=".edf"
        disabled={busy}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) uploadLocal(f);
        }}
      />

      {recording && (
        <div className="recording-meta">
          <div><b>{recording.filename}</b></div>
          <div>通道：{recording.n_channels}（SEEG {recording.n_seeg}）</div>
          <div>采样率：{recording.sfreq} Hz</div>
          <div>时长：{recording.duration_sec.toFixed(1)} s</div>
        </div>
      )}
    </div>
  );
}
