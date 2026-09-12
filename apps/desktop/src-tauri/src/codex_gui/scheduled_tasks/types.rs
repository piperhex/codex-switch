use serde::{Deserialize, Serialize};

#[derive(Debug, thiserror::Error)]
pub(crate) enum TaskError {
    #[error("暂时无法读取或保存定时任务，请稍后重试。")]
    Storage,
    #[error("任务内容或时间有误，请检查后重试。")]
    Invalid,
    #[error("找不到这个任务，请刷新后重试。")]
    NotFound,
    #[error("任务正在执行，请完成后再修改。")]
    Busy,
    #[error("任务未能执行，请确认 Codex 可用后重试。")]
    Execution,
}

pub(super) type Result<T> = std::result::Result<T, TaskError>;

/// Calendar schedules follow the host computer's local time, including daylight saving changes.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub(crate) enum Schedule {
    Once { at: i64 },
    Interval { minutes: u32 },
    Daily { time: String },
    Weekdays { time: String },
    Weekly { time: String, weekday: u32 },
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum TaskStatus {
    Active,
    Paused,
    Completed,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum RunStatus {
    Idle,
    Starting,
    Running,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TaskInput {
    pub(super) title: String,
    pub(super) prompt: String,
    #[serde(default)]
    pub(super) cwd: String,
    pub(super) schedule: Schedule,
}

/// Stored tasks contain only user supplied settings and the latest execution's identifiers.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ScheduledTask {
    pub(super) id: String,
    #[serde(flatten)]
    pub(super) input: TaskInput,
    pub(super) status: TaskStatus,
    pub(super) next_run_at: Option<i64>,
    pub(super) last_run_at: Option<i64>,
    pub(super) last_thread_id: Option<String>,
    pub(super) last_turn_id: Option<String>,
    pub(super) run_status: RunStatus,
    pub(super) error: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(
    tag = "operation",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub(crate) enum TaskRequest {
    List,
    Save {
        id: Option<String>,
        input: TaskInput,
    },
    SetStatus {
        id: String,
        status: TaskStatus,
    },
    Delete {
        id: String,
    },
    RunNow {
        id: String,
    },
}
