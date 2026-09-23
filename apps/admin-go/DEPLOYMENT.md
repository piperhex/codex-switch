# admin-go 生产部署

生产后端只部署 `apps/admin-go`，管理页面与 Go 程序使用同一个镜像。
`apps/admin` 的 NestJS 源码已冻结，仅用于本地兼容对照测试。
以下命令从仓库根目录执行，不包含任何具体生产主机或凭据。

## 已有环境与新安装

已有环境沿用 PostgreSQL、Redis、Kong、数据库目录和密钥。记录当前 Go 镜像 ID、Compose
项目名、所有 Compose 文件、网络、端口与数据容器的 ID/启动时间。保留服务器上的 `.env`
和 `compose.override.yml`；不要用示例覆盖现有配置。正常更新只操作 `admin-go`。

新安装先复制 `apps/admin-go/.env.example` 为同目录的 `.env`，设置真实数据库密码，
为 `KONG_JWT_SECRET`、`JWT_REFRESH_SECRET` 分别生成随机密钥，并限制文件访问权限。
`KONG_JWT_KEY` 与 Kong JWT credential 的 key 保持一致；已有安装的三个值必须保持原样。
管理配置中的 SMTP 等密文也依赖原密钥，不能在升级时重新生成。

`ADMIN_GO_DB_NETWORK`、`ADMIN_GO_KONG_NETWORK` 必须对应实际 Docker 网络。
已有数据库网络即使仍叫 `admin_backend-internal` 也应保留，不要因为迁移目录而重建。
`POSTGRES_HOST` 和 `REDIS_HOST` 填写各自在该网络上的地址；保留实际出站代理
`CODEX_OUTBOUND_PROXY`，有意直连时留空。Go 容器已提供 `host.docker.internal` 映射。

仅在全新安装、尚无数据服务时，创建指定的数据网络并启动可选依赖：

```sh
docker network create codex-switch-data
sudo install -d -m 0750 /srv/codex-switch/postgres
docker compose --project-name codex-switch-data --env-file apps/admin-go/.env \
  -f apps/admin-go/compose.infrastructure.yml up -d postgres redis
```

这份文件不运行 NestJS，也不启动 Go 或 Kong。PostgreSQL 使用配置的宿主机目录，
Redis 使用持久卷。已有数据服务不执行这组新装命令。Kong 网络由现有网关管理。

## 本地验证、构建和打包

先确认目标提交已提交且工作区干净；存在其他改动时使用独立检出目录。
运行 `npm run check:backend`、`npm run check -w @codex-switch/admin-ui`，
然后执行 Docker 的 `verify` 阶段（Linux race tests 与 vet）。
首次迁移或修改认证、数据格式、PC/手机协议时，还需运行 [README](README.md) 中的隔离对照测试。

构建平台必须匹配服务器。以下 PowerShell 示例假设服务器为 `linux/amd64`：

```powershell
$targetCommit = (git rev-parse HEAD).Trim()
$imageTag = "codex-switch/admin-go:$targetCommit"
docker build --platform linux/amd64 -f apps/admin-go/Dockerfile --target verify -t codex-admin-go:verify .
if ($LASTEXITCODE -ne 0) { throw 'Go container verification failed' }
docker build --platform linux/amd64 -f apps/admin-go/Dockerfile -t $imageTag .
if ($LASTEXITCODE -ne 0) { throw 'Production image build failed' }
$imageId = (docker image inspect $imageTag --format '{{.Id}}').Trim()
if ($LASTEXITCODE -ne 0) { throw 'Image inspection failed' }
$archive = Join-Path ([IO.Path]::GetTempPath()) "admin-go-$targetCommit.tar"
docker image save --output $archive $imageTag
if ($LASTEXITCODE -ne 0) { throw 'Image archive failed' }
Get-FileHash -LiteralPath $archive -Algorithm SHA256
```

记录提交、平台、镜像 tag/ID 与文件 SHA-256，用 `scp` 上传到服务器受保护的部署记录目录。
使用文件传输，不把二进制镜像管道接入 PowerShell 文本处理。镜像中不包含生产 `.env`。
下载源不通时可使用 `GOPROXY`、`NPM_REGISTRY` 构建参数，不修改代码或关闭依赖校验。
服务器网络命令应遵循该环境已配置的代理要求。

## 数据库与配置

升级前备份 PostgreSQL 和 Redis，并确认备份可读取。数据库升级脚本位于 `sql/`，
只有确认缺失且兼容的升级才按版本顺序执行；目录移动不代表需要重新运行已应用的 SQL。
生产保持 `POSTGRES_DB_SYNCHRONIZE=false`。它不是增量迁移开关，不能升级已有数据库。

模型计价预设需要 `sql/20260923-token-cost-presets.sql`。已有库确认缺少
`token_cost_preset_settings` 时，在备份后执行该增量脚本；它只新增配置表，不修改用户数据。

密码登录锁定需要 `sql/20260923-user-login-locks.sql`。更新应用前，在备份后为已有库执行该脚本，
新增 `user_login_locks` 表以保存账号的连续错误次数和锁定截止时间。脚本可重复执行，不修改已有用户。
应用镜像回滚时保留该表即可；旧镜像不会执行新的登录锁定规则。

