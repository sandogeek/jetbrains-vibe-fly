# Host 集中式设置架构

本文描述当前设置系统及设置消费层的实现边界。Host 集中落盘、四文件布局、文件级 revision 和凭据隔离已经落地；设置数据面走 **UI → Agent → Host**。

English: [setting.en.md](./setting.en.md)

## 目标与约束

1. Host 是 application / project 配置文件的唯一落盘方，并持有两个作用域的内存快照。
2. UI 和 Agent 都不直接访问设置文件。WebView 只按 `SettingKey` 经 Agent 读写 effective 值；Agent 持有完整快照并经 Host RPC 落盘。
3. pi 原生字段保存在 `settings.json`，Vibe Fly 专有字段保存在 `settings.vibefly.json`，模型定义和凭据分别保存在
   `models.json`、`auth.json`；不修改上游 pi 类型或源码。
4. 只有 `settings.json` 和 `settings.vibefly.json` 支持 project 覆盖：对象递归合并，数组、标量和 `null` 由 project 层整体替换。
   `models.json` 和 `auth.json` 只有 application 层。
5. Host 只向 Agent 推送小型文件级失效通知；Agent 再通知 UI 重新读取受影响的 `SettingKey`。通知不携带完整配置。
6. 保存使用文件级 opaque revision 做乐观并发控制，并配合文件锁、同目录临时文件和原子替换。一次保存只写一个文件。
7. 设置热更新不得通过重启全部 Agent 实现。
8. 会话和 workspace 状态不纳入配置快照。

UI -> Agent 的业务契约只存在于 `packages/vibefly-uiagent-shared`，不新增 Kotlin 镜像。主题、票据、Provider 登录等 IDE 能力仍走 UI ↔ Host。

## 当前实现边界

- 设置页和聊天页通过 `SettingKeyStore` 订阅 Agent 的 effective 值；Agent 通过 `SettingsSyncClient` 消费 Host 的完整快照。
- 设置页不再出现在 IDE Settings 对话框中。聊天页齿轮打开当前 Project 唯一的编辑器 Tab：每个 Project 缓存同一个 `LightVirtualFile`，重复打开只聚焦已有 Tab。关闭 Tab 时释放 RPC、Host 和浏览器。
- UI 写入省略 `targetScope`，由 Agent 按 effective source 选择 scope：已有 project override 时维持写入 project，否则写入 application。设置页不展示来源，也不提供创建 / 删除 project override。
- 设置 Tab 的 Host / Agent 操作显式绑定该 Tab 所属 Project，不再回退到“任取一个已打开 Project”。Provider 登录生命周期使用该 Project agent 的 `withControl` 和反向 RPC。Provider 配置和 revision 收敛已进入统一 UI client。
  Provider 文档解析、校验、patch 与脱敏 snapshot 由该 Project Agent 计算；Host 按文件分别落盘 `models.json` / `auth.json`。Provider 页面因此依赖当前 Project Agent。
- 不读取或迁移旧 IDE XML settings；session / workspace 状态也不属于本设置系统。

## 文件与作用域

`<product>` 使用 `VibeflyAgentDirectory` 已有的、规范化后的 IDE product code。固定布局如下：

```text
~/.vibefly/<product>/agent/
  settings.json
  settings.vibefly.json
  models.json
  auth.json
  sessions/            # 不属于配置快照

<project>/.vibefly/
  settings.json
  settings.vibefly.json
```

| scope         | `settings.json`                            | `settings.vibefly.json`                            | `models.json`                            | `auth.json`                            |
|---------------|--------------------------------------------|----------------------------------------------------|------------------------------------------|----------------------------------------|
| `application` | `~/.vibefly/<product>/agent/settings.json` | `~/.vibefly/<product>/agent/settings.vibefly.json` | `~/.vibefly/<product>/agent/models.json` | `~/.vibefly/<product>/agent/auth.json` |
| `project`     | `<project>/.vibefly/settings.json`         | `<project>/.vibefly/settings.vibefly.json`         | 不支持                                   | 不支持                                 |

project 设置不使用 pi 原生的 `<project>/.pi/settings.json`。Agent 通过 Host-backed storage 把 Host 快照提供给 pi，而不是让
pi 或 Agent 绕过 Host 直接读取另一个 project 配置源。

`settings.json` 仅保存 pi `Settings` 已知字段，例如默认 Provider / Model、thinking、compaction、retry 和 enabled models。
`settings.vibefly.json` 保存 Commit Message、pin / MRU、UI locale 等产品字段。`models.json` 保存 Provider / Model 定义，
`auth.json` 只保存凭据；凭据不得进入其他三个文件。

