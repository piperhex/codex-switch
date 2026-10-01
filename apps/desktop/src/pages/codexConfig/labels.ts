import { guiText } from "../../i18n/guiText";
const FIELD_LABELS: Record<string, string> = {
  get model() { return guiText("默认模型"); }, get model_provider() { return guiText("模型服务商"); }, get review_model() { return guiText("审查模型"); },
  get model_reasoning_effort() { return guiText("思考深度"); }, get plan_mode_reasoning_effort() { return guiText("规划时的思考深度"); },
  get model_reasoning_summary() { return guiText("思考摘要"); }, get model_verbosity() { return guiText("回答详细程度"); }, get personality() { return guiText("回答风格"); },
  get model_context_window() { return guiText("上下文容量"); }, get model_auto_compact_token_limit() { return guiText("自动压缩阈值"); },
  get model_auto_compact_token_limit_scope() { return guiText("压缩阈值范围"); }, get model_instructions_file() { return guiText("模型指令文件"); },
  get model_catalog_json() { return guiText("自定义模型列表"); }, get model_providers() { return guiText("模型服务商配置"); }, get service_tier() { return guiText("服务速度"); },
  get profile() { return guiText("当前配置方案"); }, get profiles() { return guiText("配置方案"); }, get approval_policy() { return guiText("操作确认方式"); },
  get approvals_reviewer() { return guiText("操作审核方式"); }, get auto_review() { return guiText("自动审核"); }, get sandbox_mode() { return guiText("文件与网络权限"); },
  get sandbox_workspace_write() { return guiText("工作区访问权限"); }, get permissions() { return guiText("权限方案"); }, get default_permissions() { return guiText("默认权限方案"); },
  get projects() { return guiText("项目设置"); }, get shell_environment_policy() { return guiText("终端环境"); }, get allow_login_shell() { return guiText("允许登录终端"); },
  get allow_symlinked_codex_home() { return guiText("允许配置目录符号链接"); }, get forced_login_method() { return guiText("指定登录方式"); },
  get forced_chatgpt_workspace_id() { return guiText("限定工作空间"); }, get cli_auth_credentials_store() { return guiText("登录凭据保存方式"); },
  get mcp_oauth_credentials_store() { return guiText("MCP 凭据保存方式"); }, get mcp_oauth_callback_port() { return guiText("MCP 授权回调端口"); },
  get mcp_oauth_callback_url() { return guiText("MCP 授权回调地址"); }, get mcp_optional_startup_grace_ms() { return guiText("可选 MCP 启动等待时间"); },
  get mcp_servers() { return guiText("MCP 服务"); }, get apps() { return guiText("应用连接"); }, get plugins() { return guiText("插件"); }, get skills() { return guiText("技能"); }, get tools() { return guiText("工具设置"); },
  get tool_suggest() { return guiText("工具推荐"); }, get marketplaces() { return guiText("插件市场"); }, get features() { return guiText("功能开关"); }, get agents() { return guiText("多智能体"); },
  get orchestrator() { return guiText("任务协调"); }, get goals() { return guiText("目标任务"); }, get memories() { return guiText("记忆"); }, get history() { return guiText("历史记录"); }, get hooks() { return guiText("自动操作"); },
  get browser_use() { return guiText("浏览器"); }, get computer_use() { return guiText("电脑操作"); }, get web_search() { return guiText("联网搜索"); }, get notify() { return guiText("通知命令"); },
  get tui() { return guiText("终端界面"); }, get desktop() { return guiText("桌面应用"); }, get audio() { return guiText("音频设备"); }, get realtime() { return guiText("实时语音"); }, windows: "Windows",
  get analytics() { return guiText("使用情况统计"); }, get feedback() { return guiText("反馈"); }, get notice() { return guiText("提醒"); }, get file_opener() { return guiText("文件打开方式"); },
  get instructions() { return guiText("个人指令"); }, get developer_instructions() { return guiText("开发者指令"); }, get compact_prompt() { return guiText("压缩提示词"); },
  get experimental_compact_prompt_file() { return guiText("压缩提示词文件"); }, get project_doc_max_bytes() { return guiText("项目说明最大长度"); },
  get project_doc_fallback_filenames() { return guiText("备用项目说明文件"); }, get project_root_markers() { return guiText("项目根目录标记"); },
  get include_apps_instructions() { return guiText("附加应用使用说明"); }, get include_collaboration_mode_instructions() { return guiText("附加协作说明"); },
  get include_environment_context() { return guiText("附加工作环境信息"); }, get include_permissions_instructions() { return guiText("附加权限说明"); },
  get hide_agent_reasoning() { return guiText("隐藏思考过程"); }, get show_raw_agent_reasoning() { return guiText("显示完整思考过程"); },
  get check_for_update_on_startup() { return guiText("启动时检查更新"); }, get disable_paste_burst() { return guiText("关闭快速粘贴识别"); },
  get suppress_unstable_features_warning() { return guiText("隐藏开发中功能提醒"); }, get background_terminal_max_timeout() { return guiText("后台终端等待上限"); },
  get thread_unload_delay_secs() { return guiText("空闲会话保留时间"); }, get tool_output_token_limit() { return guiText("工具输出长度上限"); },
  get log_dir() { return guiText("日志目录"); }, get sqlite_home() { return guiText("会话数据目录"); }, get ghost_snapshot() { return guiText("工作区快照"); }, get otel() { return guiText("运行诊断"); },
  get chatgpt_base_url() { return guiText("ChatGPT 服务地址"); }, get openai_base_url() { return guiText("OpenAI 服务地址"); }, get oss_provider() { return guiText("本地模型服务商"); },
  get responses_api_metadata() { return guiText("请求附加信息"); }, get apps_mcp_product_sku() { return guiText("应用产品标识"); },
  get experimental_realtime_start_instructions() { return guiText("实时语音初始指令"); },
  get experimental_realtime_webrtc_call_base_url() { return guiText("实时通话地址"); },
  get experimental_realtime_ws_backend_prompt() { return guiText("实时语音后端指令"); },
  get experimental_realtime_ws_base_url() { return guiText("实时语音连接地址"); }, get experimental_realtime_ws_model() { return guiText("实时语音模型"); },
  get experimental_realtime_ws_startup_context() { return guiText("实时语音初始上下文"); }, get experimental_thread_store() { return guiText("会话存储方式"); },
  get experimental_use_unified_exec_tool() { return guiText("统一终端工具"); },
  get enabled() { return guiText("启用"); }, get disabled() { return guiText("禁用"); }, get name() { return guiText("名称"); }, get description() { return guiText("说明"); }, get path() { return guiText("路径"); }, get url() { return guiText("地址"); },
  get command() { return guiText("启动命令"); }, get args() { return guiText("启动参数"); }, get cwd() { return guiText("工作目录"); }, get env() { return guiText("环境变量"); }, get env_vars() { return guiText("环境变量列表"); },
  get config_file() { return guiText("配置文件"); }, get config() { return guiText("配置列表"); }, get base_url() { return guiText("服务地址"); }, get env_key() { return guiText("密钥环境变量"); },
  get env_key_instructions() { return guiText("密钥设置说明"); }, get api_key() { return guiText("API 密钥"); }, get experimental_bearer_token() { return guiText("访问令牌"); },
  get bearer_token() { return guiText("访问令牌"); }, get bearer_token_env_var() { return guiText("令牌环境变量"); }, get auth() { return guiText("身份验证"); },
  get auth_token() { return guiText("验证令牌"); }, get auth_method() { return guiText("验证方式"); }, get http_headers() { return guiText("请求头"); }, get env_http_headers() { return guiText("请求头环境变量"); },
  get http_headers_helper() { return guiText("请求头生成命令"); }, get wire_api() { return guiText("接口类型"); }, get requires_openai_auth() { return guiText("使用 OpenAI 登录验证"); },
  get query_params() { return guiText("请求参数"); }, get request_max_retries() { return guiText("请求重试次数"); }, get stream_max_retries() { return guiText("响应重试次数"); },
  get stream_idle_timeout_ms() { return guiText("响应空闲超时"); }, get supports_websockets() { return guiText("支持实时连接"); },
  get websocket_connect_timeout_ms() { return guiText("实时连接超时"); }, get supports_parallel_tool_calls() { return guiText("支持并行工具调用"); },
  get supports_reasoning_summaries() { return guiText("支持思考摘要"); }, get startup_timeout_ms() { return guiText("启动超时（毫秒）"); },
  get startup_timeout_sec() { return guiText("启动超时（秒）"); }, get tool_timeout_sec() { return guiText("工具超时（秒）"); }, get required() { return guiText("必须启动成功"); },
  get enabled_tools() { return guiText("允许使用的工具"); }, get disabled_tools() { return guiText("停用的工具"); }, get oauth() { return guiText("授权登录"); }, get scopes() { return guiText("授权范围"); },
  get oauth_resource() { return guiText("授权资源地址"); }, get omit_tools_from() { return guiText("隐藏工具的使用场景"); }, get environment_id() { return guiText("运行环境标识"); },
  get default_tools_approval_mode() { return guiText("默认工具确认方式"); }, get approval_mode() { return guiText("确认方式"); }, get timeout_ms() { return guiText("超时（毫秒）"); },
  get timeout_sec() { return guiText("超时（秒）"); }, get max_threads() { return guiText("最大并行数"); }, get max_depth() { return guiText("最大协作层数"); },
  get max_concurrent_threads_per_session() { return guiText("每个任务的最大智能体数"); }, get default_subagent_model() { return guiText("默认智能体模型"); },
  get default_subagent_reasoning_effort() { return guiText("默认智能体思考深度"); }, get interrupt_message() { return guiText("记录任务中断"); },
  get nickname_candidates() { return guiText("候选昵称"); }, get network_access() { return guiText("允许网络访问"); }, get writable_roots() { return guiText("允许写入的目录"); },
  get exclude_tmpdir_env_var() { return guiText("排除临时目录环境变量"); }, get exclude_slash_tmp() { return guiText("排除系统临时目录"); },
  get trust_level() { return guiText("项目信任级别"); }, get inherit() { return guiText("继承环境变量"); }, get exclude() { return guiText("排除的变量"); },
  get include_only() { return guiText("仅包含的变量"); }, get set() { return guiText("自定义变量"); }, get ignore_default_excludes() { return guiText("保留默认排除项"); },
  get experimental_use_profile() { return guiText("加载终端个人配置"); }, get persistence() { return guiText("记录保存方式"); }, get max_bytes() { return guiText("存储大小上限"); },
  get animations() { return guiText("动画效果"); }, get notifications() { return guiText("通知"); }, get notification_method() { return guiText("通知方式"); }, get status_line() { return guiText("状态栏内容"); },
  get alternate_screen() { return guiText("终端独立屏幕"); }, get show_tooltips() { return guiText("显示提示"); }, get scroll_events_per_tick() { return guiText("滚动速度"); },
  get theme() { return guiText("主题"); }, get keymap() { return guiText("快捷键"); }, get footer() { return guiText("底部信息"); }, get voice() { return guiText("语音音色"); }, get microphone() { return guiText("麦克风"); },
  get speaker() { return guiText("扬声器"); }, get input_device() { return guiText("输入设备"); }, get output_device() { return guiText("输出设备"); }, get transport() { return guiText("连接方式"); },
  get version() { return guiText("版本"); }, get mode() { return guiText("模式"); }, get type() { return guiText("类型"); }, get backend() { return guiText("服务类型"); }, get sandbox() { return guiText("沙箱"); },
  get read() { return guiText("读取"); }, get write() { return guiText("写入"); }, get access() { return guiText("访问权限"); }, get filesystem() { return guiText("文件权限"); }, get network() { return guiText("网络权限"); },
  get allow() { return guiText("允许"); }, get deny() { return guiText("禁止"); }, get enabled_for() { return guiText("启用范围"); }, get domains() { return guiText("域名"); }, get allowed_domains() { return guiText("允许的域名"); },
  get denied_domains() { return guiText("禁止的域名"); }, get proxy_url() { return guiText("代理地址"); }, get socks_url() { return guiText("SOCKS 代理地址"); },
  get allow_local_binding() { return guiText("允许本地监听"); }, get allow_all_unix_sockets() { return guiText("允许所有本地套接字"); },
  get unsafe_allow_all_unix_sockets() { return guiText("允许所有本地套接字"); }, get allowed_unix_sockets() { return guiText("允许的本地套接字"); },
  get granular() { return guiText("按操作类型设置"); }, get sandbox_approval() { return guiText("权限提升请求"); }, get rules() { return guiText("规则"); }, get skill_approval() { return guiText("技能请求"); },
  get mcp_elicitations() { return guiText("MCP 交互请求"); }, get request_permissions() { return guiText("额外权限请求"); }, get instructions_file() { return guiText("指令文件"); },
  get max_file_size() { return guiText("最大文件大小"); }, get max_files() { return guiText("最多文件数量"); }, get exclude_patterns() { return guiText("排除规则"); },
  get generate_memories() { return guiText("生成记忆"); }, get use_memories() { return guiText("使用记忆"); }, get max_raw_memories_for_consolidation() { return guiText("记忆整理数量"); },
  get max_rollout_age_days() { return guiText("历史记录最长保留天数"); }, get min_rollout_idle_hours() { return guiText("整理前的空闲小时数"); },
  get max_unused_days() { return guiText("未使用记忆的保留天数"); }, get consolidation_model() { return guiText("记忆整理模型"); }, get extraction_model() { return guiText("记忆提取模型"); },
  get image_generation() { return guiText("图像生成"); }, get multi_agent() { return guiText("多智能体协作"); }, get multi_agent_v2() { return guiText("新版多智能体协作"); },
  get browser_use_external() { return guiText("外部浏览器"); }, get in_app_browser() { return guiText("内置浏览器"); }, get in_app_chat() { return guiText("内置聊天"); },
  get in_app_dictation() { return guiText("语音输入"); }, get in_app_local_automation() { return guiText("本地自动任务"); }, get in_app_updates() { return guiText("应用更新"); },
  get fast_mode() { return guiText("快速模式"); }, get prevent_idle_sleep() { return guiText("运行时保持唤醒"); }, get respect_system_proxy() { return guiText("使用系统代理"); },
  get web_search_cached() { return guiText("缓存搜索"); }, get web_search_request() { return guiText("在线搜索请求"); }, get shell_tool() { return guiText("终端工具"); },
  get unified_exec() { return guiText("统一终端执行"); }, get apply_patch_freeform() { return guiText("自由格式补丁"); }, get remote_models() { return guiText("远程模型"); },
  get code_mode() { return guiText("代码执行模式"); }, get tool_search() { return guiText("工具搜索"); }, get tool_registry() { return guiText("工具注册表"); }, get view_image() { return guiText("查看图片"); },
  get memory_tool() { return guiText("记忆工具"); }, get skill_search() { return guiText("技能搜索"); }, get worktrees() { return guiText("独立工作目录"); }, get undo() { return guiText("撤销"); },
  get remote_control() { return guiText("远程控制"); }, get remote_plugin() { return guiText("远程插件"); }, get plugin_hooks() { return guiText("插件自动操作"); }, get plugin_sharing() { return guiText("插件共享"); },
  get current_time_reminder() { return guiText("时间提醒"); }, get context_management() { return guiText("上下文管理"); }, get token_budget() { return guiText("Token 预算"); },
  get rollout_budget() { return guiText("任务预算"); }, get sleep_tool() { return guiText("等待工具"); }, get search_tool() { return guiText("搜索工具"); }, get network_proxy() { return guiText("网络代理"); },
  get guardianv2() { return guiText("新版自动审核"); }, get approvals() { return guiText("操作审核"); }, get require_approval() { return guiText("需要确认"); }, get default() { return guiText("默认设置"); },
};

