import { readdir, readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { describe, test } from "node:test"
import { fileURLToPath } from "node:url"
import { expect } from "expect"

const localesRoot = join(dirname(fileURLToPath(import.meta.url)), "../../public/locales")

const originalFetch = globalThis.fetch
globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = String(typeof input === "string" || input instanceof URL ? input : input.url)
  const match = /locales\/([^/]+)\/([^/]+)\.json(?:\?.*)?$/.exec(url)
  if (!match) {
    return originalFetch(input, init)
  }
  const [, lng, ns] = match
  try {
    const text = await readFile(join(localesRoot, lng!, `${ns!}.json`), "utf8")
    return new Response(text, { status: 200, headers: { "Content-Type": "application/json" } })
  } catch {
    return new Response("{}", { status: 404, headers: { "Content-Type": "application/json" } })
  }
}

const {
  bootstrapNamespaces,
  detectLocale,
  fallbackLocale,
  i18n,
  i18nReady,
  namespaces,
  supportedLocales,
} = await import("./index")

function dictionaryShape(value: unknown, context: string, prefix = ""): string[] {
  if (typeof value === "string") {
    return [`${prefix}:string`]
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${context}: expected an object or string at ${prefix || "<root>"}`)
  }

  const shape = prefix ? [`${prefix}:object`] : []
  return shape.concat(Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key
    return dictionaryShape(child, context, path)
  }))
}

describe("i18n", () => {
  test("detects configured locales and falls back to English", () => {
    for (const locale of supportedLocales) {
      expect(detectLocale(locale)).toBe(locale)
      expect(detectLocale(`${locale}-TEST`)).toBe(locale)
    }
    expect(detectLocale("unsupported-TEST")).toBe(fallbackLocale)
  })

  test("all locale JSON matches the fallback locale structure", async () => {
    const localeEntries = await readdir(localesRoot, { withFileTypes: true })
    const localeDirectories = localeEntries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()
    expect(localeDirectories).toEqual([...supportedLocales].sort())

    const namespaceFiles = namespaces.map((ns) => `${ns}.json`).sort()
    const fallbackShapes = new Map(
      await Promise.all(namespaces.map(async (ns) => {
        const context = `${fallbackLocale}/${ns}.json`
        const text = await readFile(join(localesRoot, fallbackLocale, `${ns}.json`), "utf8")
        return [ns, dictionaryShape(JSON.parse(text) as unknown, context).sort()] as const
      })),
    )

    for (const locale of supportedLocales) {
      const entries = await readdir(join(localesRoot, locale), { withFileTypes: true })
      const files = entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .map((entry) => entry.name)
        .sort()
      expect(files).toEqual(namespaceFiles)

      for (const ns of namespaces) {
        const context = `${locale}/${ns}.json`
        const text = await readFile(join(localesRoot, locale, `${ns}.json`), "utf8")
        const shape = dictionaryShape(JSON.parse(text) as unknown, context).sort()
        expect(shape).toEqual(fallbackShapes.get(ns))
      }
    }
  })

  test("lazy-loads namespaces and applies locale plural rules", async () => {
    await i18nReady
    const previous = i18n.language
    try {
      await i18n.changeLanguage("en")

      for (const ns of bootstrapNamespaces) {
        expect(i18n.hasResourceBundle("en", ns)).toBe(true)
      }
      const deferred = namespaces.filter((ns) => !bootstrapNamespaces.includes(ns as (typeof bootstrapNamespaces)[number]))
      for (const ns of deferred) {
        expect(i18n.hasResourceBundle("en", ns)).toBe(false)
      }

      await i18n.loadNamespaces("providers")
      expect(i18n.hasResourceBundle("en", "providers")).toBe(true)
      expect(i18n.t("providers:disconnectConfirm", { name: "OpenAI" })).toContain("OpenAI")

      await i18n.loadNamespaces("modelPicker")
      expect(i18n.hasResourceBundle("en", "modelPicker")).toBe(true)
      expect(i18n.t("modelPicker:result", { count: 1 })).toBe("1 model")
      expect(i18n.t("modelPicker:result", { count: 2 })).toBe("2 models")

      await i18n.changeLanguage("zh")
      expect(i18n.t("modelPicker:result", { count: 2 })).toBe("2 个模型")
    } finally {
      await i18n.changeLanguage(previous)
    }
  })
})