全新空数据库第一次启动可以临时在 `.env` 设置 `POSTGRES_DB_SYNCHRONIZE=true`，
由 Go 初始化完整结构；初始化成功后改回 `false`，仅重建 Go 服务。
不要将 `internal/migrations/001_legacy_schema.sql` 直接导入已有库。

HTTP 默认只发布 `127.0.0.1:8080`，Kong 通过容器网络访问 Go。保留实际生产别名和覆盖文件。
内置 STUN 默认监听并发布 UDP 3478；`CHAT_STUN_URLS=stun:你的公网域名:3478`
需要匹配公网映射、安全组和防火墙。UDP 不经过 Kong，无需开放 TCP 3478。
使用外部 STUN 或设置 `CHAT_STUN_PORT=0` 时，应在覆盖文件中用 `ports: !override`
仅保留 HTTP，避免基础 UDP 映射指向端口 0；此语法需要 Compose 2.24.4+。

## 加载并更新 Go

服务器仓库必须能快进到已验证的目标提交，禁止 reset 或强制覆盖本地改动。
先记录运行镜像并创建回滚 tag，再校验上传文件的 SHA-256，使用 `docker image load --input`
加载镜像，并核对镜像 ID、Linux 平台与本地记录一致。
`ADMIN_GO_IMAGE` 可指定提交 tag；未设置时沿用 `codex-switch/admin-go:local`。
如沿用原镜像引用，将已验证的新镜像 ID 标记到该引用；保留单独的回滚 tag。

使用实际观察到的项目名。以下为默认项目的 Bash 示例，自动带上已有 Go 覆盖文件：

```bash
set -Eeuo pipefail
go_compose=(docker compose --project-name admin-go --env-file apps/admin-go/.env -f apps/admin-go/compose.yml)
if test -f apps/admin-go/compose.override.yml; then
  go_compose+=(-f apps/admin-go/compose.override.yml)
fi
"${go_compose[@]}" config --quiet
"${go_compose[@]}" up -d --no-deps --no-build --pull never admin-go
```

不要在加载本地镜像后重新构建，不运行整栈 `down` 或 `--remove-orphans`。
更新 Go 不需要重启 PostgreSQL、Redis、Kong 或 Web。数据库和 Redis 的 ID/启动时间应保持不变。

独立 Web 的入口在 `apps/web/compose.yml`。需要更新 Web 时另行构建、上传并使用原 Web
项目名更新 `web`；已有 Web 容器不能改用新项目名再启动一份。
全新 Web 安装可选择独立项目名。它不依赖或启动 NestJS，默认网络别名为 `codex-switch-web`。

## Kong

新网关参考 [existing-kong.example.yml](kong/existing-kong.example.yml)，
Go 上游为 `http://codex-switch-admin-go:8080`，Web 上游为 `http://codex-switch-web:80`。
自定义 `ADMIN_GO_KONG_ALIAS` 时使用实际别名。已有 Kong service 的名称和 ID 可以保留，
只修改必要的上游地址；不要覆盖其他路由、插件、TLS 或超时设置。
DB-backed Kong 通过已确认的 Admin API 管理；声明式 Kong 应持久化修改原配置。

`/auth`、`/admin` 等公开路径和受保护的 `/sync`、`/devices`、`/admin/api` 都指向同一 Go 进程。
公开路由还需包含 `/token-cost-presets`，供 PC 启动时读取计价预设；保持 `strip_path=false`。
`/device-switch`、`/device-chat` 必须保留 WebSocket Upgrade；首帧在 Go 内校验 JWT。
JWT 插件使用 `key_claim_name=iss`、`claims_to_verify=exp`、`run_on_preflight=false`。
`/web` 指向独立 Web 服务并启用 `strip_path=true`。

Kong 的 worker 配置和 DNS 缓存可能晚于修改生效。重建容器后应核对新 IP，并在限定时间内
重复公网检查；不能仅凭 Admin API 返回成功判断流量已切换。若需更换别名，应先在持久化
Compose 配置中加入并验证新别名，再更新相应上游。不要为了刷新缓存重启整个网关。
Go 为兼容旧接口保留了 `X-Powered-By: Express`，该响应头不能判断实际运行语言。

## 验收与回滚

- 容器使用预期镜像且持续运行，无重启循环；同时读取 stdout/stderr，确认 `admin-go listening`。
- 本机和公网 `/admin`、页面静态资源返回 200；未登录 `/auth/me` 返回 401。
- 使用专用测试账号和模拟设备验证两个公网 WebSocket、设备指令确认、PC/手机配对、
  双向加密转发、手机恢复和桌面会话重建，不向真实用户的 PC 发送测试指令。
- 从服务器外部发起 UDP STUN Binding 请求。HTTP 正常不能证明公网 UDP 可达。
- 验证数据库、Redis 未被重建或重启；删除临时测试账号并保存部署记录。

出现确认的更新故障时，恢复已记录的上一版 admin-go 镜像及其兼容配置，使用同一 Compose
项目和文件执行 `up -d --no-deps --no-build --pull never --force-recreate admin-go`，
再执行相同验收。回滚只使用 Go 镜像，不启动 NestJS；不自动恢复数据库备份覆盖在线数据。
首次迁移在旧服务停止前完成并行验证；缺少已验证的 Go 回滚镜像时应在切换前解决这一条件。
