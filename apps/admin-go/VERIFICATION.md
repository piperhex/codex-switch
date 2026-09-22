# 本地验证记录

最终统一运行：2026-09-23（Asia/Shanghai）。所有请求面向本地模拟环境。

| 检查模块 | 通过检查数 |
| --- | --- |
| identity | 110 |
| accounts | 140 |
| content | 135 |
| devices | 40 |
| chat | 84 |
| transport | 53 |
| bodyParser | 27 |
| migrations | 3 |
| 合计 | 592 |

- 146/146 个已注册 HTTP 路由均有成功场景，另覆盖权限、输入校验和业务失败。
- 6,349 个 Nest ValidationPipe 样本及 105 个 qs 表单样本通过 Go 测试。
- Go 单元测试、vet、gofmt 检查通过；Linux CGO race 测试通过。
- 正式 Dockerfile 从源码构建成功，包含同源管理页面，运行镜像约 37.7 MB。
- 两套数据库 schema 完全一致；真实镜像空库初始化、重复启动和数据保留通过。
- 浏览器验证了登录及 17 个后台菜单，并在正式镜像切换后重新加载仪表盘成功。

登录令牌互读、刷新并发与恢复、SMTP 收信、PKCE、模拟上游 TLS、ZIP 上传下载、WebSocket v1/v2、设备 ACK/超时、会话重建及真实 UDP STUN 均有检查。

未注册路径的安全诊断差异见 README；模拟供应商检查不等于生产账号验收。

原始执行日志保存在本机 testdata/results/；脚本可重新生成 summary.json 和下面的路由报告。

## HTTP 路由覆盖

