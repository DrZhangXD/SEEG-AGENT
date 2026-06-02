# SEEG-AGENT

**English** · [简体中文](./README.zh-CN.md)

An interactive agent workbench for SEEG (stereo-electroencephalography) LFP signal analysis.

**Highlights**
- Interactive web UI (Vite + React + TypeScript + Zustand)
- Hot-swappable LLM backends: Anthropic Claude, OpenAI, DeepSeek, Tongyi Qianwen (Qwen), Kimi, and local Ollama
- Full LFP analysis suite: filtering, PSD (Welch), time–frequency maps (Morlet), band power, HFO (Ripple / Fast Ripple), IED (interictal epileptiform discharges), and band-limited connectivity (coh / plv / wpli / imcoh)
- 3D electrode-contact visualization (Plotly scatter3d + head-shell mesh), with CSV/TSV upload or synthetic placeholder coordinates
- One-click comprehensive report: filtered waveform + PSD + band power + HFO + IED + γ connectivity produced in a single pass
- Built on [MNE-Python](https://mne.tools/) + [mne-connectivity](https://mne.tools/mne-connectivity/) + [Pydantic AI](https://ai.pydantic.dev/)

---

## Project layout

```
SEEG-AGENT/
├── backend/         # FastAPI + MNE + Pydantic AI
│   ├── app/
│   │   ├── api/             # files / analysis / electrodes / chat (WS)
│   │   ├── analysis/        # pure-function MNE wrappers
│   │   ├── agent/           # Pydantic AI agent + multi-provider
│   │   ├── io/              # EDF loader / electrode CSV / session store
│   │   └── viz/             # Plotly JSON serializers
│   └── tests/
├── frontend/        # Vite + React + Plotly + Zustand
│   └── src/
│       ├── components/      # ChatPanel / SignalPanel / BrainPanel / ChannelList ...
│       ├── api/             # typed fetch/WS client
│       └── store/           # Zustand state
├── demo/            # sample EDF files
├── .env.example     # LLM key template
└── Makefile
```

## Requirements

- Python ≥ 3.11 (virtual environment managed with [`uv`](https://docs.astral.sh/uv/))
- Node ≥ 20 (22/24 recommended)
- macOS / Linux; Windows untested

## Quick start

```bash
# 1. Copy the environment-variable template
cp .env.example backend/.env   # fill in ANTHROPIC_API_KEY, etc.

# 2. Install dependencies
make install

# 3. Start the backend (terminal A)
make backend        # http://127.0.0.1:8000/docs

# 4. Start the frontend (terminal B)
make frontend       # http://127.0.0.1:5173
```

On first launch, click any `.edf` entry in the left-hand **Demo files** list to load it.

## Enabling LLM providers

Any provider whose `*_API_KEY` is set in `backend/.env` automatically appears in the frontend model dropdown:

```bash
ANTHROPIC_API_KEY=sk-ant-...        # Claude (claude-sonnet-4.5 / opus / haiku)
OPENAI_API_KEY=sk-...               # GPT-4o / GPT-4.1
DEEPSEEK_API_KEY=sk-...             # DeepSeek-V3 / DeepSeek-R1
DASHSCOPE_API_KEY=sk-...            # Tongyi Qwen-Max / Qwen-Plus
MOONSHOT_API_KEY=sk-...             # Kimi K2
# Ollama runs locally with no key — start `ollama serve` to use qwen2.5 / llama3.2
```

## Usage at a glance

### One-click comprehensive analysis

Pick channels in the sidebar (defaults to the first 4 SEEG channels if none are selected), then click **"One-click report"** in the toolbar. The frontend fetches 6 figures and stacks them in the SignalPanel: filtered waveform, PSD, band-power heatmap, HFO ripple, IED, and γ-band coherence.

### Natural-language chat

In the ChatPanel on the right, choose an LLM provider and just ask:

- "Show me channels A1–A4 after a 1–70 Hz bandpass."
- "Run ripple detection over the first 30 seconds — which channel has the highest rate?"
- "γ-band coherence matrix for the first 4 channels."
- "Run PSD on all SEEG channels and tell me which one looks abnormal around 60 Hz."

The model calls agent tools to perform the analysis, and figures are pushed to the signal panel in real time over WebSocket.

### 3D electrode visualization

The BrainPanel at the bottom has two buttons:

- **"Generate synthetic coordinates"** — derives 76 placeholder MNI coordinates for SEEG contacts from the EDF channel names, using a "cortical entry, advance toward the midline" model. Use it to see the 3D view first, then swap in real coordinates.
- **"Upload CSV"** — columns must include `channel_name, x, y, z` (MNI152 mm), with optional `hemisphere` and `anat_label`. Clicking a contact syncs the channel selection in the SignalPanel.

## Backend API (selected)

| Route | Purpose |
|---|---|
| `POST /api/files/open` | Load an EDF and return metadata (channels, sampling rate, duration) |
| `POST /api/analysis/waveform` | Waveform (optional notch + bandpass) |
| `POST /api/analysis/psd` | Welch PSD |
| `POST /api/analysis/tfr` | Morlet time–frequency |
| `POST /api/analysis/band_power` | δ/θ/α/β/γ/high_gamma/ripple band power |
| `POST /api/analysis/hfo` | HFO detection (ripple / fast_ripple) |
| `POST /api/analysis/ied` | Interictal epileptiform discharge detection |
| `POST /api/analysis/connectivity` | Band-limited connectivity (coh / plv / wpli / imcoh) |
| `POST /api/analysis/report` | One-click comprehensive analysis (6 figures) |
| `POST /api/electrodes/{rid}/synthesize` | Generate synthetic MNI coordinates |
| `POST /api/electrodes/{rid}/upload` | Upload CSV/TSV coordinates |
| `WS  /ws/chat` | Pydantic AI chat (streaming deltas + figure pushes) |

Full API docs (with Pydantic schemas) are available at `http://127.0.0.1:8000/docs`.

## Tests

```bash
make test           # pytest backend smoke tests
```

## Milestones

- [x] **M0** Repo scaffolding, environment, dependencies
- [x] **M1** EDF loading + channel-metadata API
- [x] **M2** Analysis MVP (filtering / PSD / TFR / waveform / band power)
- [x] **M3** Pydantic AI agent + WebSocket chat
- [x] **M4** Multi-LLM-provider switching
- [x] **M5** Electrode coordinates (CSV + synthetic) + 3D BrainPanel
- [x] **M6** HFO / IED / connectivity + agent tool registration
- [x] **M7** One-click comprehensive report + README

## Notes & design decisions

- **EDF naming recognition**: the demo files follow the Nihon Kohden style (`EEG A1-Ref`, `POL A3`, `POL EKG1`). `io/edf_loader.classify_channel` strips prefixes/suffixes automatically and classifies channels as `seeg / ekg / emg / eog / bp / other`.
- **HFO detection**: a Line-Length + RMS dual z-score screener (Staba 2002 / Gardner 2007 style). **Screening only** — clinical interpretation must be confirmed manually (artifacts cause false positives easily).
- **3D brain rendering**: this release uses a Plotly 3D scatter + ellipsoidal head-shell mesh (no external asset dependency). Niivue + MNI152 NIfTI volume rendering is deferred to v2, which would require tens of MB of template files.
- **Large-file performance**: every waveform endpoint subsamples to `max_points=5000` by default; TFR/HFO default to windows ≤ 60 s; connectivity defaults to 30 s with 2 s epochs.
- **Session persistence**: currently an in-process dict cache (`session_store` + `_RAW_CACHE`), cleared on restart. A future version can persist parquet keyed by `(recording_id, params)`.
- **CT/MRI electrode localization (path C)**: reserved in the plan; requires FreeSurfer + `mne.gui.locate_ieeg`, not implemented in this release.

## License

MIT.
