import { useEffect, useState } from "react";

import { api, type CustomProviderView } from "../api/client";
import { useAppStore, type PreprocessingSettings } from "../store/appStore";

type Tab = "preprocess" | "llm";

export function SettingsPanel() {
  const show = useAppStore((s) => s.showSettings);
  const setShow = useAppStore((s) => s.setShowSettings);
  const [tab, setTab] = useState<Tab>("preprocess");

  if (!show) return null;
  return (
    <div className="settings-overlay" onClick={() => setShow(false)}>
      <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
        <header className="settings-head">
          <h3>设置</h3>
          <div className="tabs">
            <button
              className={tab === "preprocess" ? "active" : ""}
              onClick={() => setTab("preprocess")}
            >
              预处理参数
            </button>
            <button className={tab === "llm" ? "active" : ""} onClick={() => setTab("llm")}>
              LLM Provider
            </button>
          </div>
          <button className="close" onClick={() => setShow(false)} title="关闭">
            ×
          </button>
        </header>
        <div className="settings-body">
          {tab === "preprocess" ? <PreprocessTab /> : <LlmTab />}
        </div>
      </div>
    </div>
  );
}

// ---- Preprocessing tab ----

function PreprocessTab() {
  const pp = useAppStore((s) => s.preprocessing);
  const setPP = useAppStore((s) => s.setPreprocessing);
  const reset = useAppStore((s) => s.resetPreprocessing);

  function num(
    label: string,
    key: keyof PreprocessingSettings,
    step = 1,
    nullable = false,
  ) {
    const v = pp[key] as number | null;
    return (
      <label className="form-row" key={key as string}>
        <span>{label}</span>
        <input
          type="number"
          step={step}
          value={v == null ? "" : v}
          placeholder={nullable ? "（关闭）" : ""}
          onChange={(e) => {
            const raw = e.target.value;
            const val = raw === "" ? (nullable ? null : 0) : Number(raw);
            setPP({ [key]: val } as Partial<PreprocessingSettings>);
          }}
        />
      </label>
    );
  }

  return (
    <div className="form">
      <p className="muted small">
        所有参数实时持久化到浏览器 localStorage，刷新后保留。后端按你最新设置跑分析，不需要重启。
      </p>

      <Section title="工频陷波 / 带通滤波">
        {num("工频陷波 Hz（留空关闭）", "notch_hz", 1, true)}
        {num("带通低截止 Hz（留空关闭）", "bp_low", 0.1, true)}
        {num("带通高截止 Hz（留空关闭）", "bp_high", 1, true)}
        <p className="muted small">
          管线：先 <code>raw.notch_filter([notch_hz])</code> 去工频；再
          <code>raw.filter(l_freq=bp_low, h_freq=bp_high)</code>，FIR / firwin / zero-phase。
        </p>
      </Section>

      <Section title="默认时间窗（秒）">
        {num("波形", "t_waveform")}
        {num("时频图", "t_tfr")}
        {num("HFO", "t_hfo")}
        {num("IED", "t_ied")}
        {num("连接性", "t_connectivity")}
        {num("综合报告", "t_report")}
      </Section>

      <Section title="PSD（Welch）">
        {num("最小频率 Hz", "psd_fmin")}
        {num("最大频率 Hz", "psd_fmax")}
      </Section>

      <Section title="时频图（Morlet 小波）">
        {num("最小频率 Hz", "tfr_fmin")}
        {num("最大频率 Hz", "tfr_fmax")}
        {num("频点数", "tfr_n_freqs")}
      </Section>

      <Section title="HFO 检测（RMS + Line-Length 双 z 阈值）">
        {num("RMS z 阈值", "hfo_rms_z", 0.5)}
        {num("Line-Length z 阈值", "hfo_ll_z", 0.5)}
        <p className="muted small">
          Ripple = 80–250Hz，Fast Ripple = 250–500Hz。需要 sfreq ≥ 1000Hz 才能看 FR。
        </p>
      </Section>

      <Section title="IED 检测（带通后幅值 + 二阶差分双 z）">
        {num("带通低截止 Hz", "ied_l_freq", 1)}
        {num("带通高截止 Hz", "ied_h_freq", 1)}
        {num("幅值 z 阈值", "ied_z", 0.5)}
        {num("尖锐度 z 阈值", "ied_sharp_z", 0.5)}
      </Section>

      <Section title="连接性">
        <label className="form-row">
          <span>方法</span>
          <select
            value={pp.conn_method}
            onChange={(e) =>
              setPP({ conn_method: e.target.value as PreprocessingSettings["conn_method"] })
            }
          >
            <option value="coh">Coherence</option>
            <option value="plv">PLV</option>
            <option value="wpli">wPLI</option>
            <option value="imcoh">imCoh</option>
          </select>
        </label>
        <label className="form-row">
          <span>频段</span>
          <select
            value={pp.conn_band}
            onChange={(e) => setPP({ conn_band: e.target.value })}
          >
            <option value="delta">delta (1–4)</option>
            <option value="theta">theta (4–8)</option>
            <option value="alpha">alpha (8–13)</option>
            <option value="beta">beta (13–30)</option>
            <option value="gamma">gamma (30–80)</option>
            <option value="high_gamma">high_gamma (80–150)</option>
          </select>
        </label>
        {num("epoch 长度（秒）", "conn_epoch_sec", 0.5)}
      </Section>

      <Section title="综合报告">
        {num("通道上限（防黑屏）", "report_max_channels")}
        <p className="muted small">
          通道数超过这个上限时，会跨电极杆均匀采样到该数量再跑报告。
        </p>
      </Section>

      <div className="form-actions">
        <button onClick={reset} className="ghost">
          恢复默认
        </button>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="form-section">
      <h4>{title}</h4>
      {children}
    </div>
  );
}

