/* @refresh reload */
import { HashRouter, Navigate, Route } from "@solidjs/router"
import { render } from "solid-js/web"
import { App } from "./App"
import { I18nProvider } from "./i18n"
import { SettingsShell } from "./settings/SettingsShell"
import "./styles.css"

const root = document.getElementById("root")
if (!root) {
  throw new Error("Missing #root")
}

render(
  () => (
    <I18nProvider>
      <HashRouter>
        <Route path="/" component={App} />
        <Route path="/settings" component={SettingsShell}>
          <Route path="/" component={() => <Navigate href="/settings/providers" />} />
          <Route path="/providers" component={() => null} />
          <Route path="/commit-message" component={() => null} />
        </Route>
        <Route path="*404" component={() => <Navigate href="/" />} />
      </HashRouter>
    </I18nProvider>
  ),
  root,
)
