import { useEffect, useState } from "react";

import "./App.css";
import { api } from "./api/client";
import { BrainPanel } from "./components/BrainPanel";
import { ChannelList } from "./components/ChannelList";
import { ChatPanel } from "./components/ChatPanel";
import { FileLoader } from "./components/FileLoader";
import { SettingsPanel } from "./components/SettingsPanel";
import { SignalPanel } from "./components/SignalPanel";
import { DEMO_MODE } from "./demo/config";
import { DemoBanner } from "./demo/DemoBanner";
import { useAppStore } from "./store/appStore";

function App() {
  const [backendOk, setBackendOk] = useState<boolean | null>(null);
  const setShowSettings = useAppStore((s) => s.setShowSettings);
  const recording = useAppStore((s) => s.recording);
  const setRecording = useAppStore((s) => s.setRecording);

  useEffect(() => {
    api
      .health()
      .then(() => setBackendOk(true))
      .catch(() => setBackendOk(false));
  }, []);

  // In the static demo, open the sample recording automatically so the panels
  // light up without a click.
  useEffect(() => {
    if (!DEMO_MODE || recording) return;
    api
      .listDemo()
      .then((files) => (files[0] ? api.openFile(files[0].path) : null))
      .then((meta) => {
        if (meta) setRecording(meta);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="app">
      {DEMO_MODE && <DemoBanner />}
      <header className="topbar">
        <div className="brand">SEEG-AGENT</div>
        <div className="topbar-right">
          <div className="status">
            后端：
            {backendOk === null ? "…" : backendOk ? (
              <span className="ok">已连接</span>
            ) : (
              <span className="bad">未连接</span>
            )}
          </div>
          <button
            className="gear"
            title="设置（预处理参数 / LLM Provider）"
            onClick={() => setShowSettings(true)}
          >
            ⚙ 设置
          </button>
        </div>
      </header>
      <SettingsPanel />
      <main className="layout">
        <aside className="sidebar">
          <FileLoader />
          <ChannelList />
        </aside>
        <section className="center">
          <SignalPanel />
          <BrainPanel />
        </section>
        <aside className="right">
          <ChatPanel />
        </aside>
      </main>
    </div>
  );
}

export default App;