const FIELD_HELP: Record<string, string> = {
  get model() { return guiText("选择新任务默认使用的模型，也可输入自定义模型名称。"); },
  get model_provider() { return guiText("选择模型服务商，也可输入其他已配置的服务商名称。"); },
  get model_reasoning_effort() { return guiText("提高思考深度通常需要更多时间。"); }, get model_verbosity() { return guiText("控制回答的篇幅和细节。"); },
  get profile() { return guiText("填写下方配置方案中的名称。"); }, get profiles() { return guiText("为不同工作场景保存独立的模型与权限设置。"); },
  get model_providers() { return guiText("管理服务地址、身份验证和请求设置。"); }, get mcp_servers() { return guiText("连接本地或远程 MCP 工具。"); },
  get approval_policy() { return guiText("选择执行操作前如何向你确认。"); }, get sandbox_mode() { return guiText("控制 Codex 可以访问的文件和网络。"); },
  get features() { return guiText("按需开启功能；保持默认时由 Codex 决定。"); }, get desktop() { return guiText("管理桌面应用保存的设置。"); },
  get projects() { return guiText("为指定项目设置权限与偏好。"); }, get agents() { return guiText("管理智能体角色、模型和并行任务数量。"); },
  get instructions() { return guiText("告诉 Codex 你的工作习惯与回答偏好。"); }, get developer_instructions() { return guiText("为任务补充统一的工作要求。"); },
  get service_tier() { return guiText("可填写 default、priority 或 flex。"); }, get model_context_window() { return guiText("以 Token 为单位设置上下文容量。"); },
  get model_auto_compact_token_limit() { return guiText("上下文达到此 Token 数量后进行压缩。"); },
  get web_search() { return guiText("选择使用缓存结果、实时搜索或关闭联网搜索。"); },
  get permissions() { return guiText("为不同工作场景组合文件与网络访问权限。"); },
  get history() { return guiText("选择是否保存终端历史及存储空间上限。"); }, get shell_environment_policy() { return guiText("控制终端继承和使用的环境变量。"); },
  get hooks() { return guiText("在指定事件发生时运行预设操作。"); }, get notify() { return guiText("通知触发时运行的命令及参数。"); },
  get memories() { return guiText("调整跨任务记忆的生成、使用与保留时间。"); }, get tui() { return guiText("调整终端中的外观、通知和快捷键。"); },
  get marketplaces() { return guiText("添加或管理插件来源。"); }, get plugins() { return guiText("调整已安装插件的启用状态与工具。"); },
};

