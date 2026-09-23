# 管理后端功能与接口参考

生产后端为 admin-go，部署步骤见 [DEPLOYMENT.md](DEPLOYMENT.md)。

## Registration Email Verification

Every public or invitation-based registration requires a six-digit email verification code. Codes
are stored as hashes in Redis, expire after five minutes, and are consumed after one successful
verification. Requests for the same email are limited to once per minute, and five incorrect
attempts invalidate the current code.

Mailgun SMTP is supported with the following environment variables:

```dotenv
mail__transport=SMTP
mail__options__host=smtp.mailgun.org
mail__options__port=465
mail__options__secure=true
mail__options__auth__user=smtp-user@example.com
mail__options__auth__pass=replace-with-mailgun-smtp-password
mail__from="Codex Switch <noreply@example.com>"
```

The same SMTP configuration is exposed as the read-only default sending service. Administrators
can add multiple custom SMTP services under **Email Settings**, select a service for each automatic
notification template, and choose a service when manually replying to feedback. Custom SMTP
passwords are encrypted at rest using an AES-256-GCM key derived from `KONG_JWT_SECRET` and are
never returned by the API. Changing `KONG_JWT_SECRET` makes previously stored SMTP passwords
unreadable, so update or recreate those services after an intentional secret rotation.

Only newly created official-account bindings trigger a notification; submitting an existing
binding again does not resend email.

The registration client first calls `POST /auth/register/code` with the email address, then sends
the received code as `verificationCode` when calling `POST /auth/register`.

## Credential and Official Account Handling

Desktop synchronization uploads complete account `auth` payloads and Provider API keys. The backend stores them in PostgreSQL so server access, database backups, admin access, and operational tooling are part of the credential trust boundary. Use HTTPS at the public gateway, restrict PostgreSQL and Redis to private networks, and never copy production payloads into logs or test fixtures.

The mobile client uses `GET /sync/accounts/summary`, which removes `auth` from every account. It reads the latest data synchronized by a desktop client and does not contact Codex APIs itself.

Admins can add credentials to the official account pool and bind one or more pool entries to users. The admin console accepts a selected file or pasted content for both standard `auth.json` and compatible imports. Compatible import supports a single object, an array, an `accounts` wrapper, newline-delimited JSON, common token aliases, and nested session exports. Bound entries are merged into the user's effective `/sync/accounts` list. A bound official entry wins over a personal entry with the same stable sync ID; user-side updates and deletes do not modify the official copy. Edit, unbind, or delete those entries through the official-account admin APIs. All pool mutations and binding changes are written to the admin audit log.

The admin console can also add an official account through Codex OAuth. It uses the official device authorization flow because the Codex CLI browser flow only permits its localhost callback ports. The one-time OAuth session is scoped to the authenticated administrator, stored in Redis for 15 minutes, and never exposes exchanged tokens to the browser. Keep `CODEX_OAUTH_ISSUER` at its default unless you operate a compatible trusted authorization service.

## RBAC

Every management and synchronization endpoint is protected by an explicit permission in addition to JWT authentication. Roles and role-permission assignments are stored in PostgreSQL and permissions are derived from the user's current database role on every request, so changing or disabling a user takes effect without trusting stale role claims from an access token.

The built-in `user` role provides self-service access and can be edited without being deleted. The protected `admin` role receives every built-in and custom permission. Administrators can create additional roles, create or edit custom permission definitions for external systems, and assign permissions with the searchable multi-select on the **Roles & Permissions** page. Core `admin.*` and `self.*` definitions remain application-owned and read-only because each one corresponds to an enforced backend capability; custom permission codes are immutable after creation so integrations can safely persist them.

Ordinary users can sign in to `/admin`, see only the **My Accounts** page, open their profile, and change their own password. `GET /admin/api/profile/accounts` returns account display data without any `auth` credentials. Menu filtering is only a user-interface aid; backend permission guards remain authoritative.

The public `/admin/reset-password` page resets a forgotten password with a single-use six-digit email code that expires after five minutes. A successful reset revokes all active refresh tokens for that user. The code request response does not reveal whether the supplied email belongs to an account.

Invitations can optionally target one email, allow a configurable number of successful
registrations, and either expire after a configured number of hours or remain valid until their
usage limit is reached or an administrator revokes them. Invitation usage is counted atomically
with user creation so concurrent registrations cannot exceed the configured limit.
Invitation links can be copied again from the invitation list without storing raw tokens. Legacy
tokens remain valid when a signed link is copied for an invitation created by an older version.

## API

