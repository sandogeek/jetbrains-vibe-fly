import {StrictMode, useEffect} from "react"
import {createRoot} from "react-dom/client"
import {I18nextProvider, useTranslation} from "react-i18next"
import {HashRouter, Navigate, Route, Routes} from "react-router-dom"
import {App} from "./App"
import {fallbackLocale, i18n, i18nReady} from "./i18n"
import {SettingsShell} from "./settings/SettingsShell"
import "./styles.css"

const root = document.getElementById("root")
if (!root) {
    throw new Error("Missing #root")
}

function LocaleDocumentSync() {
    const {i18n: instance} = useTranslation()

    useEffect(() => {
        document.documentElement.lang = instance.resolvedLanguage ?? fallbackLocale
    }, [instance, instance.resolvedLanguage])

    return null
}

void i18nReady.then(() => {
    createRoot(root).render(
        <StrictMode>
            <I18nextProvider i18n={i18n}>
                <LocaleDocumentSync/>
                <HashRouter>
                    <Routes>
                        <Route path="/" element={<App/>}/>
                        <Route path="/settings/*" element={<SettingsShell/>}/>
                        <Route path="*" element={<Navigate to="/" replace/>}/>
                    </Routes>
                </HashRouter>
            </I18nextProvider>
        </StrictMode>,
    )
})
