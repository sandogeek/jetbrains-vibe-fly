import type { dict as enDict } from "./en"

export type Locale = "en" | "zh"

/** Deep-map dictionary values to `string` so locale files can diverge from English literals. */
type StringifyDict<T> = {
  [K in keyof T]: T[K] extends string
    ? string
    : T[K] extends Record<string, unknown>
      ? StringifyDict<T[K]>
      : T[K]
}

export type RawDictionary = StringifyDict<typeof enDict>