**不变量：** `settings.json` 与 `settings.vibefly.json` **不得**存放凭据或含密字段。Host 只校验 JSON 语法 / object 根，不按字段白名单投影。WebView 不接收这两份原始文档。

### 合并语义

application 和 project 的两个文件分别独立合并：

```text
effectiveSettings = deepMerge(application.settingsJson, project.settingsJson)
effectiveVibefly = deepMerge(application.vibeflyJson, project.vibeflyJson)
effectiveModels = application.modelsJson
effectiveAuth = application.authJson
```

- project 文件或键缺失时继承 application 值。
- 两边同为 JSON object 时逐键递归合并。
- project 的数组替换 application 的整个数组，不按元素合并。
- project 的字符串、数字、布尔值和 `null` 替换 application 值。
- `models.json` 和 `auth.json` 不读取 project 层，也不执行合并；所有 project Agent 共享当前 product 的 application 快照。
- 未知键必须原样保留，便于 pi 或 Vibe Fly schema 向前演进。
- 不在两个文件之间交叉合并，也不把 `vibefly` 命名空间塞进 pi `settings.json`。

合并算法和 schema 只实现一次，放在 `packages/vibefly-uiagent-shared`，供 UI 与 Agent 使用。Kotlin Host 只校验 JSON
语法、管理原始文档和通用 RPC DTO，不镜像完整 TypeScript schema。effective 合并只在 Agent 执行；UI 只消费 `SettingKey` 结果。

## Host 服务与快照

### 生命周期

Host 提供两级服务：

- application service 在 IDE application 生命周期内唯一，启动时加载 application 的四份文件并开始监听。
- project service 每个打开的 project 一个，加载 `<project>/.vibefly/` 的两份文件；project 关闭时释放 watcher 和订阅。
- project service 依赖 application service。application 快照变化时，所有 project 消费者的 effective cache 都必须失效。

application service 缓存四份原始 JSON，project service 缓存两份原始 JSON。消费者请求 project 配置时分别获取 application 和
project 快照，再由 Agent 的 `SettingsSyncClient` 计算 effective 配置和 `SettingKey` 来源。UI 不再持有或合并原始 JSON。

### 快照模型

受信任的 Host ↔ Agent 快照使用原始 JSON 字符串和**文件级** opaque revision，避免在 Kotlin 中复制完整设置 schema：

```ts
type SettingsScope = "application" | "project"
type SettingsFile = "settings.json" | "settings.vibefly.json" | "models.json" | "auth.json"

type SettingsDiagnostic = {
  file: SettingsFile
  severity: "error" | "warning"
  message: string
}

type AgentSettingsSnapshot = {
  scope: SettingsScope
  projectRoot: string | null
  settingsJson: string
  vibeflyJson: string
  modelsJson?: string
  authJson?: string
  revisions: Partial<Record<SettingsFile, string>>
  diagnostics: SettingsDiagnostic[]
}
```

- application 快照的 `projectRoot` 必须是 `null`；project 快照必须带规范化后的绝对 project root。
- 各 `*Json` 字段是该 scope 最后一次有效的原始 JSON，而非已合并结果。
- project 快照没有 `modelsJson`、`authJson` 字段；传入或落盘 project 版本必须被拒绝。
- 文件不存在时对应原始层为 `{}`，不产生错误。
- 每个文件有独立 revision，只用于相等性判断；消费者不得解析、排序或自行生成。
- 内容或 diagnostics 发生可观察变化时，只更新该文件 revision；无实际变化的重复 watcher 事件不能产生新 revision。

上面的类型只在 Host 内部和受信任 Agent 控制面使用。WebView 不接收原始设置 JSON。Providers RPC 返回完整的单个 Provider
entry（`configJson`）与脱敏鉴权状态；`auth.json`、OAuth token、credential store 仍不进入 WebView。

### 无效 JSON

Host 始终保留每个文件最后一次成功解析的内容：

1. watcher 读到无效 JSON 时，不用错误内容覆盖最后有效快照。
2. Host 更新 diagnostics、生成新 revision，并照常发送失效通知。
3. 消费者重新拉取后继续使用最后有效内容，同时可展示诊断。
4. 首次加载即无效且没有历史有效值时，该文件按 `{}` 提供。
5. 外部编辑修复后，Host 清除对应诊断、接受新内容并再次通知。
6. RPC 发起的保存若不是合法 JSON，Host 直接拒绝，不写盘，也不改变最后有效快照。

