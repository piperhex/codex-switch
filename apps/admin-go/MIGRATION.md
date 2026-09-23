# 从现有 admin 迁移

切换只替换后端进程，继续使用现有数据库、Redis 和域名。启动 Go 容器不会自动切换 Kong 上游。

## 切换前

1. 对现有 PostgreSQL 和 Redis 做可恢复备份，记录原镜像版本、环境配置和代理上游。
2. 保持 `KONG_JWT_KEY`、`KONG_JWT_SECRET`、`JWT_REFRESH_SECRET` 原值。
   修改密钥会使登录会话和已有加密配置无法互读。保留 token TTL、邮件、OAuth 和代理相关配置。
3. 确认现有数据库已经应用当前版本 `apps/admin/sql` 的升级。Go 不会对已有库执行 `AutoMigrate`。
4. 构建 Go 镜像。先用脱敏数据库副本和独立 Redis 验证登录、账号列表、后台设置和设备连接。
   生产 `.env` 使用 `POSTGRES_DB_SYNCHRONIZE=false`。
5. 代理保留 `/admin`、原 HTTP 路由、`/device-switch` 和 `/device-chat` 路径及 WebSocket Upgrade 配置。
   UDP STUN 沿用原端口和 `CHAT_STUN_URLS`。管理页面已包含在 Go 镜像内。
6. 将 `ADMIN_GO_DB_NETWORK` 设为原 PostgreSQL/Redis 所在网络，`ADMIN_GO_KONG_NETWORK` 设为 Kong 所在网络。
   默认分别为 `admin_backend-internal` 和 `kong-net`；原 Compose 项目名不同，需要调整数据库网络名。
   兼容旧 `ADMIN_GO_NETWORK`，但显式设置的 `ADMIN_GO_DB_NETWORK` 优先。
   保留独立别名 `ADMIN_GO_KONG_ALIAS=codex-switch-admin-go`，不要使用原后端的 `codex-switch-backend` 别名。
7. 核对原后端实际生效的代理配置；原 Compose 默认代理为 `http://host.docker.internal:7890`，
   即使原 `.env` 没有填写也会生效。Go 已配置宿主机映射，仍需把实际代理地址写入 `CODEX_OUTBOUND_PROXY`；
   只有需要直连时才留空。先验证 OAuth 和用量请求能够访问上游。

## 切换

1. 先启动连接现有 PostgreSQL/Redis 的 Go 实例，检查启动日志、登录、页面和本机 UDP STUN。
   `.env` 保留正式 STUN 映射，启动时临时覆盖为本机 UDP 3479，让原后端继续占用公网 UDP 3478：

   ```sh
   ADMIN_GO_STUN_BIND=127.0.0.1 ADMIN_GO_STUN_PORT=3479 \
     docker compose --env-file apps/admin-go/.env -f apps/admin-go/compose.yml up -d --build admin-go
   ```

   并行验收期间，每次重新创建 Go 容器都要保留上述临时覆盖。
   HTTP 本机端口也应与原服务区分；Go 默认为 8080，原 Compose 默认为 9999。
2. 验收完成后，把 Kong 原后端服务的上游改为 `http://codex-switch-admin-go:8080`；
   使用自定义别名时替换主机名。HTTP、`/device-switch` 和 `/device-chat` 必须一起切换。
   不要把旧、新后端同时放进轮询上游，同一设备的 PC 和手机需要连接同一个进程。
3. 等待原后端的普通请求结束，然后停止原后端，使旧 WebSocket 连接重新连接到 Go，并释放公网 STUN 端口。
4. 确认 `.env` 的 `ADMIN_GO_STUN_BIND` 为原公网绑定地址（通常是 `0.0.0.0`），
   `ADMIN_GO_STUN_PORT` 为原公网 STUN 端口（通常是 3478），保留原 `CHAT_STUN_URLS`。
   取消临时环境覆盖，运行下面的命令使正式映射生效；容器重建期间客户端会再次重连，STUN 会短暂不可用：

   ```sh
   docker compose --env-file apps/admin-go/.env -f apps/admin-go/compose.yml up -d --no-build admin-go
   ```

5. 从服务器外部检查原域名的登录、PC/手机连接和公网 UDP STUN。

旧 JWT、bcrypt 密码、刷新 token 和加密配置可直接使用，不需要用户重新注册或批量重设密码。

WebSocket 连接属于原进程，切换后客户端需要重连。v2 桌面会话描述和 resume proof 支持重建协调会话，
测试覆盖了断开、替换连接、重建与恢复；v1 按原协议重新连接。迁移不能保留原进程的 TCP 连接。
未完成的 OAuth 授权会话同样属于发起授权的进程；应等待这些短期会话完成，或由客户端重新发起。

设备路由和聊天协调状态仍以单个服务进程为边界，和原服务一致。不要把同一设备的桌面/手机连接
随机分配到独立实例；需要多实例时，沿用原来的会话亲和策略。

切换后检查现有会话的 `/auth/me`、刷新、同步列表、后台设置、设备上线/切换、聊天恢复和中继统计。
对已配置的 SMTP、OAuth、汇率供应商保留原配置；本地验证使用的是模拟服务，不包含生产供应商账号验收。

## 回滚

先停止 Go 容器释放公网 UDP STUN 端口，再以记录的旧镜像和配置启动原后端。
确认原服务就绪后，将 Kong 上游切回原地址，并让客户端重连。保持同一数据库和 Redis、同一密钥。
Go 没有修改数据库结构；生成的密码 hash、JWT、刷新恢复密文和持久化数据保持旧版格式。
不要覆盖回滚期间产生的用户数据；只有发生独立的数据损坏时，才按备份恢复流程处理。

## 已验证的数据兼容性

- 两套运行库的 `pg_dump --schema-only` 一致，包含列、默认值、索引、约束和扩展。
- 使用临时 `admin_go_bootstrap` 数据库启动真实 Go Docker 镜像，可创建与旧版相同的 30 表结构。
- 重复启动保留已有 schema 和哨兵数据，不进行隐式结构迁移。
- 双向 JWT 使用、旧刷新 token 在 Go 轮换、两侧互读 AES-GCM Redis 恢复记录，以及注销后不可复活。

以上检查由 `scripts/parity-migrations.mjs` 和身份对照测试自动执行。
