use std::{fs, path::Path};

use super::{schedule, types::*};

const FILE_NAME: &str = "switch-scheduled-tasks.json";
const MAX_TASKS: usize = 100;

pub(super) fn read(root: &Path) -> Result<Vec<ScheduledTask>> {
    match fs::read(root.join(FILE_NAME)) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|_| TaskError::Storage),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(_) => Err(TaskError::Storage),
    }
}

pub(super) fn write(root: &Path, tasks: &[ScheduledTask]) -> Result<()> {
    fs::create_dir_all(root).map_err(|_| TaskError::Storage)?;
    let value = serde_json::to_value(tasks).map_err(|_| TaskError::Storage)?;
    crate::storage::write_json_atomic(&root.join(FILE_NAME), &value).map_err(|_| TaskError::Storage)
}

pub(super) fn apply(tasks: &mut Vec<ScheduledTask>, request: TaskRequest, now: i64) -> Result<()> {
    match request {
        TaskRequest::List => Ok(()),
        TaskRequest::Save { id, input } => save(tasks, id, input, now),
        TaskRequest::SetStatus { id, status } => set_status(find(tasks, &id)?, status, now),
        TaskRequest::Delete { id } => {
            ensure_idle(find(tasks, &id)?)?;
            tasks.retain(|task| task.id != id);
            Ok(())
        }
        TaskRequest::RunNow { id } => {
            let task = find(tasks, &id)?;
            ensure_idle(task)?;
            task.status = TaskStatus::Active;
            task.next_run_at = Some(now);
            task.error = None;
            Ok(())
        }
    }
}

fn save(
    tasks: &mut Vec<ScheduledTask>,
    id: Option<String>,
    mut input: TaskInput,
    now: i64,
) -> Result<()> {
    input.title = input.title.trim().to_owned();
    input.prompt = input.prompt.trim().to_owned();
    input.cwd = input.cwd.trim().to_owned();
    schedule::validate(&input, now)?;
    let next_run_at = schedule::next_run(&input.schedule, now)?;
    if let Some(id) = id {
        let task = find(tasks, &id)?;
        ensure_idle(task)?;
        task.input = input;
        task.next_run_at = (task.status != TaskStatus::Paused)
            .then_some(next_run_at)
            .flatten();
        if task.status == TaskStatus::Completed {
            task.status = TaskStatus::Active;
        }
        task.error = None;
        return Ok(());
    }
    if tasks.len() >= MAX_TASKS {
        return Err(TaskError::Invalid);
    }
    tasks.push(ScheduledTask {
        id: uuid::Uuid::new_v4().to_string(),
        input,
        status: TaskStatus::Active,
        next_run_at,
        last_run_at: None,
        last_thread_id: None,
        last_turn_id: None,
        run_status: RunStatus::Idle,
        error: None,
    });
    Ok(())
}

fn set_status(task: &mut ScheduledTask, status: TaskStatus, now: i64) -> Result<()> {
    ensure_idle(task)?;
    if status == TaskStatus::Completed {
        return Err(TaskError::Invalid);
    }
    task.next_run_at = if status == TaskStatus::Active {
        Some(schedule::next_run(&task.input.schedule, now)?.ok_or(TaskError::Invalid)?)
    } else {
        None
    };
    task.status = status;
    task.error = None;
    Ok(())
}

pub(super) fn find<'a>(tasks: &'a mut [ScheduledTask], id: &str) -> Result<&'a mut ScheduledTask> {
    tasks
        .iter_mut()
        .find(|task| task.id == id)
        .ok_or(TaskError::NotFound)
}

fn ensure_idle(task: &ScheduledTask) -> Result<()> {
    if task.run_status != RunStatus::Idle {
        return Err(TaskError::Busy);
    }
    Ok(())
}

/// Persist the claim before contacting Codex so a slow request never produces duplicate runs.
pub(super) fn claim(
    tasks: &mut [ScheduledTask],
    now: i64,
    limit: usize,
) -> Result<Vec<ScheduledTask>> {
    let mut claimed = Vec::new();
    for task in tasks {
        if claimed.len() >= limit {
            break;
        }
        if task.status != TaskStatus::Active
            || task.run_status != RunStatus::Idle
            || task.next_run_at.is_none_or(|at| at > now)
        {
            continue;
        }
        task.next_run_at = schedule::next_run(&task.input.schedule, now)?;
        task.last_run_at = Some(now);
        task.last_turn_id = None;
        task.last_thread_id = None;
        task.run_status = RunStatus::Starting;
        task.error = None;
        claimed.push(task.clone());
    }
    Ok(claimed)
}

pub(super) fn finish(task: &mut ScheduledTask, success: bool) {
    task.run_status = RunStatus::Idle;
    task.error = (!success).then(|| TaskError::Execution.to_string());
    if matches!(task.input.schedule, Schedule::Once { .. }) {
        task.status = if success {
            TaskStatus::Completed
        } else {
            TaskStatus::Paused
        };
        task.next_run_at = None;
    }
}

pub(super) fn recover(tasks: &mut [ScheduledTask]) {
    for task in tasks
        .iter_mut()
        .filter(|task| task.run_status != RunStatus::Idle)
    {
        finish(task, false);
        task.error = Some("上次执行未完成，你可以打开对话查看，或重新运行。".to_owned());
    }
}
