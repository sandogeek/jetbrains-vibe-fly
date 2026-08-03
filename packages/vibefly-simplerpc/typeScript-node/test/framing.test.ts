import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { ContentLengthDecoder, encodeFrame } from "../src/framing.js"

describe("ContentLength framing", () => {
  it("round-trips a single message", () => {
    const msg = JSON.stringify({ t: "ok", id: "1", r: "hi" })
    const frame = encodeFrame(msg)
    const decoder = new ContentLengthDecoder()
    assert.deepEqual(decoder.push(frame), [msg])
  })

  it("handles split chunks", () => {
    const msg = JSON.stringify({ t: "req", id: "a", s: "S", i: 1, a: [] })
    const frame = encodeFrame(msg)
    const decoder = new ContentLengthDecoder()
    const mid = Math.floor(frame.byteLength / 2)
    assert.deepEqual(decoder.push(frame.subarray(0, mid)), [])
    assert.deepEqual(decoder.push(frame.subarray(mid)), [msg])
  })

  it("decodes multiple frames in one chunk", () => {
    const a = encodeFrame('{"t":"ok","id":"1","r":1}')
    const b = encodeFrame('{"t":"ok","id":"2","r":2}')
    const decoder = new ContentLengthDecoder()
    assert.deepEqual(decoder.push(Buffer.concat([a, b])), [
      '{"t":"ok","id":"1","r":1}',
      '{"t":"ok","id":"2","r":2}',
    ])
  })

  it("uses utf8 byte length for multibyte body", () => {
    const msg = JSON.stringify({ t: "ok", id: "1", r: "你好" })
    const bodyLen = Buffer.byteLength(msg, "utf8")
    const frame = encodeFrame(msg)
    assert.ok(frame.toString("ascii").startsWith(`Content-Length: ${bodyLen}\r\n\r\n`))
    const decoder = new ContentLengthDecoder()
    assert.deepEqual(decoder.push(frame), [msg])
  })

  it("end() throws on partial frame", () => {
    const decoder = new ContentLengthDecoder()
    decoder.push(Buffer.from("Content-Length: 5\r\n\r\nab", "utf8"))
    assert.throws(() => decoder.end(), /Unexpected EOF/)
  })

  it("rejects missing Content-Length", () => {
    const decoder = new ContentLengthDecoder()
    assert.throws(
      () => decoder.push(Buffer.from("X-Foo: 1\r\n\r\n{}", "utf8")),
      /Missing Content-Length/,
    )
  })

  it("rejects non-integer Content-Length values", () => {
    for (const value of ["1junk", "1.5", "-1", "+1", "1e2", ""]) {
      const decoder = new ContentLengthDecoder()
      assert.throws(
        () =>
          decoder.push(
            Buffer.from(`Content-Length: ${value}\r\n\r\nX`, "utf8"),
          ),
        /Invalid Content-Length/,
      )
    }
  })
})