一个文件无效不能阻止同一 scope 的另一个文件被更新。

### Watcher、锁与原子写

- 使用 IntelliJ / 系统文件 watcher 监听 application 的四份文件和每个 project 的两份文件，覆盖创建、修改、替换和删除。
- 同一 scope 的短时间连续事件去抖后合并读取；去抖只减少重复工作，不能吞掉最终状态。
- 读取和写入遵循同一个锁协议。拿不到锁时有限重试，不能读取另一进程尚未完成的临时状态。
- 写入先在目标文件同目录创建临时文件，flush 后原子替换目标文件；平台不支持原子 move 时记录 warning 并使用安全回退。
- application 目录权限保持为仅当前用户可访问，`auth.json` 创建和替换后必须保持 owner-only 权限；日志和 diagnostics
  不能包含文件内容或 secret。
- 一次保存只写入单个文件，并只比较该文件的 expected revision。需要同时更新 `models.json` 与 `auth.json` 时按文件分别保存，后一次失败不回滚前一次。
- Host 自身写入引起的 watcher 回调通过内容比较去重，不能重复增加 revision 或形成通知循环。
- projectRoot 只能由 Host 从已打开的 IDE Project（UI JCEF 会话绑定）或 Agent 启动时注入的 `VIBEFLY_PROJECT_ROOT`
  解析并规范化；UI / Agent 请求参数不得携带任意路径，也不能越过 `<project>/.vibefly/`。

## RPC 契约

所有接口继续使用 `Caller2Callee` 服务名和已有传输：JCEF MessageRouter 用于 UI <-> Host，stdio 用于 Host <-> Agent，WebSocket 用于 UI <-> Agent。

### 读取与保存

```text
Ui2Agent.readSettingValues(keyIds) -> SettingValueResult[]
Ui2Agent.mutateSettings(request) -> SettingMutationResult
Agent2Ui.settingsInvalidated(change) -> void

Ui2HostSettings.applyProvidersPatch(request, expectedRevision) -> ProvidersPatchResult
Ui2HostSettings.setProviderApiKey(request) -> ProvidersPatchResult
Ui2HostSettings.mutateCustomProvider(request, expectedRevision) -> ProvidersPatchResult

Host2Agent.getProvidersSnapshot(modelsJson, authJson) -> ProvidersSnapshot
Host2Agent.applyProvidersPatch(request, modelsJson) -> ModelsDocumentPatchResult
Host2Agent.setProviderApiKey(request) -> ProviderApiKeyResult
Host2Agent.mutateCustomProvider(request, modelsJson, authJson) -> ProviderDocumentsPatchResult
Agent2Host.getSettingsSnapshot(scope) -> AgentSettingsSnapshot
Agent2Host.saveSettingsDocuments(request) -> SettingsSaveResult
Agent2Host.saveAuth(request) -> SettingsSaveResult
```

`scope = "project"` 时，Host 使用会话绑定的 project root：Agent 来自进程环境 `VIBEFLY_PROJECT_ROOT`。调用方只传 `scope`，不传路径。无绑定 project 却请求 project scope 时拒绝。

设置数据面不再经过 `Ui2Host`。UI 只发送已注册 `keyId`；Agent 计算 effective 值与来源，并把单文件保存提交给 Host。
`Agent2Host.saveSettingsDocuments` 每次只保存一个文档及其 expected revision。

UI 通过 Providers RPC 读取完整 Provider entry（`configJson`）与鉴权状态；Provider 编辑使用带 `expectedRevision` 的 patch，其中
`ProviderPatch.configJson` 整条目替换 `models.json.providers[id]`（非字段合并），未知键按调用方提供的 JSON 原样保留。
`applyProvidersPatch` 只修改 `models.json`。API Key 走 `setProviderApiKey`（Agent credential store → `saveAuth`）；
自定义 Provider 配置与可选 API Key 走 `mutateCustomProvider`，由 Host 按文件分别写入 `models.json` / `auth.json`。
OAuth 登录、取消和登出仍是独立控制面命令，不进入 typed settings mutation。已有 OAuth 会话时设置 API Key 会被拒绝，需先 Disconnect。
`AgentSettingsSnapshot` 在受信任的本机 stdio 控制面上传输完整 application 四文件和 project 两文件。