// ---- LLM tab ----

const PROVIDER_PRESETS: {
  key: string;
  label: string;
  provider_type: "anthropic" | "openai_compat";
  model_name: string;
  base_url?: string;
  hint: string;
}[] = [
  {
    key: "anthropic",
    label: "Anthropic Claude",
    provider_type: "anthropic",
    model_name: "claude-sonnet-4-5",
    hint: "官方 SDK，无需 base_url",
  },
  {
    key: "openai",
    label: "OpenAI",
    provider_type: "openai_compat",
    model_name: "gpt-4o",
    base_url: "https://api.openai.com/v1",
    hint: "官方 API",
  },
  {
    key: "deepseek",
    label: "DeepSeek",
    provider_type: "openai_compat",
    model_name: "deepseek-chat",
    base_url: "https://api.deepseek.com/v1",
    hint: "OpenAI 兼容",
  },
  {
    key: "qwen",
    label: "通义千问 (DashScope)",
    provider_type: "openai_compat",
    model_name: "qwen-plus",
    base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    hint: "OpenAI 兼容",
  },
  {
    key: "kimi",
    label: "Kimi (Moonshot)",
    provider_type: "openai_compat",
    model_name: "moonshot-v1-128k",
    base_url: "https://api.moonshot.cn/v1",
    hint: "OpenAI 兼容",
  },
  {
    key: "ollama",
    label: "Ollama (本地)",
    provider_type: "openai_compat",
    model_name: "qwen2.5:14b",
    base_url: "http://localhost:11434/v1",
    hint: "本地无 key 写任意值",
  },
  {
    key: "custom",
    label: "自定义 OpenAI 兼容",
    provider_type: "openai_compat",
    model_name: "",
    base_url: "",
    hint: "",
  },
];

