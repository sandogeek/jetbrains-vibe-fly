# UI-Agent 共享契约

RPC 契约以抽象类的形式编写在 `src/contracts.ts` 中。
用 `@rpcService()` 标记每个服务，并用稳定的 `@rpcId(...)` 标记每个方法：

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

TypeScript 只允许装饰器挂在方法实现上（不能挂在 abstract 方法上），因此契约方法需要占位方法体。
类保持 `abstract` 以免被直接构造；调用方应使用 `createUi2AgentProxy` / `registerUi2AgentService`。

手写的类类型即为公开客户端 API，`createUi2AgentProxy` 会直接返回该类型。
使用 `rpcOptions(...)` 创建 branded options；生成器会从 wire 参数中移除最后的控制参数。
契约方法返回 `CancelablePromise<T>`，因此调用方可以使用超时、AbortSignal 和 `.cancel()`。
生成的运行时会解包 Promise 以得到线上元数据，而生成的服务类型则同时接受同步或异步实现。

可选的线上服务名重命名：`@rpcService("WireName")`。

修改契约后请运行 `bun run generate`。`bun run typecheck` 也会校验
`src/contracts.generated.ts` 是否为最新。
