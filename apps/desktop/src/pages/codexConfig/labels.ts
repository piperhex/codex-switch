const FIELD_LABELS: Record<string, string> = {
  model: "默认模型", model_provider: "模型服务商", review_model: "审查模型",
  model_reasoning_effort: "思考深度", plan_mode_reasoning_effort: "规划时的思考深度",
  model_reasoning_summary: "思考摘要", model_verbosity: "回答详细程度", personality: "回答风格",
  model_context_window: "上下文容量", model_auto_compact_token_limit: "自动压缩阈值",
  model_auto_compact_token_limit_scope: "压缩阈值范围", model_instructions_file: "模型指令文件",
  model_catalog_json: "自定义模型列表", model_providers: "模型服务商配置", service_tier: "服务速度",
  profile: "当前配置方案", profiles: "配置方案", approval_policy: "操作确认方式",
  approvals_reviewer: "操作审核方式", auto_review: "自动审核", sandbox_mode: "文件与网络权限",
  sandbox_workspace_write: "工作区访问权限", permissions: "权限方案", default_permissions: "默认权限方案",
  projects: "项目设置", shell_environment_policy: "终端环境", allow_login_shell: "允许登录终端",
  allow_symlinked_codex_home: "允许配置目录符号链接", forced_login_method: "指定登录方式",
  forced_chatgpt_workspace_id: "限定工作空间", cli_auth_credentials_store: "登录凭据保存方式",
  mcp_oauth_credentials_store: "MCP 凭据保存方式", mcp_oauth_callback_port: "MCP 授权回调端口",
  mcp_oauth_callback_url: "MCP 授权回调地址", mcp_optional_startup_grace_ms: "可选 MCP 启动等待时间",
  mcp_servers: "MCP 服务", apps: "应用连接", plugins: "插件", skills: "技能", tools: "工具设置",
  tool_suggest: "工具推荐", marketplaces: "插件市场", features: "功能开关", agents: "多智能体",
  orchestrator: "任务协调", goals: "目标任务", memories: "记忆", history: "历史记录", hooks: "自动操作",
  browser_use: "浏览器", computer_use: "电脑操作", web_search: "联网搜索", notify: "通知命令",
  tui: "终端界面", desktop: "桌面应用", audio: "音频设备", realtime: "实时语音", windows: "Windows",
  analytics: "使用情况统计", feedback: "反馈", notice: "提醒", file_opener: "文件打开方式",
  instructions: "个人指令", developer_instructions: "开发者指令", compact_prompt: "压缩提示词",
  experimental_compact_prompt_file: "压缩提示词文件", project_doc_max_bytes: "项目说明最大长度",
  project_doc_fallback_filenames: "备用项目说明文件", project_root_markers: "项目根目录标记",
  include_apps_instructions: "附加应用使用说明", include_collaboration_mode_instructions: "附加协作说明",
  include_environment_context: "附加工作环境信息", include_permissions_instructions: "附加权限说明",
  hide_agent_reasoning: "隐藏思考过程", show_raw_agent_reasoning: "显示完整思考过程",
  check_for_update_on_startup: "启动时检查更新", disable_paste_burst: "关闭快速粘贴识别",
  suppress_unstable_features_warning: "隐藏开发中功能提醒", background_terminal_max_timeout: "后台终端等待上限",
  thread_unload_delay_secs: "空闲会话保留时间", tool_output_token_limit: "工具输出长度上限",
  log_dir: "日志目录", sqlite_home: "会话数据目录", ghost_snapshot: "工作区快照", otel: "运行诊断",
  chatgpt_base_url: "ChatGPT 服务地址", openai_base_url: "OpenAI 服务地址", oss_provider: "本地模型服务商",
  responses_api_metadata: "请求附加信息", apps_mcp_product_sku: "应用产品标识",
  experimental_realtime_start_instructions: "实时语音初始指令",
  experimental_realtime_webrtc_call_base_url: "实时通话地址",
  experimental_realtime_ws_backend_prompt: "实时语音后端指令",
  experimental_realtime_ws_base_url: "实时语音连接地址", experimental_realtime_ws_model: "实时语音模型",
  experimental_realtime_ws_startup_context: "实时语音初始上下文", experimental_thread_store: "会话存储方式",
  experimental_use_unified_exec_tool: "统一终端工具",
  enabled: "启用", disabled: "禁用", name: "名称", description: "说明", path: "路径", url: "地址",
  command: "启动命令", args: "启动参数", cwd: "工作目录", env: "环境变量", env_vars: "环境变量列表",
  config_file: "配置文件", config: "配置列表", base_url: "服务地址", env_key: "密钥环境变量",
  env_key_instructions: "密钥设置说明", api_key: "API 密钥", experimental_bearer_token: "访问令牌",
  bearer_token: "访问令牌", bearer_token_env_var: "令牌环境变量", auth: "身份验证",
  auth_token: "验证令牌", auth_method: "验证方式", http_headers: "请求头", env_http_headers: "请求头环境变量",
  http_headers_helper: "请求头生成命令", wire_api: "接口类型", requires_openai_auth: "使用 OpenAI 登录验证",
  query_params: "请求参数", request_max_retries: "请求重试次数", stream_max_retries: "响应重试次数",
  stream_idle_timeout_ms: "响应空闲超时", supports_websockets: "支持实时连接",
  websocket_connect_timeout_ms: "实时连接超时", supports_parallel_tool_calls: "支持并行工具调用",
  supports_reasoning_summaries: "支持思考摘要", startup_timeout_ms: "启动超时（毫秒）",
  startup_timeout_sec: "启动超时（秒）", tool_timeout_sec: "工具超时（秒）", required: "必须启动成功",
  enabled_tools: "允许使用的工具", disabled_tools: "停用的工具", oauth: "授权登录", scopes: "授权范围",
  oauth_resource: "授权资源地址", omit_tools_from: "隐藏工具的使用场景", environment_id: "运行环境标识",
  default_tools_approval_mode: "默认工具确认方式", approval_mode: "确认方式", timeout_ms: "超时（毫秒）",
  timeout_sec: "超时（秒）", max_threads: "最大并行数", max_depth: "最大协作层数",
  max_concurrent_threads_per_session: "每个任务的最大智能体数", default_subagent_model: "默认智能体模型",
  default_subagent_reasoning_effort: "默认智能体思考深度", interrupt_message: "记录任务中断",
  nickname_candidates: "候选昵称", network_access: "允许网络访问", writable_roots: "允许写入的目录",
  exclude_tmpdir_env_var: "排除临时目录环境变量", exclude_slash_tmp: "排除系统临时目录",
  trust_level: "项目信任级别", inherit: "继承环境变量", exclude: "排除的变量",
  include_only: "仅包含的变量", set: "自定义变量", ignore_default_excludes: "保留默认排除项",
  experimental_use_profile: "加载终端个人配置", persistence: "记录保存方式", max_bytes: "存储大小上限",
  animations: "动画效果", notifications: "通知", notification_method: "通知方式", status_line: "状态栏内容",
  alternate_screen: "终端独立屏幕", show_tooltips: "显示提示", scroll_events_per_tick: "滚动速度",
  theme: "主题", keymap: "快捷键", footer: "底部信息", voice: "语音音色", microphone: "麦克风",
  speaker: "扬声器", input_device: "输入设备", output_device: "输出设备", transport: "连接方式",
  version: "版本", mode: "模式", type: "类型", backend: "服务类型", sandbox: "沙箱",
  read: "读取", write: "写入", access: "访问权限", filesystem: "文件权限", network: "网络权限",
  allow: "允许", deny: "禁止", enabled_for: "启用范围", domains: "域名", allowed_domains: "允许的域名",
  denied_domains: "禁止的域名", proxy_url: "代理地址", socks_url: "SOCKS 代理地址",
  allow_local_binding: "允许本地监听", allow_all_unix_sockets: "允许所有本地套接字",
  unsafe_allow_all_unix_sockets: "允许所有本地套接字", allowed_unix_sockets: "允许的本地套接字",
  granular: "按操作类型设置", sandbox_approval: "权限提升请求", rules: "规则", skill_approval: "技能请求",
  mcp_elicitations: "MCP 交互请求", request_permissions: "额外权限请求", instructions_file: "指令文件",
  max_file_size: "最大文件大小", max_files: "最多文件数量", exclude_patterns: "排除规则",
  generate_memories: "生成记忆", use_memories: "使用记忆", max_raw_memories_for_consolidation: "记忆整理数量",
  max_rollout_age_days: "历史记录最长保留天数", min_rollout_idle_hours: "整理前的空闲小时数",
  max_unused_days: "未使用记忆的保留天数", consolidation_model: "记忆整理模型", extraction_model: "记忆提取模型",
  image_generation: "图像生成", multi_agent: "多智能体协作", multi_agent_v2: "新版多智能体协作",
  browser_use_external: "外部浏览器", in_app_browser: "内置浏览器", in_app_chat: "内置聊天",
  in_app_dictation: "语音输入", in_app_local_automation: "本地自动任务", in_app_updates: "应用更新",
  fast_mode: "快速模式", prevent_idle_sleep: "运行时保持唤醒", respect_system_proxy: "使用系统代理",
  web_search_cached: "缓存搜索", web_search_request: "在线搜索请求", shell_tool: "终端工具",
  unified_exec: "统一终端执行", apply_patch_freeform: "自由格式补丁", remote_models: "远程模型",
  code_mode: "代码执行模式", tool_search: "工具搜索", tool_registry: "工具注册表", view_image: "查看图片",
  memory_tool: "记忆工具", skill_search: "技能搜索", worktrees: "独立工作目录", undo: "撤销",
  remote_control: "远程控制", remote_plugin: "远程插件", plugin_hooks: "插件自动操作", plugin_sharing: "插件共享",
  current_time_reminder: "时间提醒", context_management: "上下文管理", token_budget: "Token 预算",
  rollout_budget: "任务预算", sleep_tool: "等待工具", search_tool: "搜索工具", network_proxy: "网络代理",
  guardianv2: "新版自动审核", approvals: "操作审核", require_approval: "需要确认", default: "默认设置",
};

