import i18next, {type TFunction} from "i18next"
import LanguageDetector from "i18next-browser-languagedetector"
import HttpBackend from "i18next-http-backend"
import {initReactI18next, useTranslation} from "react-i18next"
import type {EnResources, Locale, Namespace} from "./types"
import {fallbackLocale, namespaces, supportedLocales} from "./types"

export type {Locale, Namespace}
export {fallbackLocale, namespaces, supportedLocales}

/** Accepts `ns:key` across all resource namespaces (for helpers that receive `t`). */
export type Translator = TFunction<readonly Namespace[], undefined>

/** Namespaces loaded at bootstrap; all others load on demand via useAppTranslation. */
export const bootstrapNamespaces = ["common"] as const satisfies readonly Namespace[]

export function detectLocale(language?: string): Locale {
    const detected = (language ?? (typeof navigator === "undefined" ? fallbackLocale : navigator.language)).toLowerCase()
    const baseLanguage = detected.split(/[-_]/, 1)[0]
    return supportedLocales.find((locale) => locale === baseLanguage) ?? fallbackLocale
}

/** Settings-persisted UI language mode: follow_ide | en | zh. */
export type UiLocaleMode = "follow_ide" | Locale

export function normalizeUiLocaleMode(mode?: string | null): UiLocaleMode {
    const raw = (mode ?? "follow_ide").trim().toLowerCase()
    if (raw === "en" || raw === "english") return "en"
    if (raw === "zh" || raw === "zh-cn" || raw === "zh_cn" || raw === "chinese" || raw === "cn") return "zh"
    return "follow_ide"
}

const baseUrl = (import.meta as ImportMeta & { env?: { BASE_URL?: string } }).env?.BASE_URL || "./"
const loadPath = `${baseUrl}locales/{{lng}}/{{ns}}.json`.replace(/([^:]\/)\/+/g, "$1")

export const i18n = i18next.createInstance()

export const i18nReady = i18n
    .use(HttpBackend)
    .use(LanguageDetector)
    .use(initReactI18next)
    .init({
        fallbackLng: fallbackLocale,
        supportedLngs: [...supportedLocales],
        nonExplicitSupportedLngs: true,
        ns: [...bootstrapNamespaces],
        defaultNS: "common",
        load: "languageOnly",
        partialBundledLanguages: true,
        backend: {
            loadPath,
        },
        detection: {
            order: ["localStorage", "navigator", "htmlTag"],
            caches: ["localStorage"],
            convertDetectedLanguage: (lng) => detectLocale(lng),
        },
        interpolation: {
            escapeValue: false,
        },
        returnNull: false,
        react: {
            useSuspense: false,
        },
    })

let desiredUiLanguage: string | null = null
let localeApplyChain: Promise<void> = Promise.resolve()

/**
 * Apply the persisted UI language. Calls are serialized onto the latest desired
 * language so a slow first `changeLanguage` cannot overwrite a later click.
 * 应用已持久化的界面语言。按“最后一次请求”串行执行，避免第一次慢速
 * `changeLanguage` 完成后覆盖后续点击。
 */
export function applyUiLocale(mode?: string | null): void {
    const normalized = normalizeUiLocaleMode(mode)
    const lng = normalized === "follow_ide" ? detectLocale() : normalized
    desiredUiLanguage = lng
    localeApplyChain = localeApplyChain
        .then(async () => {
            const targetLanguage = desiredUiLanguage
            if (targetLanguage == null) return
            if (i18n.resolvedLanguage === targetLanguage || i18n.language === targetLanguage) return
            await i18n.changeLanguage(targetLanguage)
        })
        .catch(() => undefined)
}

/**
 * Subscribe to (and lazy-load) only the namespaces this component needs.
 * `common` is always available after bootstrap; pass extra namespaces as needed.
 */
export function useAppTranslation(ns?: Namespace | readonly Namespace[]) {
    return useTranslation(ns ?? "common")
}

declare module "i18next" {
    interface CustomTypeOptions {
        defaultNS: "common"
        resources: EnResources
        returnNull: false
    }
}
