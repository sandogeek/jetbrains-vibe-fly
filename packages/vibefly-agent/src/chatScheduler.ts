/** Small deterministic FIFO used by the project-wide single-turn scheduler. */
export class SerialTurnScheduler<T extends { sessionId: string }> {
  #active: T | undefined
  readonly #queued: T[] = []

  get active(): T | undefined {
    return this.#active
  }

  get queued(): readonly T[] {
    return this.#queued
  }

  enqueue(turn: T): { immediate: boolean; position: number } {
    const immediate = this.#active === undefined && this.#queued.length === 0
    this.#queued.push(turn)
    return { immediate, position: this.#queued.length }
  }

  startNext(): T | undefined {
    if (this.#active) return undefined
    const next = this.#queued.shift()
    this.#active = next
    return next
  }

  finish(turn: T): void {
    if (this.#active !== turn) throw new Error("Cannot finish a turn that is not active")
    this.#active = undefined
  }

  cancelQueuedForSession(sessionId: string): T | undefined {
    const index = this.#queued.findIndex((turn) => turn.sessionId === sessionId)
    if (index < 0) return undefined
    return this.#queued.splice(index, 1)[0]
  }

  clearQueued(): T[] {
    return this.#queued.splice(0)
  }
}