const FIELD_HELP: Record<string, string> = {
  model: "选择新任务默认使用的模型，也可输入自定义模型名称。",
  model_provider: "选择模型服务商，也可输入其他已配置的服务商名称。",
  model_reasoning_effort: "提高思考深度通常需要更多时间。", model_verbosity: "控制回答的篇幅和细节。",
  profile: "填写下方配置方案中的名称。", profiles: "为不同工作场景保存独立的模型与权限设置。",
  model_providers: "管理服务地址、身份验证和请求设置。", mcp_servers: "连接本地或远程 MCP 工具。",
  approval_policy: "选择执行操作前如何向你确认。", sandbox_mode: "控制 Codex 可以访问的文件和网络。",
  features: "按需开启功能；保持默认时由 Codex 决定。", desktop: "管理桌面应用保存的设置。",
  projects: "为指定项目设置权限与偏好。", agents: "管理智能体角色、模型和并行任务数量。",
  instructions: "告诉 Codex 你的工作习惯与回答偏好。", developer_instructions: "为任务补充统一的工作要求。",
  service_tier: "可填写 default、priority 或 flex。", model_context_window: "以 Token 为单位设置上下文容量。",
  model_auto_compact_token_limit: "上下文达到此 Token 数量后进行压缩。",
  web_search: "选择使用缓存结果、实时搜索或关闭联网搜索。",
  permissions: "为不同工作场景组合文件与网络访问权限。",
  history: "选择是否保存终端历史及存储空间上限。", shell_environment_policy: "控制终端继承和使用的环境变量。",
  hooks: "在指定事件发生时运行预设操作。", notify: "通知触发时运行的命令及参数。",
  memories: "调整跨任务记忆的生成、使用与保留时间。", tui: "调整终端中的外观、通知和快捷键。",
  marketplaces: "添加或管理插件来源。", plugins: "调整已安装插件的启用状态与工具。",
};

