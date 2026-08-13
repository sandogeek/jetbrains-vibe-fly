# Host 集中式设置架构

本文描述当前设置系统及设置消费层的实现边界。Host 集中落盘、四文件布局、revision 协议和凭据隔离已经落地；本文同时标明本轮未提供的产品能力。

English: [setting.en.md](./setting.en.md)

## 目标与约束

1. Host 是 application / project 配置文件的唯一落盘方，并持有两个作用域的内存快照。
2. UI 和 Agent 只通过现有 SimpleRpc 读取、保存和订阅设置，不直接访问设置文件。
3. pi 原生字段保存在 `settings.json`，Vibe Fly 专有字段保存在 `settings.vibefly.json`，模型定义和凭据分别保存在
   `models.json`、`auth.json`；不修改上游 pi 类型或源码。
4. 只有 `settings.json` 和 `settings.vibefly.json` 支持 project 覆盖：对象递归合并，数组、标量和 `null` 由 project 层整体替换。
   `models.json` 和 `auth.json` 只有 application 层。
5. Host 只推送小型失效通知；消费者收到通知后重新 RPC 拉取快照，不在通知中携带完整配置。
6. 保存使用 opaque revision 做乐观并发控制，并配合文件锁、同目录临时文件和原子替换。
7. 设置热更新不得通过重启全部 Agent 实现。
8. 会话和 workspace 状态不纳入配置快照。

UI -> Agent 的业务契约仍只存在于 `packages/vibefly-uiagent-shared`，不新增 Kotlin 镜像。设置读取属于 UI -> Host 和
Agent -> Host；不得为此引入 SimpleRpc 之外的第二套 RPC。

## 当前实现边界

- 设置页和聊天页通过同一个 UI runtime 消费 Host 快照；Agent 通过相同的共享同步核心消费受信任快照。
- 设置页不再出现在 IDE Settings 对话框中。聊天页齿轮打开当前 Project 唯一的编辑器 Tab：每个 Project 缓存同一个 `LightVirtualFile`，重复打开只聚焦已有 Tab。关闭 Tab 时释放 RPC、Host 和浏览器。
- 当前 UI 所有设置写入仍固定为 application scope。typed key 已记录合法 scope 并支持 `unset`，但本轮不展示 Global / Project 切换、继承来源或“恢复继承”入口。
- Settings WebView 仍以 `hasProject: false` 启动（不展示 Project 覆盖或作用域切换）；Chat WebView 以 `hasProject: true` 启动。因此 locale 等 effective 字段可在聊天页读取 project 覆盖，pin / MRU 始终读取 application 层。
- 设置 Tab 的 Host / Agent 操作显式绑定该 Tab 所属 Project，不再回退到“任取一个已打开 Project”。Provider 登录生命周期使用该 Project agent 的 `withControl` 和反向 RPC。Provider 配置和 revision 收敛已进入统一 UI client。
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

**不变量：** `settings.json` 与 `settings.vibefly.json` **不得**存放凭据或含密字段。Host 对这两份文档做 UI 透传（只校验
JSON 语法 / object 根），不按字段白名单投影；UI 保存时整文件替换已提供的文档。

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
语法、管理原始文档和通用 RPC DTO，不镜像完整 TypeScript schema。

## Host 服务与快照

### 生命周期

Host 提供两级服务：

- application service 在 IDE application 生命周期内唯一，启动时加载 application 的四份文件并开始监听。
- project service 每个打开的 project 一个，加载 `<project>/.vibefly/` 的两份文件；project 关闭时释放 watcher 和订阅。
- project service 依赖 application service。application 快照变化时，所有 project 消费者的 effective cache 都必须失效。

application service 缓存四份原始 JSON，project service 缓存两份原始 JSON。消费者请求 project 配置时分别获取 application 和
project 快照，再由共享 `SettingsSyncClient` 计算 effective 配置。这样 UI 和 Agent 使用完全相同的覆盖规则，同时不会为
`models.json`、`auth.json` 虚构 project 层。

### 快照模型

RPC 使用原始 JSON 字符串和 opaque revision，避免在 Kotlin 中复制完整设置 schema。概念模型如下：

```ts
type SettingsScope = "application" | "project"

type SettingsDiagnostic = {
  file: "settings.json" | "settings.vibefly.json" | "models.json" | "auth.json"
  severity: "error" | "warning"
  message: string
}

type ApplicationSettingsSnapshot = {
  scope: "application"
  projectRoot: null
  settingsJson: string
  vibeflyJson: string
  modelsJson: string
  authJson: string
  revision: string
  diagnostics: SettingsDiagnostic[]
}

type ProjectSettingsSnapshot = {
  scope: "project"
  projectRoot: string
  settingsJson: string
  vibeflyJson: string
  revision: string
  diagnostics: SettingsDiagnostic[]
}

type SettingsSnapshot = ApplicationSettingsSnapshot | ProjectSettingsSnapshot
```

