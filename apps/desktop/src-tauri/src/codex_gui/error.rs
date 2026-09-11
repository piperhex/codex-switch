#[derive(Debug, thiserror::Error)]
pub(super) enum GuiError {
    #[error("文件暂时无法添加，请确认单个文件不超过 2 MB 后重试。")]
    Attachment,
    #[error("暂时无法读取当前项目文件，请确认项目仍可访问。")]
    ProjectFiles,
    #[error("图片暂时无法显示，请确认文件仍在当前任务目录中。")]
    ImagePreview,
    #[error("对话仍在回复中，请等待结束后再删除。")]
    Busy,
    #[error("未能删除对话。请稍后重试；如有相关子对话，请在会话管理中一并选择后删除。")]
    Delete,
    #[error("请先下载 Codex，即可开始对话。")]
    Executable,
    #[error("请选择有效的本地文件夹。")]
    Directory,
    #[error("暂时无法准备对话，请稍后重试。")]
    Workspace,
    #[error("对话请求无效，请刷新后重试。")]
    InvalidRequest,
    #[error("Codex 已断开连接，请重新连接后继续。")]
    Disconnected,
    #[error("Codex 响应超时，请检查连接状态。")]
    Timeout,
    #[error("Codex 未能完成操作，请检查当前账户、模型和 Codex 配置。")]
    Rpc,
    #[error("Codex 暂时无法启动，请检查 Codex 配置后重试。")]
    Startup,
    #[error("暂时无法访问 GitHub，请检查网络后重试。")]
    Release,
    #[error("下载文件校验未通过，请重新下载。")]
    Integrity,
    #[error("Codex 安装未完成，请检查磁盘空间后重试。")]
    Install,
    #[error("Codex 正在下载，请稍候。")]
    Installing,
}

pub(super) type Result<T> = std::result::Result<T, GuiError>;
