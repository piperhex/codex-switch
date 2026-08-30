# 系统提示词插件市场设计

## 目标

在桌面端插件市场的社区插件、官方插件之后增加“系统提示词”Tab。用户可以直接填写名称、版本、类型和提示词正文发布插件，也可以浏览、安装、升级和卸载系统提示词插件。安装和卸载必须安全地映射到现有的系统提示词过滤/注入配置，不执行插件代码。

## 范围与边界

- 本次新增独立的系统提示词插件模型、接口和客户端页面；普通社区技能与官方 Codex 插件行为保持不变。
- 系统提示词插件每个发布版本只包含一条正文，类型只能是 `injection`（注入）或 `filter`（过滤）。
- 发布字段仅包含 `name`、`version`、`type`、`text`；卡片使用正文截断内容作为摘要，不要求额外 description 或文件上传。
- 系统提示词插件包不允许脚本、二进制或任意文件，服务器只存储结构化字段。
- 本仓库的 `apps/admin` 包含 NestJS/TypeORM 云服务端；本次在该服务内新增 PostgreSQL 表、实体、DTO、接口和测试，并在桌面端完成消费与本地安装状态管理。

## 数据模型

服务端新增 `prompt_plugins` 表：

| 字段 | 类型 | 约束 |
| --- | --- | --- |
| `id` | UUID | 主键 |
| `name` | varchar(120) | 非空；按发布者和名称唯一 |
| `version` | varchar(40) | 非空；仅允许 ASCII 字母、数字、`.`、`_`、`+`、`-` |
| `type` | enum | `injection` 或 `filter` |
| `text` | text | 非空；最多 5000 个 Unicode 字符 |
| `uploader_id` | UUID | 外键；非空 |
| `install_count` | bigint | 非负，默认 0 |
| `created_at` / `updated_at` | timestamptz | 非空 |

API 返回 `PromptPluginItem`：

```ts
interface PromptPluginItem {
  id: string;
  name: string;
  version: string;
  type: "injection" | "filter";
  text: string;
  uploaderId: string | null;
  installCount: number;
  createdAt: string;
  updatedAt: string;
  installed: boolean;
  installedVersion: string | null;
  enabled: boolean;
}
```

## HTTP 接口

- `GET /prompt-plugins`：返回已审核、可见的插件列表；登录用户的 `installed`、`installedVersion`、`enabled` 由服务端或客户端本地状态补全。
- `POST /prompt-plugins`：登录后创建插件，JSON body 为 `{ name, version, type, text }`。
- `PATCH /prompt-plugins/:id`：仅发布者可更新名称、版本、类型和正文；更新不改变插件 ID。
- `DELETE /prompt-plugins/:id`：仅发布者可删除尚未被其他用户安装的发布记录；已安装用户的本地副本不受远端删除影响。
- `GET /prompt-plugins/:id/install`：返回单个结构化插件（或复用列表中的完整对象），用于安装时校验最新版本。

所有接口复用现有云认证、刷新令牌和错误格式；正文不写入请求日志。

## 本地安装状态与归属

桌面端在应用数据目录维护 `prompt-plugin-state.json`，内容为插件 ID 到已安装版本、类型、正文哈希和启用状态的映射。系统提示词规则扩展可选的 `sourcePluginId` 字段：缺失表示用户手工规则，存在表示市场插件规则。

安装流程：

1. 校验 ID、类型、版本和正文长度，并以插件 ID 作为归属键。
2. 读取当前过滤或注入规则，移除同一 `sourcePluginId` 的旧规则。
3. 追加新规则（名称使用插件名称，`enabled` 默认继承旧状态，否则为 `true`），原子写入状态文件和现有代理状态。
4. 若对应总开关关闭，不自动打开总开关；卡片显示已安装但禁用的实际状态。

卸载流程：

1. 从 `prompt-plugin-state.json` 读取插件归属。
2. 仅从对应类型的规则列表移除该 `sourcePluginId` 的规则。
3. 保留所有没有该来源标记的手工规则，并原子写回代理状态。

升级流程等同于安装，但先替换同一插件 ID 的旧规则；用户之前手动切换的启用状态应保留。

## 桌面端界面

- `SkillsMarketTab` 扩展为 `community | official | prompt`，Tab 顺序固定为社区插件、官方插件、系统提示词。
- 新增 `PromptPluginsMarket`、`PromptPluginGrid`、`PromptPluginPublishModal` 和对应类型文件，保持页面组件职责单一。
- 工具栏在 `prompt` Tab 使用独立搜索占位文案；发布按钮打开轻量表单：名称、版本、类型分段选择、正文 TextArea。提交前校验必填项和长度。
- 卡片显示类型徽章（“注入”或“过滤”）、名称、版本、正文摘要、安装量和安装/卸载按钮；已安装时提供启用/禁用切换。
- 安装、升级、卸载和发布均显示紧凑 toast；错误显示在市场页面顶部，避免暴露文件路径、令牌或堆栈。
- 普通社区插件仍使用文件夹/ZIP 发布表单；官方插件仍只支持本地官方目录安装。

## 客户端 API 与 Tauri 命令

在 `apps/desktop/src/api/backend.ts` 增加 `fetchPromptPlugins`、`publishPromptPlugin`、`installPromptPlugin`、`removePromptPlugin`、`setPromptPluginEnabled`。本地后端增加异步 Tauri 命令并通过 `spawn_blocking` 执行文件和状态读写；Web 兼容层使用现有 `block_on` 适配。

命令只接收显式 DTO，不接收任意路径或脚本内容。所有正文在 Rust 边界重新校验，状态文件采用原子替换。系统提示词运行时继续复用现有过滤/注入逻辑。

## 错误处理与安全

- 类型、名称、版本、正文均在前端和 Rust/服务端双重校验。
- 安装数据只允许结构化 JSON；禁止通过系统提示词插件写入文件或执行代码。
- 网络请求失败不修改本地已安装状态；本地写入失败时回滚内存运行时配置。
- 卸载找不到本地归属时返回幂等成功，并刷新市场状态。
- 正文永远不进入诊断日志、错误详情或遥测。

## 测试策略

- Rust：模型反序列化兼容性、输入校验、安装/升级替换、卸载仅删除带 `sourcePluginId` 的规则、原子状态写入失败回滚。
- TypeScript：Tab 导航、发布表单校验、类型徽章、安装/卸载按钮状态和错误提示；使用真实纯函数，网络边界仅在不可避免处 mock。
- 回归：现有社区插件/官方插件测试保持通过；运行 `cargo fmt --check`、Rust 测试、桌面端 TypeScript/Vite 生产构建。