- application 快照的 `projectRoot` 必须是 `null`；project 快照必须带规范化后的绝对 project root。
- 各 `*Json` 字段是该 scope 最后一次有效的原始 JSON，而非已合并结果。
- project 快照没有 `modelsJson`、`authJson` 字段；传入或落盘 project 版本必须被拒绝。
- 文件不存在时对应原始层为 `{}`，不产生错误。
- `revision` 只用于相等性判断，消费者不得解析、排序或自行生成。
- 内容或 diagnostics 发生可观察变化时 revision 都要变化；无实际变化的重复 watcher 事件不能产生新 revision。

project 的 effective revision 由 application revision 与 project revision 共同组成，仅存在于共享 `SettingsSyncClient`
的缓存中。任一层变化都使 effective cache 失效。

上面的类型是 Host 内部和受信任 Agent 使用的完整模型。Providers RPC 返回完整的单个 Provider entry（`configJson`，即
`models.json.providers[id]` 对象，可包含 `apiKey`、headers、未知字段）；`auth.json`、OAuth token、credential store 仍不进入
WebView，只返回脱敏后的鉴权状态（`ProviderCredentialStatus`）。UI 与 Agent 投影共享同一 scope revision，因此 UI
仍能在鉴权文件变化后收到失效通知并刷新状态。

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
- 一次保存若同时修改多份文件，先验证全部 JSON，再在 scope 级互斥区内写入，最后只发布一次新 revision 和通知。
- Host 自身写入引起的 watcher 回调通过内容比较去重，不能重复增加 revision 或形成通知循环。
- projectRoot 只能由 Host 从已打开的 IDE Project（UI JCEF 会话绑定）或 Agent 启动时注入的 `VIBEFLY_PROJECT_ROOT`
  解析并规范化；UI / Agent 请求参数不得携带任意路径，也不能越过 `<project>/.vibefly/`。

## RPC 契约

所有接口继续使用 `Caller2Callee` 服务名和已有传输：JCEF MessageRouter 用于 UI <-> Host，stdio 用于 Host <-> Agent。

### 读取与保存

```text
Ui2Host.getSettingsSnapshot(scope) -> UiSettingsSnapshot
Ui2Host.saveSettings(request) -> SettingsSaveResult
Ui2HostSettings.applyProvidersPatch(request, expectedRevision) -> ProvidersPatchResult

Agent2Host.getSettingsSnapshot(scope) -> AgentSettingsSnapshot
Agent2Host.saveAuth(request) -> SettingsSaveResult
```

`scope = "project"` 时，Host 使用会话绑定的 project root：UI 来自该 WebView 所属 Project；Agent 来自进程环境
`VIBEFLY_PROJECT_ROOT`。调用方只传 `scope`，不传路径。无绑定 project 却请求 project scope 时拒绝。

UI 保存请求至少包含：

```ts
type SettingsSaveRequest = {
  scope: SettingsScope
  settingsJson?: string
  vibeflyJson?: string
  expectedRevision: string
}
```

`UiSettingsSnapshot` 和 `SettingsSaveRequest` 都不能包含原始 `modelsJson` 或 `authJson`。UI 通过 Providers RPC 读取完整
Provider entry（`configJson`）与鉴权状态；Provider 编辑使用带 `expectedRevision` 的 patch，其中
`ProviderPatch.configJson` 整条目替换 `models.json.providers[id]`（非字段合并），未知键按调用方提供的 JSON 原样保留。
`UiSettingsSnapshot` 的 `settingsJson` / `vibeflyJson` 与磁盘原始文档一致（无字段投影）；
`SettingsSaveRequest` 对提供的文档做整文件替换（省略的文件不变）。`AgentSettingsSnapshot` 在受信任的本机 stdio 控制面上传输完整
application 四文件和 project 两文件。

Agent 登录、登出或刷新凭据时，Host-backed credential adapter 使用专门的 `Agent2Host.saveAuth`，请求只允许 application
scope、`authJson` 和 `expectedRevision`。发生冲突时 adapter 重新拉取最新 application 快照，在最新凭据 map 上重放本次
provider 级修改后重试，不能用旧整文件覆盖其他 Agent 同时写入的凭据。

省略的文件保持不变。Host 在持锁状态下比较 `expectedRevision` 与当前 scope revision：

- 相等：校验、写入、更新快照并返回新 revision。
- 不相等：拒绝写入并返回明确的 revision conflict；调用方重新读取、重新应用用户修改后再保存。
- project scope 但会话无合法打开 project：拒绝请求。
- project scope 的 Providers patch，或任何 UI 请求包含原始 `modelsJson` / `authJson`：拒绝请求。

除 `Agent2Host.saveAuth` 外，Agent 是配置只读消费者。所有文件最终都由 Host 使用统一锁和原子写协议落盘；Agent 的 pi
storage、model registry 和 credential store 不直接写文件。

### 失效通知

```text
Host2Ui.settingsChanged(scope, projectRoot, revision) -> void
Host2Agent.settingsChanged(scope, projectRoot, revision) -> void
```

通知不携带 JSON。`projectRoot` 仅作身份字段：application 为 `null`，project 为规范化绝对路径，便于消费者区分缓存键；不是让调用方回传路径。消费者比较
revision；发现本地快照不是该 revision 时，通过相反方向的 RPC 重新拉取。通知允许合并或重复，因此正确性依赖重新读取，而不是依赖每条事件都送达。

