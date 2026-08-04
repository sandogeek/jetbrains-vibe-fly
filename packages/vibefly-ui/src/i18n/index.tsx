import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react"
import { dict as enDict } from "./en"
import type { Locale, RawDictionary } from "./types"
import { dict as zhDict } from "./zh"

export type { Locale, RawDictionary }
export type Dictionary = Record<string, string>
export type Translator = (
  key: string,
  params?: Record<string, string | number>,
) => string

const dictionaries: Record<Locale, RawDictionary> = {
  en: enDict,
  zh: zhDict,
}

function flattenDictionary(
  source: object,
  prefix = "",
  target: Dictionary = {},
): Dictionary {
  for (const [key, value] of Object.entries(source)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (typeof value === "string") target[path] = value
    else if (value && typeof value === "object") flattenDictionary(value, path, target)
  }
  return target
}

const flatDictionaries: Record<Locale, Dictionary> = {
  en: flattenDictionary(enDict),
  zh: flattenDictionary(zhDict),
}

export function detectLocale(language = navigator.language): Locale {
  return language.toLowerCase().startsWith("zh") ? "zh" : "en"
}

type I18nContextValue = {
  locale: Locale
  setLocale: (locale: Locale) => void
  t: Translator
  dict: Dictionary
}

const I18nContext = createContext<I18nContextValue | null>(null)

export function I18nProvider({
  children,
  initialLocale,
}: {
  children: ReactNode
  initialLocale?: Locale
}) {
  const [locale, setLocale] = useState<Locale>(initialLocale ?? detectLocale())
  const dict = flatDictionaries[locale]
  const t = useCallback<Translator>(
    (key, params) => {
      let value = dict[key] ?? flatDictionaries.en[key] ?? key
      for (const [name, replacement] of Object.entries(params ?? {})) {
        value = value.replaceAll(`{{${name}}}`, String(replacement))
      }
      return value
    },
    [dict],
  )
  const value = useMemo(() => ({ locale, setLocale, t, dict }), [dict, locale, t])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext)
  if (!context) throw new Error("useI18n must be used within I18nProvider")
  return context
}

export function useT(): Translator {
  return useI18n().t
}
