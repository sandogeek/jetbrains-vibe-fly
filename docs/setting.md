如果settings.json能满足，优先使用settings.json
如果需要锁文件，复用 pi lock，不另起一套。
引入jsfe，简化配置界面生成？ModelsConfigSchema结合jsfe生成完整模型配置界面
ui与设置的同步：所有设置变更均先经过host，这样所有订阅者看到的配置变动顺序都是一致的

settings.json新增
默认模型、commit、pin/MRU	→ settings.json
标签/session 列表	继续 ChatWorkspaceState

```
ConfigRepository          // 读/写 global + project 文件（或调 Agent）
  loadGlobal(): RawConfig
  loadProject(root): RawConfig
  saveGlobal(patch)
  saveProject(root, patch)

ConfigMerger              // deepMerge，对齐 pi
  merge(global, project): EffectiveConfig

SettingsFacade (Host)     // SettingsUi2Host 调用的门面
  getEffective(project?)
  getLayer(scope)
  apply(scope, dto) → 写盘 → notify

SettingsChangeBus         // 多 WebView / 多 Project 同步
```

ide启动后，会启动一个setting agent，专门用来处理设置相关功能，不依赖withControlForSettings。
Agent: Node.js JSON + pi Settings + vibefly 命名空间
每个project各对应一个agent，用于处理对话等功能
### 痛点
每个 Project → 独立 Node.js coding agent（VibeflyAgentService PROJECT）
设置改动 → stopAllOpenProjects() 重启所有 agent   ← 粗暴
Providers 写 models.json / auth.json 在「碰巧被 withControlForSettings 选中的」project agent 上
多 WebView / 多 project 状态不同步
### TODO
支持import，也支持导入 pi 的 models.json 与 settings.json。import 逻辑：打开一个文件选择器，选择一个文件，然后会开启一个 merge diff 窗口，让用户自行决定如何合并
