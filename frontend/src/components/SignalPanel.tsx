import Plot from "./Plot";

import type { PlotlyFigure } from "../api/client";
import { useAppStore } from "../store/appStore";
import { AnalysisToolbar } from "./AnalysisToolbar";

function PlotFig({ fig }: { fig: PlotlyFigure }) {
  return (
    <Plot
      data={fig.data as Plotly.Data[]}
      layout={{
        autosize: true,
        paper_bgcolor: "transparent",
        plot_bgcolor: "#0f1115",
        font: { color: "#e6e8ee", size: 11 },
        ...fig.layout,
      }}
      useResizeHandler
      style={{ width: "100%", height: "100%" }}
      config={{ displaylogo: false, responsive: true }}
    />
  );
}

export function SignalPanel() {
  const results = useAppStore((s) => s.results);
  const clearResults = useAppStore((s) => s.clearResults);

  return (
    <div className="signal-panel">
      <div className="signal-header">
        <h3>信号分析</h3>
        <div className="signal-actions">
          {results.length > 0 && <button onClick={clearResults}>清空</button>}
        </div>
      </div>
      <AnalysisToolbar />
      {results.length === 0 && (
        <div className="muted placeholder">
          点击上方按钮运行分析，或让 agent 帮你调度。<br />
          结果（Plotly 交互图）会堆叠显示在这里。
        </div>
      )}
      <div className="results">
        {results.map((r) => (
          <div key={r.id} className="result-card">
            <div className="result-title">{r.title}</div>
            {r.figures.map((fig, i) => (
              <div key={i} className="fig-wrap">
                <PlotFig fig={fig} />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