application 任一文件变化都必须 fan-out 给所有设置面板、聊天面板和存活的 project Agent。每个 project `SettingsSyncClient` 同时订阅
application scope 和自己的 project scope，所以 application 通知会使所有 project effective cache 失效。project 通知只发送给对应
project 的消费者。

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

核心 API 是 `SettingsSyncClient<TSnapshot>` 和 `SettingsSyncAdapter<TSnapshot>`。adapter 提供 `fetch(scope)`，可写消费者再提供 `save(request)`；UI adapter 调用 `Ui2Host` 并使用安全投影，Agent adapter 调用 `Agent2Host` 并使用完整投影。两边复用 revision、缓存和合并行为，但不会新增 UI <-> Agent 设置 RPC。`modelsJson`、`authJson`、credential helper 只从 `@vibefly/uiagent-shared/agent` 导出，不会进入 WebView root bundle。

同 scope 的 fetch/save 串行，不同 scope 可并行。`mutate()` 在目标原始层按 typed key 重放语义操作，一次请求可同时保存 settings/vibefly 文档并保留未知键；冲突时拉取最新层并重放，最多四次。保存成功后仍拉取 Host 权威快照，不在客户端伪造 revision。selector 只有选中值变化时才通知，因此 diagnostics-only revision 不会触发无关消费方。

当前 typed keys 包括默认 Provider/Model、Commit Message 四个字段、pin/MRU 和 UI locale。默认模型、Commit 和 locale 从 effective 层读取；pin/MRU 固定从 application 层读取。key 同时声明合法写入 scope 和 `unset` 语义，为后续恢复继承保留基础。
`SettingValuesOf` 把 key 树投影成必填值树（去掉结构层 `readonly`，叶子类型不变）；默认值来自 `key.decode(undefined)` 并经 `cloneSettingValue` 深拷贝。`selectSettings` 对整棵树逐叶调用 `selectSetting`，因此 effective / application 读取语义不变。UI 的 `IdeSettings` 只声明一次分组映射，不再用手写 `FormOf` 或 `PiSettings` / `VibeflySettings` 文档类型做表单模型。

托管字段用非破坏性 tagged rule 包装现有 `SchemaRule`，元数据只有 `readLayer`、`scopes`、`fallback` 和可选 `encode`；值类型继续由 `InferRule` 推断。keys 层递归进入 object rule，只为 tagged 字段生成 `SettingKey`（自动推导 `path` / `id` / `document`）。Pi 全量 schema 保持完整，仅 `defaultProvider`、`defaultModel` 带 typed-key 元数据。schema 解析与 key decode 使用同一规则；混合非法字符串数组按 `STRING_ARRAY_RULE` 的 reject 语义回退为空数组，不再由 key 单独过滤。

## UI 流程

### 首次加载

1. WebView 建立 `Ui2Host` / `Host2Ui` 会话。
2. UI adapter 拉取脱敏 application 快照；有 project 上下文时再拉取 project 快照。
3. `UiSettingsRuntime` 组合安全快照 adapter、`SettingsSyncClient`、optimistic draft 和 selector 订阅；Providers 页面只消费脱敏模型和鉴权状态。
4. diagnostics 与有效配置分开呈现，错误不能让整个设置页不可用。

### 保存

1. 当前表单写入固定落到 application scope；Provider / Model 修改也固定为 application scope。
2. `UiSettingsRuntime` 将 typed mutations 交给 `SettingsSyncClient`，在 application 原始层上应用并保留未知键。
3. UI 用该层读取时的 revision 作为 `expectedRevision` 调用 `Ui2Host.saveSettings`。
4. 成功后拉取 Host 权威快照；冲突时在最新层自动重放本地语义 mutation，最多四次。
5. 其他面板通过 `Host2Ui.settingsChanged` 自行刷新。

General / Commit 页面仍使用 300ms debounce 并在卸载时 flush；Provider 默认模型以及聊天 pin/MRU 立即进入 runtime 的统一保存队列。`IdeSettings` 只是 typed keys 投影得到的视图模型，不再负责 JSON path 或 revision retry。

`UiProviderSettingsClient` 统一 Provider refresh、patch、login/logout 后的 application revision 对齐。Provider patch 最多冲突重放四次；login/logout 不自动重试。只有 settings client 已收敛到 RPC 返回 revision 时才接受其 Provider snapshot，application 失效后由 SettingsShell 的单一订阅触发合并刷新。

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
- 不修改 Kotlin Host、SimpleRpc wire 契约、四文件格式、revision 算法或原子落盘协议。
- 不迁移旧 XML 数据，也不让 UI 获得原始 `authJson`。

## 验证场景

| 场景                    | 预期结果                                                                                           |
|-------------------------|----------------------------------------------------------------------------------------------------|
| 首次加载                | application 四文件和 project 两文件各读取一次；只有 settings / vibefly 按 project 覆盖 application |
| UI 保存                 | revision 匹配时原子写入目标 scope，只发送失效通知，其他消费者重新拉取                              |
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
