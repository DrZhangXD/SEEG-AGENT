# SEEG-AGENT

**简体中文** · [English](./README.md)

面向 SEEG（立体脑电图）LFP 信号分析的交互式 agent 工作台。

> **🔴 在线 Demo：** **https://drzhangxd.github.io/seeg-agent/**
> 纯浏览器端的可交互演示——所有分析与 LLM 对话均在前端**模拟**，使用合成示例数据（无真实病例、无后端）。需要真实 MNE 计算与在线大模型，请参照[快速开始](#快速开始)本地部署。

**核心特性**
- 交互式中文 Web 界面（Vite + React + TypeScript + Zustand）
- 多大模型后端可热切换：Anthropic Claude、OpenAI、DeepSeek、通义千问、Kimi、本地 Ollama
- LFP 分析全套：滤波、PSD（Welch）、时频图（Morlet）、频段功率、HFO（Ripple / Fast Ripple）、IED（间期痫样放电）、频段连接性（coh / plv / wpli / imcoh）
- 3D 电极触点可视化（Plotly scatter3d + 头壳网格），支持 CSV/TSV 上传或合成占位坐标
- 一键综合分析报告：滤波波形 + PSD + 频段功率 + HFO + IED + γ 连接性 一次产出
- 基于 [MNE-Python](https://mne.tools/) + [mne-connectivity](https://mne.tools/mne-connectivity/) + [Pydantic AI](https://ai.pydantic.dev/)

---

## 目录结构

```
SEEG-AGENT/
├── backend/         # FastAPI + MNE + Pydantic AI
│   ├── app/
│   │   ├── api/             # files / analysis / electrodes / chat (WS)
│   │   ├── analysis/        # 纯函数 MNE 封装
│   │   ├── agent/           # Pydantic AI agent + multi-provider
│   │   ├── io/              # EDF loader / electrode CSV / session store
│   │   └── viz/             # Plotly JSON serializers
│   └── tests/
├── frontend/        # Vite + React + Plotly + Zustand
│   └── src/
│       ├── components/      # ChatPanel / SignalPanel / BrainPanel / ChannelList ...
│       ├── api/             # 类型化 fetch/WS 客户端
│       └── store/           # Zustand 状态
├── demo/            # 示例 EDF
├── .env.example     # LLM 密钥模板
└── Makefile
```

## 环境要求

- Python ≥ 3.11（用 `uv` 管理虚拟环境）
- Node ≥ 20（推荐 22/24）
- macOS / Linux；Windows 未测试

## 快速开始

```bash
# 1. 复制环境变量模板
cp .env.example backend/.env   # 填入你的 ANTHROPIC_API_KEY 等

# 2. 安装依赖
make install

# 3. 启动后端（终端 A）
make backend        # http://127.0.0.1:8000/docs

# 4. 启动前端（终端 B）
make frontend       # http://127.0.0.1:5173
```

首次打开前端，在左侧 "Demo 文件" 列表点击任一 `.edf` 即可加载。

## 启用 LLM Provider

`backend/.env` 中只要填了对应 `*_API_KEY`，前端模型下拉就会出现该 provider：

```bash
ANTHROPIC_API_KEY=sk-ant-...        # Claude（claude-sonnet-4.5 / opus / haiku）
OPENAI_API_KEY=sk-...               # GPT-4o / GPT-4.1
DEEPSEEK_API_KEY=sk-...             # DeepSeek-V3 / DeepSeek-R1
DASHSCOPE_API_KEY=sk-...            # 通义 Qwen-Max / Qwen-Plus
MOONSHOT_API_KEY=sk-...             # Kimi K2
# Ollama 本地无需 key，启动 `ollama serve` 即可使用 qwen2.5 / llama3.2
```

## 用法速览

### 一键综合分析

侧边栏选好通道（不选则默认前 4 个 SEEG 通道），点击工具栏的 **「一键综合报告」**，前端会拉取 6 张图并叠在 SignalPanel：滤波波形、PSD、频段功率热图、HFO Ripple、IED、γ 频段相干性。

### 自然语言对话

右侧 ChatPanel 选好 LLM provider，直接说：

- "给我看 A1-A4 通道做 1–70Hz 带通后的波形"
- "在前 30 秒里跑一下 ripple 检测，哪个通道发放率最高"
- "前 4 个通道的 γ 频段相干性矩阵"
- "对所有 SEEG 通道做 PSD，告诉我哪个通道在 60Hz 附近异常"

模型会调用 agent 工具完成分析，图表通过 WebSocket 实时推到信号面板。

### 电极 3D 可视化

下方 BrainPanel 的两个按钮：

- **「生成合成坐标」**：根据 EDF 通道名按"皮层入针、向中线推进"模型生成 76 个 SEEG 触点的占位 MNI 坐标。先看到 3D 视图，再换真实坐标。
- **「上传 CSV」**：列必须包含 `channel_name, x, y, z`（MNI152 mm），可选 `hemisphere`、`anat_label`。点击触点会联动 SignalPanel 的通道选择。

## 后端 API（节选）

| 路由 | 用途 |
|---|---|
| `POST /api/files/open` | 加载 EDF 并返回元信息（通道、采样率、时长） |
| `POST /api/analysis/waveform` | 波形（可选 notch + 带通） |
| `POST /api/analysis/psd` | Welch PSD |
| `POST /api/analysis/tfr` | Morlet 时频 |
| `POST /api/analysis/band_power` | δ/θ/α/β/γ/high_gamma/ripple 频段功率 |
| `POST /api/analysis/hfo` | HFO 检测（ripple / fast_ripple） |
| `POST /api/analysis/ied` | 间期痫样放电检测 |
| `POST /api/analysis/connectivity` | 频段连接性（coh / plv / wpli / imcoh） |
| `POST /api/analysis/report` | 一键综合分析（6 张图） |
| `POST /api/electrodes/{rid}/synthesize` | 生成合成 MNI 坐标 |
| `POST /api/electrodes/{rid}/upload` | 上传 CSV/TSV 坐标 |
| `WS  /ws/chat` | Pydantic AI 对话（流式 delta + figure 推送） |

完整接口文档（含 Pydantic schema）见 `http://127.0.0.1:8000/docs`。

## 测试

```bash
make test           # pytest backend smoke tests
```

## 里程碑

- [x] **M0** 仓库脚手架、环境、依赖
- [x] **M1** EDF 加载 + 通道元数据 API
- [x] **M2** 分析 MVP（滤波 / PSD / TFR / 波形 / 频段功率）
- [x] **M3** Pydantic AI agent + WebSocket 对话
- [x] **M4** 多 LLM provider 切换
- [x] **M5** 电极坐标（CSV + 合成） + 3D BrainPanel
- [x] **M6** HFO / IED / 连接性 + agent 工具注册
- [x] **M7** 一键综合报告 + README

详细计划见 `~/.claude/plans/seeg-lfp-proud-valiant.md`。

## 已知事项与设计决策

- **EDF 命名识别**：demo 为 Nihon Kohden 风格（`EEG A1-Ref`, `POL A3`, `POL EKG1`）。`io/edf_loader.classify_channel` 自动剥离前缀/后缀并把通道分类为 `seeg / ekg / emg / eog / bp / other`。
- **HFO 检测**：是 Line-Length + RMS 双 z-score 筛选器（Staba 2002 / Gardner 2007 风格），**仅作筛查**——临床判读必须人工确认（伪迹易误报）。
- **3D 脑图选型**：本期用 Plotly 3D scatter + 椭球头壳网格（无外部资源依赖）。Niivue + MNI152 NIfTI 体绘制留待 v2，需要附加几十 MB 模板文件。
- **大文件性能**：所有波形 endpoint 默认按 `max_points=5000` 抽样；TFR/HFO 默认窗口 ≤60s；连接性默认 30s + 2s epoch。
- **会话持久化**：当前为进程内字典缓存（`session_store` + `_RAW_CACHE`），重启即清空。后续可按 `(recording_id, params)` 写 parquet。
- **CT/MRI 电极定位（路径 C）**：在 plan 中已预留，需要 FreeSurfer + `mne.gui.locate_ieeg`，本期未实现。

## 许可

MIT.