| Method | Route | Successful scenario | Checks |
| --- | --- | --- | --- |
| GET | `/admin` | yes | 3 |
| GET | `/admin/api/announcement` | yes | 2 |
| PATCH | `/admin/api/announcement` | yes | 6 |
| GET | `/admin/api/announcement/clicks` | yes | 1 |
| GET | `/admin/api/announcement/clicks/overview` | yes | 1 |
| GET | `/admin/api/approvals` | yes | 1 |
| POST | `/admin/api/approvals` | yes | 1 |
| POST | `/admin/api/approvals/:id/review` | yes | 3 |
| GET | `/admin/api/audit-logs` | yes | 2 |
| GET | `/admin/api/chat-settings` | yes | 1 |
| PATCH | `/admin/api/chat-settings` | yes | 3 |
| GET | `/admin/api/codex-home-presets` | yes | 1 |
| PATCH | `/admin/api/codex-home-presets` | yes | 2 |
| GET | `/admin/api/currency` | yes | 2 |
| PATCH | `/admin/api/currency` | yes | 7 |
| GET | `/admin/api/dashboard/overview` | yes | 5 |
| GET | `/admin/api/email-templates` | yes | 1 |
| GET | `/admin/api/email-templates/:code` | yes | 2 |
| PATCH | `/admin/api/email-templates/:code` | yes | 4 |
| GET | `/admin/api/faqs` | yes | 1 |
| POST | `/admin/api/faqs` | yes | 2 |
| DELETE | `/admin/api/faqs/:id` | yes | 1 |
| PATCH | `/admin/api/faqs/:id` | yes | 2 |
| GET | `/admin/api/feedback` | yes | 1 |
| GET | `/admin/api/feedback/:id` | yes | 3 |
| GET | `/admin/api/feedback/:id/attachments/:attachmentId` | yes | 1 |
| POST | `/admin/api/feedback/:id/email` | yes | 3 |
| GET | `/admin/api/invitations` | yes | 2 |
| POST | `/admin/api/invitations` | yes | 1 |
| DELETE | `/admin/api/invitations/:id` | yes | 1 |
| POST | `/admin/api/invitations/:id/token` | yes | 2 |
| GET | `/admin/api/invitations/:id/users` | yes | 2 |
| GET | `/admin/api/mail-services` | yes | 1 |
| POST | `/admin/api/mail-services` | yes | 1 |
| DELETE | `/admin/api/mail-services/:id` | yes | 1 |
| PATCH | `/admin/api/mail-services/:id` | yes | 2 |
| GET | `/admin/api/notifications` | yes | 1 |
| POST | `/admin/api/notifications` | yes | 2 |
| DELETE | `/admin/api/notifications/:id` | yes | 2 |
| PATCH | `/admin/api/notifications/:id` | yes | 1 |
| GET | `/admin/api/official-accounts` | yes | 4 |
| POST | `/admin/api/official-accounts` | yes | 5 |
| DELETE | `/admin/api/official-accounts/:id` | yes | 4 |
| PATCH | `/admin/api/official-accounts/:id` | yes | 9 |
| GET | `/admin/api/official-accounts/:id/bindings` | yes | 2 |
| POST | `/admin/api/official-accounts/batch-delete` | yes | 3 |
| POST | `/admin/api/official-accounts/bind` | yes | 4 |
| POST | `/admin/api/official-accounts/import` | yes | 2 |
| POST | `/admin/api/official-accounts/import/sub2api` | yes | 1 |
| POST | `/admin/api/official-accounts/oauth/:sessionId/poll` | yes | 2 |
| POST | `/admin/api/official-accounts/oauth/start` | yes | 1 |
| POST | `/admin/api/official-accounts/unbind` | yes | 1 |
| GET | `/admin/api/permissions` | yes | 1 |
| POST | `/admin/api/permissions` | yes | 3 |
| PATCH | `/admin/api/permissions/:code` | yes | 2 |
| GET | `/admin/api/profile/accounts` | yes | 1 |
| PATCH | `/admin/api/profile/accounts/:accountId` | yes | 1 |
| POST | `/admin/api/profile/accounts/:accountId/add-to-pool` | yes | 1 |
| POST | `/admin/api/profile/accounts/add-to-pool` | yes | 1 |
| GET | `/admin/api/profile/accounts/deleted` | yes | 1 |
| POST | `/admin/api/profile/accounts/deleted/:accountId/restore` | yes | 2 |
| PATCH | `/admin/api/profile/password` | yes | 2 |
| GET | `/admin/api/profile/providers/deleted` | yes | 1 |
| POST | `/admin/api/profile/providers/deleted/:providerId/restore` | yes | 1 |
| GET | `/admin/api/prompt-plugins` | yes | 1 |
| DELETE | `/admin/api/prompt-plugins/:id` | yes | 1 |
| PATCH | `/admin/api/prompt-plugins/:id` | yes | 2 |
| GET | `/admin/api/roles` | yes | 1 |
| POST | `/admin/api/roles` | yes | 5 |
| DELETE | `/admin/api/roles/:code` | yes | 5 |
| PATCH | `/admin/api/roles/:code` | yes | 3 |
| GET | `/admin/api/skills` | yes | 3 |
| DELETE | `/admin/api/skills/:id` | yes | 1 |
| PATCH | `/admin/api/skills/:id` | yes | 2 |
| GET | `/admin/api/telemetry/events` | yes | 1 |
| GET | `/admin/api/telemetry/installations` | yes | 1 |
| GET | `/admin/api/telemetry/overview` | yes | 1 |
| GET | `/admin/api/users` | yes | 4 |
| POST | `/admin/api/users` | yes | 6 |
| DELETE | `/admin/api/users/:id` | yes | 6 |
| PATCH | `/admin/api/users/:id` | yes | 6 |
| GET | `/admin/api/users/:id/accounts` | yes | 1 |
| DELETE | `/admin/api/users/:id/accounts/:accountId` | yes | 1 |
| PATCH | `/admin/api/users/:id/accounts/:accountId` | yes | 8 |
| POST | `/admin/api/users/:id/accounts/:accountId/add-to-pool` | yes | 1 |
| GET | `/admin/api/users/:id/providers` | yes | 1 |
| GET | `/admin/reset-password` | yes | 1 |
| POST | `/announcements/clicks` | yes | 13 |
| POST | `/announcements/clicks/authenticated` | yes | 1 |
| GET | `/announcements/current` | yes | 5 |
| POST | `/auth/login` | yes | 50 |
| POST | `/auth/logout` | yes | 2 |
| GET | `/auth/me` | yes | 4 |
| POST | `/auth/password-reset` | yes | 1 |
| POST | `/auth/password-reset/code` | yes | 2 |
| POST | `/auth/refresh` | yes | 4 |
| POST | `/auth/register` | yes | 9 |
| POST | `/auth/register/code` | yes | 5 |
| GET | `/chat/title-settings` | yes | 1 |
| GET | `/codex-home-presets` | yes | 2 |
| GET | `/currency-rates` | yes | 5 |
| GET | `/devices` | yes | 3 |
| DELETE | `/devices/:deviceId` | yes | 2 |
| POST | `/devices/:deviceId/account` | yes | 2 |
| POST | `/devices/:deviceId/openai-auth-account` | yes | 1 |
| POST | `/devices/:deviceId/provider` | yes | 3 |
| POST | `/devices/:deviceId/provider-group` | yes | 2 |
| POST | `/devices/:deviceId/restart-codex` | yes | 5 |
| GET | `/devices/providers` | yes | 1 |
| GET | `/faqs` | yes | 9 |
| POST | `/feedback` | yes | 7 |
| POST | `/feedback/authenticated` | yes | 1 |
| GET | `/notifications/recent` | yes | 2 |
| GET | `/prompt-plugins` | yes | 2 |
| POST | `/prompt-plugins` | yes | 4 |
| PATCH | `/prompt-plugins/:id` | yes | 3 |
| GET | `/prompt-plugins/:id/install` | yes | 3 |
| GET | `/skills` | yes | 1 |
| POST | `/skills` | yes | 9 |
| PATCH | `/skills/:id` | yes | 3 |
| GET | `/skills/:id/download` | yes | 2 |
| GET | `/skills/:id/preview` | yes | 2 |
| GET | `/sync/accounts` | yes | 7 |
| PUT | `/sync/accounts` | yes | 6 |
| DELETE | `/sync/accounts/:id` | yes | 2 |
| PUT | `/sync/accounts/:id` | yes | 12 |
| GET | `/sync/accounts/:id/details` | yes | 3 |
| PATCH | `/sync/accounts/:id/details` | yes | 3 |
| GET | `/sync/accounts/:id/reset-credits` | yes | 2 |
| POST | `/sync/accounts/:id/reset-credits/consume` | yes | 2 |
| GET | `/sync/accounts/:id/usage` | yes | 1 |
| POST | `/sync/accounts/import` | yes | 3 |
| POST | `/sync/accounts/oauth/:sessionId/poll` | yes | 3 |
| POST | `/sync/accounts/oauth/embedded/:sessionId/complete` | yes | 3 |
| POST | `/sync/accounts/oauth/embedded/:sessionId/poll` | yes | 4 |
| POST | `/sync/accounts/oauth/embedded/start` | yes | 2 |
| POST | `/sync/accounts/oauth/start` | yes | 1 |
| GET | `/sync/accounts/summary` | yes | 4 |
| GET | `/sync/accounts/web-summary` | yes | 1 |
| GET | `/sync/providers` | yes | 3 |
| PUT | `/sync/providers` | yes | 2 |
| DELETE | `/sync/providers/:id` | yes | 1 |
| PUT | `/sync/providers/:id` | yes | 4 |
| GET | `/sync/totp` | yes | 2 |
| PUT | `/sync/totp` | yes | 6 |
| POST | `/telemetry/installations` | yes | 4 |