Agent 登录、登出或刷新凭据时，Host-backed credential adapter 使用专门的 `Agent2Host.saveAuth`，请求只允许 application
scope、`authJson` 和 `expectedRevision`。发生冲突时 adapter 重新拉取最新 application 快照，在最新凭据 map 上重放本次
provider 级修改后重试，不能用旧整文件覆盖其他 Agent 同时写入的凭据。

Host 在持锁状态下比较目标文件的 `expectedRevision` 与该文件当前 revision：

- 相等：校验、写入、更新快照并返回新 revision。
- 不相等：拒绝写入并返回明确的 revision conflict；调用方重新读取、重新应用用户修改后再保存。
- project scope 但会话无合法打开 project：拒绝请求。
- project scope 的 Providers patch，或任何 WebView 请求包含原始 `modelsJson` / `authJson`：拒绝请求。

除 `Agent2Host.saveAuth` 和 `saveSettingsDocuments` 外，Agent 不直接写设置文件。Provider 编辑由 Agent 对 Host 传入的权威文档做纯变换，再由 Host
按文件保存 `models.json` / `auth.json`；Agent 不得在 patch RPC 内反向 fetch/save，也不得新增分开的 `saveModels`。
认证**状态**属于 Settings 存储体系（`auth.json` + 文件级 revision）；认证**流程**属于 Provider auth 控制面。

### 失效通知

```text
Host2Agent.settingsChanged(notification) -> void
Agent2Ui.settingsInvalidated(change) -> void
```

通知不携带 JSON，按 changed file 列出 `scope` / `document` / `revision`。`projectRoot` 仅作身份字段：application 为 `null`，project 为规范化绝对路径。消费者比较文件 revision；发现本地快照不是该 revision 时重新拉取。通知允许合并、重复或乱序，正确性依赖重新读取。

application 文件变化 fan-out 给所有存活的 project Agent；project 变化只发给对应 Agent。Agent 收敛后再广播 `settingsInvalidated` 给当前 Project 的所有 UI 连接。

`SettingsSyncClient.notify()` 可在 `start()` 前接收通知，并按 scope 保留最新目标 revision；首次快照完成后自动追平。断线重连仍执行完整初始读取，因此不依赖 Host 保存历史事件。

## 共享 TypeScript 设置核心

`packages/vibefly-uiagent-shared/src/settings/` 将设置 schema、typed keys、semantic mutation 和同步 client 分开维护。这些逻辑不依赖浏览器、Node 文件系统或 Kotlin：

- `settings.json`、`settings.vibefly.json`、`models.json` 和 `auth.json` 的 TypeScript schema 与运行时校验。
- `definition.ts` 中的单一 shape：schema 解析与 typed keys 共用 `PI_SETTINGS_SHAPE` / `VIBEFLY_SETTINGS_SHAPE`。
- application / project object deep merge。
- `models.json` / `auth.json` 的 application-only 约束和无合并语义。
- 原始快照、opaque revision 和 effective revision 管理。
- 按 scope 缓存、失效、重新拉取、保存队列和 selector 订阅。
- 保留未知键的不可变更新辅助函数。
- diagnostics 聚合。

核心 API 是 `SettingsSyncClient<TSnapshot>` 和 `SettingsSyncAdapter<TSnapshot>`。adapter 提供 `fetch(scope)` 和单文件 `save(request)`。只有 Agent 持有完整快照并调用 `Agent2Host`。UI 通过 `Ui2Agent.readSettingValues` / `mutateSettings` 消费 typed key，不再持有 JSON 或实现 merge。`modelsJson`、`authJson`、credential helper 以及 Provider 文档 snapshot/patch 只从 `@vibefly/uiagent-shared/agent` 导出，不会进入 WebView root bundle。

同文件的 fetch/save 串行，不同 `(scope, document)` 可并行。`mutate()` 在目标原始层按 typed key 重放语义操作，按文件分别保存并保留未知键；冲突时拉取最新层并重放，最多四次。保存成功后仍拉取 Host 权威快照，不在客户端伪造 revision。selector 只有选中值变化时才通知，因此 diagnostics-only revision 不会触发无关消费方。

当前 typed keys 包括默认 Provider/Model、Commit Message 四个字段、pin/MRU 和 UI locale。这些 key 都从 effective 层读取，并允许 project override。`unset` 语义为后续恢复继承保留基础。
`SettingValuesOf` 把 key 树投影成必填值树（去掉结构层 `readonly`，叶子类型不变）；默认值来自 `key.decode(undefined)` 并经 `cloneSettingValue` 深拷贝。`selectSettings` 对整棵树逐叶调用 `selectSetting`，一律读取 effective 合并结果。UI 的 `IdeSettings` 只声明一次分组映射，不再用手写 `FormOf` 或 `PiSettings` / `VibeflySettings` 文档类型做表单模型。

