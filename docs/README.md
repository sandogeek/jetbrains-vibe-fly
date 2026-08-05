# Vibe Fly 文档

本目录存放设计与实现说明。 **运行时真相以代码为准**；文档若与代码冲突，以代码为优先，并应回写文档。

| 文档                                   | 内容                                        |
|----------------------------------------|---------------------------------------------|
| [architecture.md](./architecture.md)   | 三层架构、通道职责、仓库地图                |
| [development.md](./development.md)     | 环境、构建、Run Config、热更、调试、日志    |
| [rpc.md](./rpc.md)                     | SimpleRpc 三通道、服务命名、契约与代码生成  |
| [agent.md](./agent.md)                 | Node Agent 生命周期、会话、调度、stdio 约定 |
| [chat-messages.md](./chat-messages.md) | pi 事件 → ChatEvent → assistant-ui 消息适配 |
| [setting.md](./setting.md)             | 设置：当前实现、设计目标、痛点与 TODO       |

## 相关入口

| 路径                                 | 说明                                         |
|--------------------------------------|----------------------------------------------|
| [README.md](../README.md)            | 用户向：功能、安装、开发摘要                 |
| [设想.md](../设想.md)                | 早期设想与路线图（部分已落地，部分仍是规划） |
| [AGENTS.md](../AGENTS.md)            | 编码 Agent 工作约定                          |
| [packages/*/README.md](../packages/) | 各子包说明                                   |

## 写文档时

1. 标明 **现状** vs **规划**，避免把 `设想.md` / TODO 写成已实现。
2. 服务名遵循 `Caller2Callee`；UI↔Agent 契约只在 TypeScript（`vibefly-uiagent-shared`）。
3. Agent `stdout` 仅协议帧；日志写 stderr。
4. 小而聚焦；实现变更后同步更新对应文档。
