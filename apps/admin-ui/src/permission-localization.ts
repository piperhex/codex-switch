import type { Language } from "./i18n";
import type { PermissionDefinition } from "./types";

type PermissionMetadata = Pick<PermissionDefinition, "group" | "name" | "description">;

const BUILT_IN_PERMISSION_ZH: Record<string, PermissionMetadata> = {
  "self.accounts.read": {
    group: "自助服务",
    name: "查看自己的账号",
    description: "查看分配给当前用户或由当前用户同步的账号。",
  },
  "self.accounts.write": {
    group: "自助服务",
    name: "管理自己的账号",
    description: "更新当前用户所拥有账号的元数据。",
  },
  "self.providers.read": {
    group: "自助服务",
    name: "查看自己的 Provider",
    description: "查看当前用户同步的 Provider。",
  },
  "self.providers.write": {
    group: "自助服务",
    name: "管理自己的 Provider",
    description: "新建、更新和删除当前用户所拥有的 Provider。",
  },
  "self.password.update": {
    group: "自助服务",
    name: "修改自己的密码",
    description: "修改当前用户的密码。",
  },
  "admin.users.read": {
    group: "用户管理",
    name: "查看用户",
    description: "查看用户资料和账号状态。",
  },
  "self.official-accounts.metadata.write": {
    group: "官方账号",
    name: "修改号池账号备注和到期时间",
    description: "修改分配给当前用户的号池账号备注和到期时间。",
  },
  "admin.users.manage": {
    group: "用户管理",
    name: "管理用户",
    description: "新建、更新、禁用和删除用户。",
  },
  "admin.roles.read": {
    group: "角色与权限",
    name: "查看角色",
    description: "查看角色和权限列表。",
  },
  "admin.roles.manage": {
    group: "角色与权限",
    name: "管理角色",
    description: "新建、更新和删除自定义角色。",
  },
  "admin.permissions.manage": {
    group: "角色与权限",
    name: "管理权限",
    description: "新建和编辑自定义权限定义。",
  },
  "admin.official-accounts.read": {
    group: "官方账号",
    name: "查看官方账号",
    description: "查看官方账号池及其绑定关系。",
  },
  "admin.official-accounts.read-own": {
    group: "官方账号",
    name: "仅查看自己录入的号池账号",
    description: "只能查看由当前用户录入官方号池的账号。",
  },
  "admin.official-accounts.manage-own": {
    group: "官方账号",
    name: "仅管理自己录入的号池账号",
    description: "可录入账号，并且只能编辑、删除及绑定由当前用户录入号池的账号。",
  },
  "admin.official-accounts.manage": {
    group: "官方账号",
    name: "管理官方账号",
    description: "新建、更新、删除和绑定官方账号。",
  },
  "admin.audit-logs.read": {
    group: "审计日志",
    name: "查看审计日志",
    description: "查看管理后台的审计事件。",
  },
  "admin.invitations.read": {
    group: "邀请注册",
    name: "查看邀请",
    description: "查看注册邀请。",
  },
  "admin.invitations.manage": {
    group: "邀请注册",
    name: "管理邀请",
    description: "创建和撤销注册邀请。",
  },
  "admin.approvals.read": {
    group: "管理员审批",
    name: "查看审批",
    description: "查看管理员审批申请。",
  },
  "admin.approvals.manage": {
    group: "管理员审批",
    name: "管理审批",
    description: "创建和审核管理员审批申请。",
  },
  "admin.announcements.read": {
    group: "内容与通知",
    name: "查看软件通知",
    description: "查看软件通知配置和链接点击统计。",
  },
  "admin.announcements.manage": {
    group: "内容与通知",
    name: "管理软件通知",
    description: "发布和更新软件通知。",
  },
  "admin.email-templates.read": {
    group: "内容与通知",
    name: "查看邮件模板",
    description: "查看通知邮件模板的内容和变量。",
  },
  "admin.email-templates.manage": {
    group: "内容与通知",
    name: "管理邮件模板",
    description: "自定义通知邮件的主题和内容。",
  },
  "admin.mail-services.read": {
    group: "内容与通知",
    name: "查看发件服务",
    description: "查看默认和自定义 SMTP 发件服务。",
  },
  "admin.mail-services.manage": {
    group: "内容与通知",
    name: "管理发件服务",
    description: "新建、更新和删除自定义 SMTP 发件服务。",
  },
  "admin.feedback.read": {
    group: "问题反馈",
    name: "查看问题反馈",
    description: "查看问题反馈及其附件。",
  },
  "admin.feedback.manage": {
    group: "问题反馈",
    name: "管理问题反馈",
    description: "回复用户的问题反馈。",
  },
  "admin.skills.read": {
    group: "社区 Skills",
    name: "查看社区 Skills",
    description: "查看用户发布的 Skills 及其下载数据。",
  },
  "admin.skills.manage": {
    group: "社区 Skills",
    name: "管理社区 Skills",
    description: "编辑或删除用户发布的 Skills。",
  },
  "admin.prompt-plugins.read": {
    group: "系统提示词",
    name: "查看系统提示词",
    description: "查看市场中发布的系统提示词。",
  },
  "admin.prompt-plugins.manage": {
    group: "系统提示词",
    name: "管理系统提示词",
    description: "编辑或删除市场中的系统提示词。",
  },
  "admin.telemetry.read": {
    group: "设备统计",
    name: "查看设备统计",
    description: "查看设备安装和遥测统计数据。",
  },
  "admin.dashboard.read": {
    group: "运营分析",
    name: "查看运营仪表盘",
    description: "查看跨系统的运营指标和趋势。",
  },
};

export function localizePermission(
  permission: PermissionDefinition,
  language: Language,
): PermissionDefinition {
  if (language !== "zh" || !permission.system) return permission;
  const metadata = BUILT_IN_PERMISSION_ZH[permission.code];
  return metadata ? { ...permission, ...metadata } : permission;
}
