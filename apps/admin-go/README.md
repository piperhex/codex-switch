# admin-go

使用 Gin、GORM/PostgreSQL 和 Redis 实现的原生 Go 管理后端。管理页面沿用 `apps/admin-ui`；
运行镜像只有 Go 可执行文件、页面资源和 CA 证书，请求处理不依赖旧 Node 服务。

## 功能与兼容范围

- 认证、注册邀请、邮箱验证、密码重置、JWT 刷新恢复、角色权限、管理员审批与审计。
- 账号、Provider 和 TOTP 同步，字段版本合并、墓碑恢复、个人及官方账号池、导入、OAuth、用量及重置。
- 公告、通知、FAQ、Skills 文件、系统提示词、反馈与邮件、设备统计、仪表盘和各项后台配置。
- `/device-switch`、`/device-chat` WebSocket，v1/v2 聊天、会话恢复、中继统计和 UDP STUN。
- 原版 146 个 HTTP 路由、71 种 DTO 校验、30 张 PostgreSQL 表，兼容原 bcrypt 密码、JWT、
  Redis 刷新恢复密文以及 SMTP、汇率配置密文。

启动时会检查原版路由是否完整实现。契约来自当前 `apps/admin/src`，可以用以下命令检查是否过期：

```sh
node apps/admin-go/scripts/extract-contract.mjs --check
```

错误响应也参与对照测试。未注册路径的诊断文案保留安全差异：旧服务缺少 `index.html` 时，
会把服务器绝对路径写入 404 响应；Go 返回通用 404，不暴露路径。
未注册路径附带非法 JSON 时，也保留通用错误，不复制 Node 解析器的详细诊断。
这些不属于 146 个已注册接口的错误响应，会单独记录，不作为逐字一致处理。

## 生产部署

线上后端统一使用 admin-go。镜像在本地构建，上传并校验后由服务器加载。
完整的新装、更新、验收和 Go 镜像回滚步骤见 [DEPLOYMENT.md](DEPLOYMENT.md)。
管理页面由 `apps/admin-ui` 构建到 `apps/admin-go/public`，与 Go 程序一起打包；
管理端和 Web 镜像构建均不再读取 `apps/admin` 源码。

- `compose.yml`：连接现有 PostgreSQL、Redis 和 Kong 的 Go 服务；正常更新只重建 `admin-go`。
- `compose.infrastructure.yml`：新安装时可选的 PostgreSQL、Redis，已有环境沿用原数据容器。
- `../web/compose.yml`：独立 Web 容器，按需更新。
- `kong/existing-kong.example.yml`：指向 Go 的网关示例。
- `sql/`：已有数据库的版本升级脚本；移动目录不代表需要重新执行已应用的 SQL。

功能与接口见 [REFERENCE.md](REFERENCE.md)，尚未切换的旧安装见 [MIGRATION.md](MIGRATION.md)。

## 本地开发

安装 `go.mod` 指定的 Go 工具链，准备 PostgreSQL、Redis，并在 `apps/admin-go/.env` 中填写开发配置；进程环境变量优先。
直接运行时将 `PUBLIC_DIR` 设置为 `./public`，
数据库、Redis 地址填写宿主机可访问的地址；新建的空开发库可设置 `POSTGRES_DB_SYNCHRONIZE=true`。
在仓库根目录执行：

```sh
npm run build:admin
npm run dev:backend
```

`npm run build:backend` 构建 Go 程序到 `apps/admin-go/dist/`；`npm run check:backend`
检查接口契约、Go vet 和测试。容器构建支持 `GOPROXY`、`NPM_REGISTRY` 参数。

P2P 连接策略使用现有聊天设置 JSON 保存，无需新增数据库表。保存后立即向已鉴权的
`/device-chat` 客户端推送最新设置，客户端重连时也会获取最新值。三项时间均无业务上限。
本地对照环境启动后，运行 `node apps/admin-go/scripts/chat-policy-smoke.mjs` 验证实时推送、
大数值、权限和重连行为；脚本只访问固定的本地测试地址并在结束时恢复配置。

## 本地 Docker 对照测试

测试使用独立 PostgreSQL 数据库、两套 Redis、Mailpit 和模拟 OAuth/TLS 上游。
固定测试账号、证书和密码只用于这个环境。所有测试端口仅绑定 `127.0.0.1`。
测试脚本只接受代码中固定的本地数据库，不能传入生产连接地址。

首次准备环境（仓库根目录，Node 22+、Docker Compose）：

```sh
npm ci --prefix apps/admin-go/testdata/tools
node apps/admin-go/scripts/setup-parity.mjs
docker build -f apps/admin-go/Dockerfile -t codex-admin-go:parity .
docker compose -f apps/admin-go/compose.test.yml -f apps/admin-go/compose.image.yml --profile go up -d --no-build admin-go
node apps/admin-go/scripts/parity.mjs
```

统一测试按模块顺序执行，严格比较状态、响应体、下载内容和相关响应头；每条 HTTP 路由都必须有成功场景。
UUID、实际生成的凭据和执行时间会做有限归一化，权限列表按集合比较；关键字段、越权结果、
令牌互读、PKCE、重置额度和刷新并发行为另外单独断言。结果保存在 `testdata/results/`，
其中 `summary.json` 包含检查明细，`route-coverage.md` 列出逐路由证据。

默认模拟管理员：`admin-fixture@example.test`，密码 `Parity-admin-2026!`。

| 服务 | 本地地址 |
| --- | --- |
| 原版管理后台 | http://127.0.0.1:28080/admin |
| Go 管理后台 | http://127.0.0.1:28081/admin |
| 模拟收件箱 | http://127.0.0.1:18025 |
| 模拟 OAuth 服务 | http://127.0.0.1:18026 |

Go 校验样本来自真实 Nest `ValidationPipe`，已提交 6,349 个 oracle 样本，
另有 105 个来自原版 `qs` 的嵌套表单样本。HTTP 场景还覆盖 gzip、deflate、Brotli、UTF-16 和表单编码。
更新样本需要先安装原版 backend 开发依赖，再运行 `scripts/validation-oracle.cjs`。
Linux 并发检查使用独立 Docker 构建目标：

```sh
docker build -f apps/admin-go/Dockerfile --target verify -t codex-admin-go:verify .
```

Windows 快速迭代前，先在仓库根目录运行 `npm run build --workspace @codex-switch/admin-ui`，
生成供本地挂载的页面资源；然后运行 `scripts/build-local.ps1`，用 `compose.local.yml` 覆盖构建。
正式验收使用上面的源码镜像与 `compose.image.yml`。

迁移和回滚步骤见 [MIGRATION.md](MIGRATION.md)，检查明细与路由覆盖见 [VERIFICATION.md](VERIFICATION.md)。
