# 从旧安装迁移到 admin-go

此文档仅供尚未切换的历史安装使用。常规部署、更新和回滚统一按 [DEPLOYMENT.md](DEPLOYMENT.md)
操作 admin-go；NestJS 版本已停止维护，仓库不再提供其生产部署入口。

## 保留数据与身份

备份 PostgreSQL、Redis、现有配置和网关路由。保留 `KONG_JWT_KEY`、`KONG_JWT_SECRET`、
`JWT_REFRESH_SECRET`、token TTL、SMTP、OAuth 与出站代理实际配置，不能用示例密钥替换。
确认数据库支持目标版本，缺失的增量升级从 `apps/admin-go/sql` 中选择并单独执行。
迁移 SQL 目录本身不改变数据库，也不需要重复运行已经应用的升级。
生产保持 `POSTGRES_DB_SYNCHRONIZE=false`；Go 的初始化逻辑不会升级已有表。

沿用数据网络、现有 PostgreSQL/Redis 容器和存储位置。Go 的 `compose.yml` 只加入网络，
不会重新创建数据库。Go 使用独立 Compose 项目及网络别名，不能让两个后端共用同一别名。

## 并行验收与切换

1. 本地构建并验证 Go 镜像，上传、校验后加载。先在脱敏数据库和独立 Redis 上运行兼容测试。
2. 创建 Go 配置，沿用原凭据。原服务占用公网 STUN 端口时，临时以
   `ADMIN_GO_STUN_BIND=127.0.0.1`、`ADMIN_GO_STUN_PORT=3479` 启动 Go；
   使用部署文档的显式 Compose 项目、环境和覆盖文件，始终保留这些临时绑定。
3. 验证本机页面、API、授权设备转发、会话恢复和本机 STUN，以及从 Kong 网络访问 Go。
   将已验证的 Go 镜像保留为迁移后的回滚基线。前置检查失败时，保留现有服务承接流量。
4. 将已有 Kong service 的 HTTP、`/device-switch`、`/device-chat` 上游一起改为 Go。
   等待 worker 配置生效，连续确认公网请求命中 Go，再进行公网设备转发检查。
   不能在两个后端之间轮询分配 PC/手机连接。
5. 停止原应用进程以释放公网 STUN 端口，保留 PostgreSQL、Redis、Kong、Web。
   取消临时 UDP 绑定并仅重建 Go；容器 IP 可能改变，按部署文档验证 Kong DNS 已指向新地址。
6. 验证公网 HTTP、WebSocket、双向转发、断线恢复和服务器外部的 UDP STUN。
   保存实际 Go 镜像、别名、项目名和覆盖文件，后续更新与回滚都使用 Go。

WebSocket 和进行中的 OAuth 授权属于原进程，切换时客户端需要重连或重新发起授权。
旧 JWT、bcrypt 密码、刷新 token 和加密配置保持兼容，不需要用户重新注册或批量重置密码。
会话路由仍以单个进程为边界；多实例部署必须保证同一设备的 PC/手机到达同一个实例。

## 已验证的数据兼容性

隔离对照测试覆盖 PostgreSQL 表、默认值、索引、约束、扩展，新库初始化和已有库保持不变，
以及双向 JWT、刷新 token 轮换、AES-GCM Redis 恢复记录与注销后的不可恢复性。
生产库可能包含历史 SQL 形成的等价约束、索引命名差异，应检查语义兼容，不能盲目覆盖结构。
验证入口见 `scripts/parity-migrations.mjs` 和 [README](README.md) 的身份对照测试。