export const TYPE_LABELS: Record<string, string> = {
  string: "文本", integer: "整数", number: "数字", boolean: "开关", array: "列表", object: "详细设置",
};

export function stringSuggestions(key: string): string[] {
  if (key === "model") return [
    "gpt-6-astra", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna",
    "gpt-5.5", "gpt-5.4-mini", "gpt-5.3-codex-spark",
  ];
  if (key === "model_provider") return ["codex-switch-local", "openai"];
  if (key.endsWith("reasoning_effort")) return ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"];
  if (key === "service_tier") return ["default", "priority", "flex"];
  return [];
}

const OPTION_LABELS: Record<string, string> = {
  none: "不使用", minimal: "最低", low: "低", medium: "中", high: "高", xhigh: "很高", max: "最高",
  ultra: "极高", auto: "自动", concise: "简洁", detailed: "详细", friendly: "友好", pragmatic: "务实",
  "on-request": "按需确认", never: "从不询问", "on-failure": "失败时确认", untrusted: "不信任",
  "read-only": "仅可读取", "workspace-write": "可写入工作区", "danger-full-access": "完全访问",
  disabled: "关闭", enabled: "开启", cached: "缓存搜索", live: "实时搜索", indexed: "索引搜索",
  default: "默认", priority: "优先", flex: "弹性", file: "文件", keyring: "系统密钥库",
  ephemeral: "仅本次运行", chatgpt: "ChatGPT 登录", apikey: "API 密钥", trusted: "信任",
  user: "由我审核", auto_review: "自动审核", allow: "允许", deny: "禁止", always: "始终",
  "save-all": "保存全部", all: "全部", core: "基本", experimental: "实验功能", plain: "纯文本",
};

