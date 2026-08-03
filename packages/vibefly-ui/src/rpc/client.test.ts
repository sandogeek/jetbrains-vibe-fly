import { describe, test } from "node:test"
import { expect } from "expect"
import { resolveCefQueryFns } from "./client"

type ResolverWindow = Parameters<typeof resolveCefQueryFns>[0]

function cefWindow(values: Record<string, unknown>, search = ""): ResolverWindow {
  return {
    location: { search },
    ...values,
  } as unknown as ResolverWindow
}

describe("resolveCefQueryFns", () => {
  test("binds the exact panel channel instead of a stable or enumerated function", () => {
    const calls: string[] = []
    const win = cefWindow(
      {
        cefQuery: () => {
          calls.push("stable")
          return 1
        },
        cefQueryCancel: () => calls.push("stable-cancel"),
        vibeflyCefQuery_1: () => {
          calls.push("channel-1")
          return 2
        },
        vibeflyCefQueryCancel_1: () => calls.push("channel-1-cancel"),
        vibeflyCefQuery_2: () => {
          calls.push("channel-2")
          return 3
        },
        vibeflyCefQueryCancel_2: () => calls.push("channel-2-cancel"),
      },
      "?vibeflyRpcChannel=2",
    )

    const resolved = resolveCefQueryFns(win)
    expect(resolved).not.toBeNull()
    resolved!.query({
      request: "{}",
      persistent: false,
      onSuccess: () => {},
      onFailure: () => {},
    })
    resolved!.cancel(3)
    expect(calls).toEqual(["channel-2", "channel-2-cancel"])
  })

  test("does not fall through to another router when the declared channel is absent", () => {
    const win = cefWindow(
      {
        cefQuery: () => 1,
        cefQueryCancel: () => {},
        vibeflyCefQuery_1: () => 2,
        vibeflyCefQueryCancel_1: () => {},
      },
      "?vibeflyRpcChannel=2",
    )

    expect(resolveCefQueryFns(win)).toBeNull()
  })

  test("supports the stable bridge when no channel parameter is present", () => {
    const win = cefWindow({
      cefQuery: () => 1,
      cefQueryCancel: () => {},
    })

    expect(resolveCefQueryFns(win)).not.toBeNull()
  })
})