export const TYPE_LABELS: Record<string, string> = {
  get string() { return guiText("文本"); }, get integer() { return guiText("整数"); }, get number() { return guiText("数字"); }, get boolean() { return guiText("开关"); }, get array() { return guiText("列表"); }, get object() { return guiText("详细设置"); },
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
  get none() { return guiText("不使用"); }, get minimal() { return guiText("最低"); }, get low() { return guiText("低"); }, get medium() { return guiText("中"); }, get high() { return guiText("高"); }, get xhigh() { return guiText("很高"); }, get max() { return guiText("最高"); },
  get ultra() { return guiText("极高"); }, get auto() { return guiText("自动"); }, get concise() { return guiText("简洁"); }, get detailed() { return guiText("详细"); }, get friendly() { return guiText("友好"); }, get pragmatic() { return guiText("务实"); },
  get "on-request"() { return guiText("按需确认"); }, get never() { return guiText("从不询问"); }, get "on-failure"() { return guiText("失败时确认"); }, get untrusted() { return guiText("不信任"); },
  get "read-only"() { return guiText("仅可读取"); }, get "workspace-write"() { return guiText("可写入工作区"); }, get "danger-full-access"() { return guiText("完全访问"); },
  get disabled() { return guiText("关闭"); }, get enabled() { return guiText("开启"); }, get cached() { return guiText("缓存搜索"); }, get live() { return guiText("实时搜索"); }, get indexed() { return guiText("索引搜索"); },
  get default() { return guiText("默认"); }, get priority() { return guiText("优先"); }, get flex() { return guiText("弹性"); }, get file() { return guiText("文件"); }, get keyring() { return guiText("系统密钥库"); },
  get ephemeral() { return guiText("仅本次运行"); }, get chatgpt() { return guiText("ChatGPT 登录"); }, get apikey() { return guiText("API 密钥"); }, get trusted() { return guiText("信任"); },
  get user() { return guiText("由我审核"); }, get auto_review() { return guiText("自动审核"); }, get allow() { return guiText("允许"); }, get deny() { return guiText("禁止"); }, get always() { return guiText("始终"); },
  get "save-all"() { return guiText("保存全部"); }, get all() { return guiText("全部"); }, get core() { return guiText("基本"); }, get experimental() { return guiText("实验功能"); }, get plain() { return guiText("纯文本"); },
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
  { key: "model", get label() { return guiText("模型与回答"); }, get description() { return guiText("选择模型，调整思考深度、回答风格与上下文。"); },
    fields: ["model", "model_provider", "model_reasoning_effort", "model_verbosity", "personality", "service_tier",
      "review_model", "plan_mode_reasoning_effort", "model_reasoning_summary", "model_context_window",
      "model_auto_compact_token_limit", "model_auto_compact_token_limit_scope", "model_catalog_json",
      "model_instructions_file", "profile", "profiles", "oss_provider"] },
  { key: "permissions", get label() { return guiText("权限与安全"); }, get description() { return guiText("控制操作确认、文件访问与项目权限。"); },
    fields: ["approval_policy", "approvals_reviewer", "auto_review", "sandbox_mode", "sandbox_workspace_write",
      "default_permissions", "permissions", "projects", "shell_environment_policy", "allow_login_shell",
      "allow_symlinked_codex_home", "forced_login_method", "forced_chatgpt_workspace_id",
      "cli_auth_credentials_store", "windows"] },
  { key: "connections", get label() { return guiText("服务与扩展"); }, get description() { return guiText("管理模型服务商、MCP、应用、插件与技能。"); },
    fields: ["model_providers", "mcp_servers", "apps", "plugins", "skills", "marketplaces",
      "mcp_oauth_credentials_store", "mcp_oauth_callback_port", "mcp_oauth_callback_url",
      "mcp_optional_startup_grace_ms", "openai_base_url", "chatgpt_base_url", "apps_mcp_product_sku"] },
  { key: "tools", get label() { return guiText("工具与智能体"); }, get description() { return guiText("设置联网搜索、电脑操作和多智能体协作。"); },
    fields: ["web_search", "tools", "agents", "goals", "browser_use", "computer_use", "orchestrator",
      "tool_suggest", "hooks", "tool_output_token_limit", "background_terminal_max_timeout"] },
  { key: "behavior", get label() { return guiText("指令与记忆"); }, get description() { return guiText("定义工作习惯，管理项目说明、历史与记忆。"); },
    fields: ["instructions", "developer_instructions", "compact_prompt", "experimental_compact_prompt_file",
      "memories", "history", "project_doc_max_bytes", "project_doc_fallback_filenames", "project_root_markers",
      "include_apps_instructions", "include_collaboration_mode_instructions", "include_environment_context",
      "include_permissions_instructions", "ghost_snapshot"] },
  { key: "interface", get label() { return guiText("界面与通知"); }, get description() { return guiText("调整桌面、终端、音频和通知偏好。"); },
    fields: ["desktop", "tui", "notify", "audio", "realtime", "file_opener", "hide_agent_reasoning",
      "show_raw_agent_reasoning", "check_for_update_on_startup", "disable_paste_burst", "notice", "feedback"] },
  { key: "advanced", get label() { return guiText("高级设置"); }, get description() { return guiText("管理功能开关、诊断与其他配置。"); }, fields: [] as string[] },
];

export function categoryFor(key: string): string {
  return CONFIG_CATEGORIES.find((category) => category.fields.includes(key))?.key ?? "advanced";
}
