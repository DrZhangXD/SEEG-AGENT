// Static "demo mode" flag.
//
// When the frontend is built with `VITE_DEMO_MODE=1` (see the GitHub Pages
// workflow), the whole app runs without a backend: every `api.*` call and the
// chat WebSocket are served by an in-browser simulator that synthesizes
// realistic SEEG figures. This lets us publish a fully interactive live demo
// on GitHub Pages, where no Python backend / LLM can run.
export const DEMO_MODE = (import.meta.env.VITE_DEMO_MODE as string | undefined) === "1";
