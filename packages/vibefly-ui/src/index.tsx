import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { HashRouter, Navigate, Route, Routes } from "react-router-dom"
import { App } from "./App"
import { I18nProvider } from "./i18n"
import { SettingsShell } from "./settings/SettingsShell"
import "./styles.css"

const root = document.getElementById("root")
if (!root) {
  throw new Error("Missing #root")
}

createRoot(root).render(
  <StrictMode>
    <I18nProvider>
      <HashRouter>
        <Routes>
          <Route path="/" element={<App />} />
          <Route path="/settings/*" element={<SettingsShell />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </HashRouter>
    </I18nProvider>
  </StrictMode>,
)