- `POST /auth/register`
- `POST /auth/register/code`
- `POST /auth/password-reset/code`
- `POST /auth/password-reset`
- `POST /auth/login`
- `POST /auth/refresh`
- `POST /auth/logout`
- `GET /auth/me`
- `POST /feedback`
- `POST /feedback/authenticated`
- `GET /announcements/current`
- `POST /announcements/clicks`
- `POST /announcements/clicks/authenticated`
- `GET /notifications/recent`
- `GET /faqs`
- `GET /currency-rates`
- `POST /telemetry/installations`
- `WS /device-switch`
- `WS /device-chat`
- `GET /devices`
- `POST /devices/:deviceId/account`
- `GET /sync/accounts`
- `GET /sync/accounts/summary`
- `PUT /sync/accounts`
- `PUT /sync/accounts/:id`
- `DELETE /sync/accounts/:id`
- `GET /sync/providers`
- `PUT /sync/providers`
- `PUT /sync/providers/:id`
- `DELETE /sync/providers/:id`
- `GET /sync/totp`
- `PUT /sync/totp`

Account deletion is soft: the synchronized row is retained with `deletedAt`, omitted from active
account views, and returned by `GET /sync/accounts` through `deletedAccountIds` so other desktop
devices can remove their local copy.

Provider deletion uses the same tombstone model. Deleted providers are omitted from active views
and returned through `deletedProviderIds`. Provider fields carry independent modification times so
changes made to different fields on different devices merge without overwriting one another. New
desktop-created providers use UUID v4 identifiers; existing identifiers remain valid for backward
compatibility.

2FA key synchronization is independent from account and Provider synchronization and remains off
by default in the desktop app. When enabled, the complete TOTP vault is stored in PostgreSQL and
resolved using the latest vault modification time.

- `GET /admin`
- `GET /admin/reset-password`
- `GET /admin/api/users`
- `POST /admin/api/users`
- `PATCH /admin/api/users/:id`
- `DELETE /admin/api/users/:id`
- `PATCH /admin/api/profile/password`
- `GET /admin/api/profile/accounts`
- `GET /admin/api/profile/accounts/deleted`
- `POST /admin/api/profile/accounts/deleted/:accountId/restore`
- `GET /admin/api/profile/providers/deleted`
- `POST /admin/api/profile/providers/deleted/:providerId/restore`
- `GET /admin/api/users/:id/accounts`
- `POST /admin/api/users/:id/accounts/:accountId/add-to-pool`
- `GET /admin/api/users/:id/providers`
- `PATCH /admin/api/users/:id/accounts/:accountId`
- `DELETE /admin/api/users/:id/accounts/:accountId`
- `GET /admin/api/official-accounts`
- `POST /admin/api/official-accounts`
- `POST /admin/api/official-accounts/import`
- `POST /admin/api/official-accounts/oauth/start`
- `POST /admin/api/official-accounts/oauth/:sessionId/poll`
- `PATCH /admin/api/official-accounts/:id`
- `DELETE /admin/api/official-accounts/:id`
- `GET /admin/api/faqs`
- `POST /admin/api/faqs`
- `PATCH /admin/api/faqs/:id`
- `DELETE /admin/api/faqs/:id`
- `GET /admin/api/official-accounts/:id/bindings`
- `POST /admin/api/official-accounts/bind`
- `POST /admin/api/official-accounts/unbind`
- `GET /admin/api/audit-logs`
- `GET /admin/api/invitations`
- `GET /admin/api/invitations/:id/users`
- `POST /admin/api/invitations`
- `POST /admin/api/invitations/:id/token`
- `DELETE /admin/api/invitations/:id`
- `GET /admin/api/approvals`
- `POST /admin/api/approvals`
- `POST /admin/api/approvals/:id/review`
- `GET /admin/api/feedback`
- `GET /admin/api/feedback/:id`
- `GET /admin/api/feedback/:id/attachments/:attachmentId`
- `POST /admin/api/feedback/:id/email`
- `GET /admin/api/announcement`
- `PATCH /admin/api/announcement`
- `GET /admin/api/currency`
- `PATCH /admin/api/currency`
- `GET /admin/api/announcement/clicks/overview`
- `GET /admin/api/announcement/clicks`
- `GET /admin/api/email-templates`
- `GET /admin/api/email-templates/:code`
- `PATCH /admin/api/email-templates/:code`
- `GET /admin/api/mail-services`
- `POST /admin/api/mail-services`
- `PATCH /admin/api/mail-services/:id`
- `DELETE /admin/api/mail-services/:id`
- `GET /admin/api/telemetry/overview`
- `GET /admin/api/telemetry/installations`
- `GET /admin/api/telemetry/events`

Kong JWT plugin validation uses the access token `iss` claim. Keep `KONG_JWT_KEY` and `KONG_JWT_SECRET` aligned with the JWT credential in your existing Kong.