export function fieldLabel(key: string): string {
  return typeof FIELD_LABELS[key] === "string" ? FIELD_LABELS[key] : key;
}

export function fieldHelp(key: string): string | undefined {
  return typeof FIELD_HELP[key] === "string" ? FIELD_HELP[key] : undefined;
}

export function optionLabel(value: string): string {
  const label = OPTION_LABELS[value];
  return typeof label === "string" ? `${label} (${value})` : value;
}

export const CONFIG_CATEGORIES = [
  { key: "model", label: "模型与回答", description: "选择模型，调整思考深度、回答风格与上下文。",
    fields: ["model", "model_provider", "model_reasoning_effort", "model_verbosity", "personality", "service_tier",
      "review_model", "plan_mode_reasoning_effort", "model_reasoning_summary", "model_context_window",
      "model_auto_compact_token_limit", "model_auto_compact_token_limit_scope", "model_catalog_json",
      "model_instructions_file", "profile", "profiles", "oss_provider"] },
  { key: "permissions", label: "权限与安全", description: "控制操作确认、文件访问与项目权限。",
    fields: ["approval_policy", "approvals_reviewer", "auto_review", "sandbox_mode", "sandbox_workspace_write",
      "default_permissions", "permissions", "projects", "shell_environment_policy", "allow_login_shell",
      "allow_symlinked_codex_home", "forced_login_method", "forced_chatgpt_workspace_id",
      "cli_auth_credentials_store", "windows"] },
  { key: "connections", label: "服务与扩展", description: "管理模型服务商、MCP、应用、插件与技能。",
    fields: ["model_providers", "mcp_servers", "apps", "plugins", "skills", "marketplaces",
      "mcp_oauth_credentials_store", "mcp_oauth_callback_port", "mcp_oauth_callback_url",
      "mcp_optional_startup_grace_ms", "openai_base_url", "chatgpt_base_url", "apps_mcp_product_sku"] },
  { key: "tools", label: "工具与智能体", description: "设置联网搜索、电脑操作和多智能体协作。",
    fields: ["web_search", "tools", "agents", "goals", "browser_use", "computer_use", "orchestrator",
      "tool_suggest", "hooks", "tool_output_token_limit", "background_terminal_max_timeout"] },
  { key: "behavior", label: "指令与记忆", description: "定义工作习惯，管理项目说明、历史与记忆。",
    fields: ["instructions", "developer_instructions", "compact_prompt", "experimental_compact_prompt_file",
      "memories", "history", "project_doc_max_bytes", "project_doc_fallback_filenames", "project_root_markers",
      "include_apps_instructions", "include_collaboration_mode_instructions", "include_environment_context",
      "include_permissions_instructions", "ghost_snapshot"] },
  { key: "interface", label: "界面与通知", description: "调整桌面、终端、音频和通知偏好。",
    fields: ["desktop", "tui", "notify", "audio", "realtime", "file_opener", "hide_agent_reasoning",
      "show_raw_agent_reasoning", "check_for_update_on_startup", "disable_paste_burst", "notice", "feedback"] },
  { key: "advanced", label: "高级设置", description: "管理功能开关、诊断与其他配置。", fields: [] as string[] },
];

export function categoryFor(key: string): string {
  return CONFIG_CATEGORIES.find((category) => category.fields.includes(key))?.key ?? "advanced";
}
