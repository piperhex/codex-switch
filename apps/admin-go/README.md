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

## 构建与运行

在仓库根目录构建，Docker 会同时编译管理页面和 Go 后端：

```sh
docker build -f apps/admin-go/Dockerfile -t codex-switch/admin-go:local .
```

支持通过构建参数 `GOPROXY`、`NPM_REGISTRY` 指定下载源。Go 工具链版本固定在 `go.mod` 和 Dockerfile。
本地开发时，在 `apps/admin-go` 目录运行 `go test ./...`、`go vet ./...`、`go run ./cmd/admin-go`。
直接运行前要提供 PostgreSQL、Redis，以及 `PUBLIC_DIR` 指向的已构建页面目录。

将 `.env.example` 复制为 `.env` 并填入实际配置；迁移时沿用原部署配置，不生成替代密钥。
`compose.yml` 同时加入现有数据库网络和 Kong 网络，不会创建新的 PostgreSQL 或 Redis。
设置 `ADMIN_GO_DB_NETWORK` 为原后端的数据库网络名（通常是 `<原 Compose 项目名>_backend-internal`），
设置 `ADMIN_GO_KONG_NETWORK` 为 Kong 所在网络名，默认 `kong-net`。
原来的 `ADMIN_GO_NETWORK` 仍可使用；只有未设置 `ADMIN_GO_DB_NETWORK` 时才会采用它。

Go 使用独立网络别名 `codex-switch-admin-go`，可通过 `ADMIN_GO_KONG_ALIAS` 修改。
启动 Go 后，Kong 仍指向原后端；验收完成后，再把原服务的上游改为 `http://codex-switch-admin-go:8080`。
旧、新服务同时运行时，不要让它们共用 `codex-switch-backend` 别名。
宿主机映射已包含 `host.docker.internal:host-gateway`；`CODEX_OUTBOUND_PROXY` 应沿用原服务实际使用的值。
原 Compose 未单独设置代理时会使用 `http://host.docker.internal:7890`；需要直连时可在 Go 配置中留空。

原后端已停止、正式 STUN 端口未被占用时，可直接启动：

```sh
docker compose --env-file apps/admin-go/.env -f apps/admin-go/compose.yml up -d --build
```

页面入口为 `/admin`。默认宿主机 HTTP 地址为 `127.0.0.1:8080`，可用 `ADMIN_GO_BIND` 和 `ADMIN_GO_PORT` 修改。
Go 的 STUN 在容器内监听 UDP `CHAT_STUN_PORT`，默认 3478；正式部署默认映射为宿主机 `0.0.0.0:3478`。
`ADMIN_GO_STUN_BIND` 和 `ADMIN_GO_STUN_PORT` 可修改公网绑定地址和端口，需与原 `CHAT_STUN_URLS` 保持一致。
原后端仍在运行时，改用下面的并行验收命令，避免占用其公网 STUN 端口：

```sh
ADMIN_GO_STUN_BIND=127.0.0.1 ADMIN_GO_STUN_PORT=3479 \
  docker compose --env-file apps/admin-go/.env -f apps/admin-go/compose.yml up -d --build
```

此时 Go STUN 只供本机验收，原后端继续提供公网 STUN。停止原后端后，再取消临时覆盖，重新创建 Go 容器，
使正式端口映射生效。完整切换和回滚步骤见 [MIGRATION.md](MIGRATION.md)。
新数据库可临时设置 `POSTGRES_DB_SYNCHRONIZE=true` 来初始化；已有数据库始终保持原结构，
后续结构升级继续使用 `apps/admin/sql` 中对应版本的迁移。

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
