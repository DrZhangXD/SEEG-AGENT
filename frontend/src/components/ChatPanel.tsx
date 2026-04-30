import { useEffect, useRef, useState } from "react";

import { api, type PlotlyFigure } from "../api/client";
import { useAppStore } from "../store/appStore";

interface ProviderInfo {
  id: string;
  label: string;
}

interface ChatMsg {
  role: "user" | "assistant" | "system";
  text: string;
  pending?: boolean;
}

type ServerMsg =
  | { type: "providers"; providers: ProviderInfo[] }
  | { type: "delta"; text: string }
  | { type: "figure"; kind: string; title: string; figures: PlotlyFigure[] }
  | { type: "done"; text: string }
  | { type: "error"; message: string };

function wsUrl(): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/ws/chat`;
}

export function ChatPanel() {
  const llm = useAppStore((s) => s.llmProvider);
  const setLlm = useAppStore((s) => s.setLlmProvider);
  const recording = useAppStore((s) => s.recording);
  const addResult = useAppStore((s) => s.addResult);

  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const messagesRef = useRef<HTMLDivElement | null>(null);

  // Connect once on mount, keep it open for the session.
  useEffect(() => {
    const ws = new WebSocket(wsUrl());
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);
    ws.onerror = () => setConnected(false);

    ws.onmessage = (ev) => {
      const m: ServerMsg = JSON.parse(ev.data);
      if (m.type === "providers") {
        setProviders(m.providers);
        if (m.providers.length > 0 && !m.providers.find((p) => p.id === llm)) {
          setLlm(m.providers[0].id);
        }
        return;
      }
      if (m.type === "delta") {
        setMsgs((cur) => {
          const out = [...cur];
          const last = out[out.length - 1];
          if (last && last.role === "assistant" && last.pending) {
            last.text += m.text;
          } else {
            out.push({ role: "assistant", text: m.text, pending: true });
          }
          return out;
        });
        return;
      }
      if (m.type === "figure") {
        addResult({
          id: `agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          kind: m.kind as "waveform" | "psd" | "tfr" | "bandpower" | "hfo" | "ied" | "connectivity",
          title: `🤖 ${m.title}`,
          figures: m.figures,
          createdAt: Date.now(),
        });
        return;
      }
      if (m.type === "done") {
        setMsgs((cur) => {
          const out = [...cur];
          const last = out[out.length - 1];
          if (last && last.role === "assistant" && last.pending) {
            last.text = m.text || last.text;
            last.pending = false;
          } else if (m.text) {
            out.push({ role: "assistant", text: m.text });
          }
          return out;
        });
        return;
      }
      if (m.type === "error") {
        setMsgs((cur) => [...cur, { role: "system", text: `⚠️ ${m.message}` }]);
        return;
      }
    };

    return () => {
      ws.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-scroll on new messages.
  useEffect(() => {
    messagesRef.current?.scrollTo({ top: messagesRef.current.scrollHeight, behavior: "smooth" });
  }, [msgs]);

  // When SettingsPanel adds/removes a custom provider, re-fetch the list so the
  // selector includes/drops it without needing to reload the page.
  useEffect(() => {
    function refresh() {
      api
        .listProviders()
        .then((ps) => {
          setProviders(ps);
          if (ps.length > 0 && !ps.find((p) => p.id === llm)) setLlm(ps[0].id);
        })
        .catch(() => {});
    }
    window.addEventListener("seeg:providers-changed", refresh);
    return () => window.removeEventListener("seeg:providers-changed", refresh);
  }, [llm, setLlm]);

  function send() {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      setMsgs((c) => [...c, { role: "system", text: "WebSocket 未连接，请刷新页面" }]);
      return;
    }
    const text = input.trim();
    if (!text) return;
    setMsgs((c) => [...c, { role: "user", text }]);
    setInput("");
    ws.send(
      JSON.stringify({
        type: "ask",
        provider: llm,
        recording_id: recording?.recording_id ?? null,
        message: text,
      }),
    );
  }

  return (
    <div className="chat-panel">
      <div className="chat-header">
        <h3>对话</h3>
        <select value={llm} onChange={(e) => setLlm(e.target.value)}>
          {providers.length === 0 ? (
            <option value="">未配置 provider</option>
          ) : (
            providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))
          )}
        </select>
      </div>
      <div className={`conn-status ${connected ? "ok" : "bad"}`}>
        {connected ? "● 已连接" : "○ 未连接"}
        {!recording && <span className="muted"> · 请先打开一个 EDF</span>}
      </div>
      <div className="messages" ref={messagesRef}>
        {msgs.length === 0 && (
          <div className="muted">
            示例问题：<br />
            · "对前 4 个通道做 1–70Hz 带通滤波，画出波形"<br />
            · "哪个通道的高 gamma 功率最高？"<br />
            · "画 A1–A4 在 0–10s 的时频图"
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>
            <div className="role">
              {m.role === "user" ? "你" : m.role === "assistant" ? "Agent" : "系统"}
              {m.pending && <span className="pending"> · 生成中…</span>}
            </div>
            <div className="text">{m.text}</div>
          </div>
        ))}
      </div>
      <div className="composer">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send();
          }}
          placeholder="输入消息，⌘/Ctrl+Enter 发送"
          rows={3}
          disabled={!connected}
        />
        <button onClick={send} disabled={!connected || !input.trim()}>
          发送
        </button>
      </div>
    </div>
  );
}