function LlmTab() {
  const [list, setList] = useState<CustomProviderView[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // form
  const [preset, setPreset] = useState<string>("deepseek");
  const [id, setId] = useState("");
  const [label, setLabel] = useState("");
  const [providerType, setProviderType] = useState<"anthropic" | "openai_compat">(
    "openai_compat",
  );
  const [modelName, setModelName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");

  async function refresh() {
    try {
      setList(await api.listCustomProviders());
    } catch (e) {
      setErr(String(e));
    }
  }

  useEffect(() => {
    let ignore = false;
    api
      .listCustomProviders()
      .then((providers) => {
        if (!ignore) setList(providers);
      })
      .catch((e) => {
        if (!ignore) setErr(String(e));
      });
    return () => {
      ignore = true;
    };
  }, []);

  function applyPreset(key: string) {
    setPreset(key);
    const p = PROVIDER_PRESETS.find((x) => x.key === key);
    if (!p) return;
    setProviderType(p.provider_type);
    setModelName(p.model_name);
    setBaseUrl(p.base_url ?? "");
    if (!label) setLabel(p.label);
    if (!id) setId(`${key}-${Math.random().toString(36).slice(2, 6)}`);
  }

  async function onAdd(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!id || !modelName || !apiKey) {
      setErr("id / model_name / api_key 都不能为空");
      return;
    }
    if (providerType === "openai_compat" && !baseUrl) {
      setErr("OpenAI 兼容接口需要 base_url");
      return;
    }
    setLoading(true);
    try {
      await api.upsertProvider({
        id,
        label: label || id,
        provider_type: providerType,
        model_name: modelName,
        api_key: apiKey,
        base_url: providerType === "openai_compat" ? baseUrl : null,
      });
      // reset key field, keep meta for fast-add of similar providers
      setApiKey("");
      await refresh();
      // also bounce ChatPanel's WS so its provider list refreshes; cheapest way:
      window.dispatchEvent(new CustomEvent("seeg:providers-changed"));
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function onDelete(pid: string) {
    if (!window.confirm(`删除 provider "${pid}"？`)) return;
    try {
      await api.deleteProvider(pid);
      await refresh();
      window.dispatchEvent(new CustomEvent("seeg:providers-changed"));
    } catch (e) {
      setErr(String(e));
    }
  }

  return (
    <div className="form">
      <p className="muted small">
        自定义 provider 持久化在 <code>~/.seeg-agent/providers.json</code>（仅本地，明文）。
        env 里的 key（ANTHROPIC/OPENAI/DEEPSEEK/DASHSCOPE/MOONSHOT/OLLAMA）依然有效，
        和这里的自定义 provider 合并显示。
      </p>

      <h4>已添加</h4>
      {list.length === 0 ? (
        <div className="muted small">暂无自定义 provider。</div>
      ) : (
        <table className="provider-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>名称</th>
              <th>类型</th>
              <th>模型</th>
              <th>Base URL</th>
              <th>Key</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {list.map((p) => (
              <tr key={p.id}>
                <td>
                  <code>{p.id}</code>
                </td>
                <td>{p.label}</td>
                <td>{p.provider_type}</td>
                <td>
                  <code>{p.model_name}</code>
                </td>
                <td className="muted small">{p.base_url ?? "—"}</td>
                <td>{p.has_api_key ? "✓" : "—"}</td>
                <td>
                  <button className="ghost danger" onClick={() => onDelete(p.id)}>
                    删除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h4 style={{ marginTop: 16 }}>添加 / 更新</h4>
      <form onSubmit={onAdd}>
        <label className="form-row">
          <span>预设</span>
          <select value={preset} onChange={(e) => applyPreset(e.target.value)}>
            {PROVIDER_PRESETS.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <label className="form-row">
          <span>ID（唯一）</span>
          <input
            value={id}
            onChange={(e) => setId(e.target.value)}
            placeholder="例如 deepseek-my"
          />
        </label>
        <label className="form-row">
          <span>显示名称</span>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="DeepSeek (我的)"
          />
        </label>
        <label className="form-row">
          <span>类型</span>
          <select
            value={providerType}
            onChange={(e) =>
              setProviderType(e.target.value as "anthropic" | "openai_compat")
            }
          >
            <option value="openai_compat">openai_compat</option>
            <option value="anthropic">anthropic</option>
          </select>
        </label>
        <label className="form-row">
          <span>模型名</span>
          <input
            value={modelName}
            onChange={(e) => setModelName(e.target.value)}
            placeholder="deepseek-chat / qwen-plus / claude-sonnet-4-5"
          />
        </label>
        {providerType === "openai_compat" && (
          <label className="form-row">
            <span>Base URL</span>
            <input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://api.deepseek.com/v1"
            />
          </label>
        )}
        <label className="form-row">
          <span>API Key</span>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-..."
          />
        </label>
        {err && <div className="error">{err}</div>}
        <div className="form-actions">
          <button type="submit" disabled={loading} className="primary">
            {loading ? "保存中…" : "保存"}
          </button>
        </div>
      </form>
    </div>
  );
}
