import { describe, test } from "node:test"
import { expect } from "expect"
import { SerialTurnScheduler } from "./chatScheduler.js"

type Turn = { sessionId: string; id: string }

describe("SerialTurnScheduler", () => {
  test("runs turns in global FIFO order", () => {
    const scheduler = new SerialTurnScheduler<Turn>()
    expect(scheduler.enqueue({ sessionId: "a", id: "1" })).toEqual({ immediate: true, position: 1 })
    const first = scheduler.startNext()!
    expect(first.id).toBe("1")
    expect(scheduler.enqueue({ sessionId: "b", id: "2" })).toEqual({ immediate: false, position: 1 })
    expect(scheduler.enqueue({ sessionId: "c", id: "3" })).toEqual({ immediate: false, position: 2 })
    scheduler.finish(first)
    const second = scheduler.startNext()!
    expect(second.id).toBe("2")
    scheduler.finish(second)
    expect(scheduler.startNext()!.id).toBe("3")
  })

  test("cancels one session without reordering the rest", () => {
    const scheduler = new SerialTurnScheduler<Turn>()
    scheduler.enqueue({ sessionId: "a", id: "1" })
    scheduler.enqueue({ sessionId: "b", id: "2" })
    scheduler.enqueue({ sessionId: "c", id: "3" })
    expect(scheduler.cancelQueuedForSession("b")?.id).toBe("2")
    expect(scheduler.queued.map((turn) => turn.id)).toEqual(["1", "3"])
  })

  test("clears queued work while preserving the active turn", () => {
    const scheduler = new SerialTurnScheduler<Turn>()
    scheduler.enqueue({ sessionId: "a", id: "1" })
    const active = scheduler.startNext()!
    scheduler.enqueue({ sessionId: "b", id: "2" })
    expect(scheduler.clearQueued().map((turn) => turn.id)).toEqual(["2"])
    expect(scheduler.active).toBe(active)
  })
})
