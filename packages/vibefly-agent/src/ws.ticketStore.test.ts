import {describe, test} from "node:test"
import {expect} from "expect"
import {createTicketStore} from "./ws.js"

describe("createTicketStore", () => {
    test("take removes ticket and rejects expired", () => {
        let t = 1_000
        const store = createTicketStore({
            now: () => t,
            cleanupIntervalMs: 60_000,
        })
        const {ticket} = store.create("http://localhost", 100)
        expect(store.take(ticket)?.expectedOrigin).toBe("http://localhost")
        expect(store.take(ticket)).toBeNull()

        const {ticket: expired} = store.create("http://localhost", 100)
        t += 200
        expect(store.take(expired)).toBeNull()
        store.clear()
    })

    test("create enforces capacity by dropping oldest", () => {
        let t = 1_000
        const store = createTicketStore({
            maxTickets: 2,
            now: () => t,
            cleanupIntervalMs: 60_000,
        })
        const a = store.create("http://a", 10_000)
        const b = store.create("http://b", 10_000)
        const c = store.create("http://c", 10_000)

        expect(store.take(a.ticket)).toBeNull()
        expect(store.take(b.ticket)?.expectedOrigin).toBe("http://b")
        expect(store.take(c.ticket)?.expectedOrigin).toBe("http://c")
        store.clear()
    })

    test("create purges expired before capacity drop", () => {
        let t = 1_000
        const store = createTicketStore({
            maxTickets: 2,
            now: () => t,
            cleanupIntervalMs: 60_000,
        })
        const a = store.create("http://a", 50)
        store.create("http://b", 10_000)
        t += 100
        const c = store.create("http://c", 10_000)

        expect(store.take(a.ticket)).toBeNull()
        expect(store.take(c.ticket)?.expectedOrigin).toBe("http://c")
        store.clear()
    })
})
