import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { DEMO_MODE } from './demo/config'
import { installDemoWebSocket } from './demo/demoApi'

// In the static GitHub Pages build there is no backend, so route the chat
// WebSocket through the in-browser simulator before anything mounts.
if (DEMO_MODE) {
  installDemoWebSocket()
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
