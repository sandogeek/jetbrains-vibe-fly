# UI-Agent shared contracts

RPC contracts are authored as abstract classes in `src/contracts.ts`.
Mark each service with `@rpcService()` and each method with a stable `@rpcId(...)`:

```ts
import { rpcId, rpcService } from "./rpc-annotations.js"

@rpcService()
export abstract class Ui2Agent {
  @rpcId(1)
  ping(
    text: string,
    options?: BrandedRpcOptions,
  ): CancelablePromise<string> {
    throw new Error("contract only")
  }
}
```

TypeScript only allows decorators on method implementations (not abstract methods), so
contract methods use a throw-away body. The class stays `abstract` so it cannot be
constructed; callers use `createUi2AgentProxy` / `registerUi2AgentService`.

The authored class type is the public client API and `createUi2AgentProxy` returns it
directly. Use `rpcOptions(...)` to create the branded options value; the generator
removes this final control argument from the wire signature. The generated runtime
unwraps `CancelablePromise<T>` for wire metadata, while the generated service type
accepts synchronous or asynchronous implementations.

Optional wire rename: `@rpcService("WireName")`.

Run `npm run generate` after changing a contract. `npm run typecheck` also verifies
that `src/contracts.generated.ts` is current.