托管字段用非破坏性 tagged rule 包装现有 `SchemaRule`，元数据只有 `fallback` 和可选 `encode`；值类型继续由 `InferRule` 推断。keys 层递归进入 object rule，只为 tagged 字段生成 `SettingKey`（自动推导 `path` / `id` / `document`）。Pi 全量 schema 保持完整，仅 `defaultProvider`、`defaultModel` 带 typed-key 元数据。schema 解析与 key decode 使用同一规则；混合非法字符串数组按 `STRING_ARRAY_RULE` 的 reject 语义回退为空数组，不再由 key 单独过滤。

## UI 流程

### 首次加载

1. WebView 建立 `Ui2Host` / `Host2Ui` 会话。
2. 设置页 / 聊天页通过 Host 票据连接 Agent。
3. `SettingKeyStore` 向 Agent 批量读取已订阅 `SettingKey`；Providers 页面只消费脱敏模型和鉴权状态。
4. diagnostics 与有效配置分开呈现，错误不能让整个设置页不可用。

### 保存

1. UI 提交 typed mutation，不指定 scope。
2. Agent 按 effective source 选择目标文件，在最新原始层上应用 mutation。
3. Agent 携带该文件 expected revision 调用 `Agent2Host.saveSettingsDocuments`。
4. 成功后 Agent 收敛到 Host 返回的 revision，再通知所有 UI 设置消费者。
5. UI 只刷新受影响的已订阅 key；冲突重放在 Agent 完成，最多四次。

General / Commit 页面仍使用 300ms debounce 并在卸载时 flush；Provider 默认模型以及聊天 pin/MRU 立即进入 runtime 的统一保存队列。`IdeSettings` 只是 typed keys 投影得到的视图模型，不再负责 JSON path 或 revision retry。

`UiProviderSettingsClient` 统一 Provider refresh、API Key、自定义 Provider mutation、login/logout 后的 application revision 对齐。自定义 Provider mutation 最多冲突重放四次；API Key / login / logout 不由 UI 自动重试（credential store 内部最多重放五次）。只有 settings client 已收敛到 RPC 返回 revision 时才接受其 Provider snapshot，application 失效后由 SettingsShell 的单一订阅触发合并刷新。

## Agent 与 pi 热重载

Agent 启动后通过 `Agent2Host.getSettingsSnapshot` 获取 application 四文件和自己的 project 两文件。`HostSettingsRuntime` 只订阅一次共享 sync state，并组合三个小桥接层：

- `PiSettingsBridge`：把递归合并后的 effective settings 作为 pi `global` storage，pi `project` 固定返回 `{}`，所有 pi 写入均消费后丢弃。
- `ModelConfigBridge`：解析 application `models.json`，通过 pi 公共 `registerProvider()` / `unregisterProvider()` API 更新目录，并拒绝把 `apiKey` 等敏感字段注入 runtime registration。`ModelsStore` 是动态模型目录缓存，不用于加载 `models.json`。
- `HostCredentialStore`：保持 pi `CredentialStore` 的 provider 级 modify/delete 语义，经 `Agent2Host.saveAuth` 持久化并在冲突时重拉、重放。

这里故意不把 application/project 原始层直接交给 pi。pi 0.83 的 `SettingsManager` 对 global/project 嵌套字段只进行一层合并，无法替代 Vibe Fly 的递归 object merge；因此共享层先算出完整 effective settings，再物化为 pi global，project 保持空对象。Agent 侧还对 pi 0.83 的 `SettingsManager.fromStorage` / `inMemory` 参数建立编译期契约检查，不让共享包依赖 pi，也不 patch 上游。

收到 `Host2Agent.settingsChanged` 后：

1. `SettingsSyncClient` 重新拉取变更 scope，产出带 previous/current 的单次状态事务。
2. 先更新 `PiSettingsBridge`。
3. 在 credential 互斥区更新 application auth；project 失效不能回滚刚持久化的 application credential。
4. models 变化时应用注册；仅 auth 变化时执行一次 `allowNetwork: false` 的 runtime refresh。
5. settings/models/auth 任一语义内容变化时，对存活会话最多 reload 一次；models/auth 变化同时发布 model catalog change。diagnostics-only revision 不 reload。
6. 单个会话 reload 失败只记录到 stderr 并隔离，不回退 Host 快照，也不调用 `stopAllOpenProjects()`。

