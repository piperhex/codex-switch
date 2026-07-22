export interface EmailTemplateVariableDefinition {
  key: string;
  description: string;
  example: string;
}

export interface EmailTemplateDefinition {
  code: string;
  name: string;
  description: string;
  defaultSubject: string;
  defaultBody: string;
  variables: readonly EmailTemplateVariableDefinition[];
}

export const OFFICIAL_ACCOUNT_BOUND_TEMPLATE_CODE = 'official-account.bound';

export const EMAIL_TEMPLATE_REGISTRY: readonly EmailTemplateDefinition[] = [
  {
    code: OFFICIAL_ACCOUNT_BOUND_TEMPLATE_CODE,
    name: '官方账号绑定通知',
    description: '管理员赠送或绑定新的官方账号后发送给用户。',
    defaultSubject: '您已获得 {{accountCount}} 个 Codex 账号',
    defaultBody: `您好，{{userEmail}}：

管理员已为您绑定 {{accountCount}} 个 Codex 账号：
{{accountEmails}}

您现在可以登录 Codex Switch 查看并使用这些账号。

操作人：{{operatorEmail}}
绑定时间：{{boundAt}}

此邮件由系统自动发送，请勿直接回复。`,
    variables: [
      { key: 'userEmail', description: '接收通知的用户邮箱', example: 'user@example.com' },
      { key: 'accountCount', description: '本次新增绑定的账号数量', example: '2' },
      {
        key: 'accountEmails',
        description: '本次新增绑定的账号邮箱列表',
        example: '- first@example.com\n- second@example.com',
      },
      { key: 'operatorEmail', description: '执行绑定的管理员邮箱', example: 'admin@example.com' },
      { key: 'boundAt', description: '绑定完成时间', example: '2026-07-22 10:30 (Asia/Singapore)' },
    ],
  },
] as const;

export function findEmailTemplateDefinition(code: string) {
  return EMAIL_TEMPLATE_REGISTRY.find((definition) => definition.code === code);
}
