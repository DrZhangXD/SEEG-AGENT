// Thin banner shown only in the static GitHub Pages demo so visitors understand
// the backend and LLM are simulated in the browser.
export function DemoBanner() {
  return (
    <div className="demo-banner">
      <span className="demo-pill">演示模式 DEMO</span>
      <span className="demo-text">
        这是 SEEG-AGENT 的纯前端在线演示：信号分析与 LLM 对话均由浏览器端模拟，数据为合成示例（非真实病例）。
        完整功能（MNE 真实计算、多模型 LLM）请按 README 在本地部署。
      </span>
      <a
        className="demo-link"
        href="https://github.com/DrZhangXD/SEEG-AGENT"
        target="_blank"
        rel="noreferrer"
      >
        GitHub ↗
      </a>
    </div>
  );
}