新增会话总是从最新 effective 快照创建。Agent 没有活跃会话时仍更新缓存，下一次创建会话不需要再重启进程。

pi 登录、登出以及 token refresh 通过 Host-backed credential store 的 provider 级 `modify` / `delete` 写回
`Agent2Host.saveAuth`。Host 保存成功后再广播 application 失效通知，使同 product 下的其他 project Agent 收敛到新凭据。

Host-backed storage 应通过 pi 的公开扩展点或本仓 `vibefly-*` 适配层实现。不得修改上游包源码；若上游没有所需扩展点，按仓库约束使用包管理器
patch / 独立 patch 目录并说明原因。

## 启动与旧状态

不迁移 IDE XML settings 中的任何数据。Host 运行时只认 JSON 文件；旧 XML state class 在代码切换后可删除或闲置，但不参与读取、合并或
fallback。

1. application service 启动时加载 application 四文件；文件不存在时对应原始层为 `{}`，不自动创建、不从 XML 灌入。
2. project service 同理加载 project 两文件；缺失即 `{}`。
3. 已有 `models.json`、`auth.json`（Agent 目录下）由 application service 接管加载、watcher、revision、诊断和后续写入；不重写、不移动。
4. sessions 与 `ChatWorkspaceState` 不在配置快照内，本架构不触碰。
5. 用户首次在 UI 保存时才按正常校验、锁和原子写协议落盘对应文件。

## 本轮不包含

- 不增加 Global / Project scope 切换、继承来源展示或恢复继承 UI。
- Provider 登录走当前 Project agent 的 `withControl`，反向 RPC 和取消流程保持现状。
- 不修改四文件格式、revision 算法或原子落盘协议。Host2Agent Provider RPC 改为文档纯变换，Ui2HostSettings WebView 契约保持不变。
  `applyProvidersPatch` 现在只变换 `models.json`；凭据写入走独立认证命令。
- 不迁移旧 XML 数据，也不让 UI 获得原始 `authJson`。

## 验证场景

| 场景                    | 预期结果                                                                                           |
|-------------------------|----------------------------------------------------------------------------------------------------|
| 首次加载                | application 四文件和 project 两文件各读取一次；只有 settings / vibefly 按 project 覆盖 application |
| UI 保存                 | Agent 按 source 写入单个文件；Host CAS 成功后通知 Agent，Agent 再通知 UI 重读 key                 |
| 外部文件变更            | watcher 去抖后更新快照和 revision，UI / Agent 不重启即可看到新值                                   |
| revision 冲突           | Host 不写盘；UI 重新读取并语义重放用户修改，最多四次                                               |
| 无效 JSON               | 文件保持原状，运行时使用最后有效快照并收到 diagnostics；修复后自动恢复                             |
| application 变化        | 所有 project effective cache 失效，所有存活 Agent reload                                           |
| project 变化            | 仅对应 project 的 UI / Agent 失效和 reload                                                         |
| models application-only | 所有 project 使用同一份 `models.json`，`<project>/.vibefly/models.json` 永不读取                   |
| auth application-only   | 所有 project 使用同一份 `auth.json`，并发 provider 级写入发生冲突时重读重放                        |
| UI secret 隔离          | UI 快照和 WebView 日志中均不存在原始凭据、API Key 或 token                                         |
| Agent live reload       | Host-backed pi storage 更新且存活 `AgentSession.reload()` 最多调用一次，进程 PID 不变              |
| 重连 / 漏通知           | 消费者首次读取当前 snapshot 后收敛，不依赖历史事件重放                                             |

文档和实现收尾检查：

- 所有 project 路径必须是 `<project>/.vibefly/settings.json` 或 `<project>/.vibefly/settings.vibefly.json`，不得写成
  `.pi/settings.json`。
- `models.json` 和 `auth.json` 必须只出现在 application 目录，不能设计 project 覆盖或合并逻辑。
- 原始 `authJson` 只能通过受信任的 Host <-> Agent stdio 控制面传输，不能进入任何 UI DTO。
- RPC 服务名必须遵循 `Ui2Host`、`Host2Ui`、`Agent2Host`、`Host2Agent` 的调用方向。
- 合并顺序必须是 application 在前、project 在后。
- Agent stdout 仍只承载 Content-Length 协议帧，reload 日志只能写 stderr。
- 契约变更后运行对应生成任务和 `generate:check`；本文档单独修改时运行 `git diff --check`。
