import * as i18n from "@solid-primitives/i18n"
import {
  createContext,
  createMemo,
  createSignal,
  useContext,
  type Accessor,
  type JSX,
  type Setter,
} from "solid-js"
import { dict as enDict } from "./en"
import type { Locale, RawDictionary } from "./types"
import { dict as zhDict } from "./zh"

export type { Locale, RawDictionary }
export type Dictionary = i18n.Flatten<RawDictionary>
export type Translator = i18n.Translator<Dictionary>

const dictionaries: Record<Locale, RawDictionary> = {
  en: enDict,
  zh: zhDict,
}

const flatDictionaries: Record<Locale, Dictionary> = {
  en: i18n.flatten(enDict),
  zh: i18n.flatten(zhDict),
}

export function detectLocale(language = navigator.language): Locale {
  return language.toLowerCase().startsWith("zh") ? "zh" : "en"
}

type I18nContextValue = {
  locale: Accessor<Locale>
  setLocale: Setter<Locale>
  t: Translator
  dict: Accessor<Dictionary>
}

const I18nContext = createContext<I18nContextValue>()

export function I18nProvider(props: {
  children: JSX.Element
  initialLocale?: Locale
}) {
  const [locale, setLocale] = createSignal<Locale>(props.initialLocale ?? detectLocale())
  const dict = createMemo(() => flatDictionaries[locale()])
  const t = i18n.translator(dict, i18n.resolveTemplate)

  return (
    <I18nContext.Provider value={{ locale, setLocale, t, dict }}>
      {props.children}
    </I18nContext.Provider>
  )
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error("useI18n must be used within I18nProvider")
  return ctx
}

export function useT(): Translator {
  return useI18n().t
}
