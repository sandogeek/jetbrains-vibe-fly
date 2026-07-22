import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  emitRpcContracts,
  parseRpcContracts,
} from "../scripts/generate-rpc-contracts.mjs"

describe("RPC contract AST generator", () => {
  it("generates runtime definitions from decorated abstract classes", () => {
    const contracts = parseRpcContracts(`
      @rpcService("WireApi")
      export abstract class Api {
        @rpcId(3)
        ping(text: string, options?: BrandedRpcOptions): CancelablePromise<string> {
          throw new Error("contract")
        }
      }
    `)

    assert.deepEqual(contracts, [
      {
        interfaceName: "Api",
        serviceName: "WireApi",
        methods: [{ name: "ping", id: 3 }],
      },
    ])
    const output = emitRpcContracts(contracts)
    assert.match(output, /defineRpcService\("WireApi"/)
    assert.match(output, /RpcMethodArgs<ApiContract\["ping"\]>/)
    assert.match(output, /Awaited<ReturnType<ApiContract\["ping"\]>>/)
    assert.match(output, /export type ApiService = RpcService/)
    assert.match(
      output,
      /function createApiProxy\(peer: SimpleRpcPeer\): ApiContract/,
    )
  })

  it("defaults the wire service name to the class name", () => {
    const contracts = parseRpcContracts(`
      @rpcService()
      export abstract class Api {
        @rpcId(1)
        ping(): void {
          throw new Error("contract")
        }
      }
    `)
    assert.equal(contracts[0]?.serviceName, "Api")
  })

  it("requires explicit stable method ids", () => {
    assert.throws(
      () =>
        parseRpcContracts(`
          @rpcService()
          export abstract class Api {
            ping(): void {
              throw new Error("contract")
            }
          }
        `),
      /missing @rpcId\(<id>\)/,
    )
  })

  it("rejects duplicate method ids", () => {
    assert.throws(
      () =>
        parseRpcContracts(`
          @rpcService()
          export abstract class Api {
            @rpcId(1)
            first(): void {
              throw new Error("contract")
            }
            @rpcId(1)
            second(): void {
              throw new Error("contract")
            }
          }
        `),
      /duplicate @rpcId 1/,
    )
  })

  it("requires abstract contract classes", () => {
    assert.throws(
      () =>
        parseRpcContracts(`
          @rpcService()
          export class Api {
            @rpcId(1)
            ping(): void {
              throw new Error("contract")
            }
          }
        `),
      /must be abstract/,
    )
  })

  it("rejects abstract methods (decorators need implementations)", () => {
    assert.throws(
      () =>
        parseRpcContracts(`
          @rpcService()
          export abstract class Api {
            @rpcId(1)
            abstract ping(): void
          }
        `),
      /cannot be abstract/,
    )
  })
})
