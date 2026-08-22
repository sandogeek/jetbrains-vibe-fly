import {readFile} from "node:fs/promises"
import {dirname, join} from "node:path"
import {describe, test} from "node:test"
import {fileURLToPath} from "node:url"
import {expect} from "expect"

import {runningShimmerClassName} from "../lib/shimmer"

const stylesDir = dirname(fileURLToPath(import.meta.url))
const sourceRoot = join(stylesDir, "..")

const [shimmerCss, tokensCss, chatPageSource, messagePartsSource] = await Promise.all([
    readFile(join(stylesDir, "shimmer.css"), "utf8"),
    readFile(join(stylesDir, "tokens.css"), "utf8"),
    readFile(join(sourceRoot, "chat/ChatPage.tsx"), "utf8"),
    readFile(join(sourceRoot, "chat/MessageParts.tsx"), "utf8"),
])

describe("shimmer CSS contract", () => {
    test("keeps the public class and utility names", () => {
        expect(shimmerCss).toContain(".shimmer {")
        expect(shimmerCss).toContain(".shimmer-bg {")
        expect(shimmerCss).toContain(".shimmer-container {")
        expect(shimmerCss).toContain(".vf-shimmer-host {")
        expect(shimmerCss).toContain("@utility shimmer-color-*")
        expect(shimmerCss).toContain("@utility shimmer-repeat-delay-*")
        expect(shimmerCss).toContain("@utility shimmer-duration-*")
        expect(shimmerCss).toContain("@utility shimmer-speed-*")
        expect(shimmerCss).toContain("@utility shimmer-spread-*")
        expect(shimmerCss).toContain("@utility shimmer-angle-*")
        expect(shimmerCss).toContain("@utility shimmer-invert")
    })

    test("clamps speed, duration, repeat-delay, spread, and angle", () => {
        expect(shimmerCss).toMatch(/--_shimmer-speed:\s*max\(0\.001,/)
        expect(shimmerCss).toMatch(/--_shimmer-duration:\s*max\(1,/)
        expect(shimmerCss).toMatch(/--_shimmer-repeat-delay:\s*max\(0,/)
        expect(shimmerCss).toMatch(/--_shimmer-spread:\s*max\(1px,/)
        expect(shimmerCss).toMatch(
            /--_shimmer-angle:\s*clamp\(-45deg,\s*var\(--shimmer-angle,\s*15deg\),\s*45deg\)/,
        )
    })

    test("keeps number/number background-size and does not use tan or abs", () => {
        expect(shimmerCss).toContain(
            "background-size: calc(200% + 100% * var(--_shimmer-repeat-delay) / var(--_shimmer-duration)) 100%",
        )
        const cssWithoutComments = shimmerCss.replace(/\/\*[\s\S]*?\*\//g, "")
        expect(cssWithoutComments).not.toMatch(/\btan\s*\(/)
        expect(cssWithoutComments).not.toMatch(/\babs\s*\(/)
    })

    test("falls back statically for reduced-motion, forced-colors, and print", () => {
        expect(shimmerCss).toContain("prefers-reduced-motion: reduce")
        expect(shimmerCss).toContain("forced-colors: active")
        expect(shimmerCss).toMatch(/@media[^{]*print/)
        expect(shimmerCss).toContain("animation: none !important")
        expect(shimmerCss).toContain("-webkit-text-fill-color: unset !important")
        expect(shimmerCss).toMatch(/\.vf-shimmer-host\s*>\s*\.shimmer\s*\{\s*display:\s*none/)
    })

    test("does not keep dead track-height or diagonal offset variables", () => {
        expect(shimmerCss).not.toContain("--shimmer-track-height")
        expect(shimmerCss).not.toContain("--shimmer-x")
        expect(shimmerCss).not.toContain("--shimmer-y")
        expect(shimmerCss).not.toContain("--_shimmer-xy-offset")
    })

    test("scopes color opacity to --shimmer-alpha instead of a generic --alpha", () => {
        expect(shimmerCss).toContain("--shimmer-alpha")
        expect(shimmerCss).toContain("var(--shimmer-alpha, 100%)")
        expect(shimmerCss).not.toMatch(/(?<![\w-])--alpha\s*:/)
        expect(shimmerCss).not.toMatch(/var\(--alpha\b/)
    })

    test("reads highlight colors from theme tokens with --shimmer-color override", () => {
        expect(tokensCss).toContain("--vf-shimmer-text:")
        expect(tokensCss).toContain("--vf-shimmer-skeleton:")
        expect(tokensCss).toContain("--vf-shimmer-title:")
        expect(shimmerCss).toContain("var(--shimmer-color, var(--vf-shimmer-text))")
        expect(shimmerCss).toContain("var(--shimmer-color, var(--vf-shimmer-skeleton))")
        expect(shimmerCss).toContain("var(--shimmer-color, var(--vf-shimmer-title))")
    })

    test("keeps truncated-title overlay non-interactive and ellipsized", () => {
        const overlayBlock = shimmerCss.slice(shimmerCss.indexOf(".vf-shimmer-host > .shimmer {"))
        expect(overlayBlock).toContain("pointer-events: none")
        expect(overlayBlock).toContain("text-overflow: ellipsis")
        expect(overlayBlock).toContain("overflow: hidden")
        expect(overlayBlock).toContain("user-select: none")
    })
})

describe("runningShimmerClassName", () => {
    test("is the shared running text shimmer used by ChatPage and MessageParts", () => {
        expect(runningShimmerClassName).toBe(
            "shimmer text-muted/55 shimmer-color-accent shimmer-repeat-delay-800",
        )
        expect(chatPageSource).toContain("runningShimmerClassName")
        expect(messagePartsSource).toContain("runningShimmerClassName")
        expect(chatPageSource).not.toContain(
            "shimmer text-muted/55 shimmer-color-accent shimmer-repeat-delay-800",
        )
        expect(messagePartsSource).not.toContain(
            "shimmer text-muted/55 shimmer-color-accent shimmer-repeat-delay-800",
        )
    })

    test("TruncatedText keeps vf-shimmer-host and an aria-hidden overlay", () => {
        expect(chatPageSource).toContain("vf-shimmer-host")
        expect(chatPageSource).toContain('aria-hidden="true"')
        expect(chatPageSource).toContain(
            'className="shimmer shimmer-color-accent shimmer-repeat-delay-800"',
        )
    })
})
