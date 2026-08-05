import type common from "../../public/locales/en/common.json"
import type chat from "../../public/locales/en/chat.json"
import type settings from "../../public/locales/en/settings.json"
import type sidebar from "../../public/locales/en/sidebar.json"
import type providers from "../../public/locales/en/providers.json"
import type dialogs from "../../public/locales/en/dialogs.json"
import type commit from "../../public/locales/en/commit.json"
import type modelPicker from "../../public/locales/en/modelPicker.json"

export const supportedLocales = ["en", "zh"] as const

export type Locale = (typeof supportedLocales)[number]

export const fallbackLocale: Locale = "en"

export const namespaces = [
    "common",
    "chat",
    "settings",
    "sidebar",
    "providers",
    "dialogs",
    "commit",
    "modelPicker",
] as const

export type Namespace = (typeof namespaces)[number]

export type EnResources = {
    common: typeof common
    chat: typeof chat
    settings: typeof settings
    sidebar: typeof sidebar
    providers: typeof providers
    dialogs: typeof dialogs
    commit: typeof commit
    modelPicker: typeof modelPicker
}
