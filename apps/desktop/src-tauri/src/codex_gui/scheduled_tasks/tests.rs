use super::{runtime, schedule, store, types::*};
use chrono::{Datelike, Local, TimeZone, Timelike};
use serde_json::json;

fn input(schedule: Schedule) -> TaskInput {
    TaskInput {
        title: "跟进发布".into(),
        prompt: "检查最新发布并总结变化".into(),
        cwd: String::new(),
        schedule,
    }
}

fn local_time(day: u32, hour: u32, minute: u32) -> i64 {
    Local
        .with_ymd_and_hms(2026, 9, day, hour, minute, 0)
        .single()
        .unwrap()
        .timestamp_millis()
}

#[test]
fn weekdays_skip_weekends_and_weekly_advances_past_current_minute() {
    let now = local_time(11, 16, 0); // Friday
    let weekdays = schedule::next_run(
        &Schedule::Weekdays {
            time: "08:00".into(),
        },
        now,
    )
    .unwrap()
    .unwrap();
    let next = Local.timestamp_millis_opt(weekdays).unwrap();
    assert_eq!((next.day(), next.hour(), next.minute()), (14, 8, 0));
    let weekly = schedule::next_run(
        &Schedule::Weekly {
            time: "16:00".into(),
            weekday: 4,
        },
        now,
    )
    .unwrap();
    assert_eq!(weekly, Some(local_time(18, 16, 0)));
}

#[test]
fn validates_interval_calendar_and_one_time_boundaries() {
    assert!(schedule::next_run(&Schedule::Interval { minutes: 0 }, 0).is_err());
    assert!(schedule::next_run(&Schedule::Once { at: i64::MAX }, 0).is_err());
    assert!(schedule::next_run(
        &Schedule::Weekly {
            time: "12:00".into(),
            weekday: 7
        },
        0
    )
    .is_err());
    assert!(schedule::next_run(
        &Schedule::Daily {
            time: "25:00".into()
        },
        0
    )
    .is_err());
    assert_eq!(
        schedule::next_run(&Schedule::Once { at: 100 }, 100).unwrap(),
        None
    );
    assert!(schedule::validate(&input(Schedule::Once { at: 99 }), 100).is_err());
}

#[test]
fn claiming_coalesces_missed_runs_and_never_overlaps() {
    let mut tasks = Vec::new();
    store::apply(
        &mut tasks,
        TaskRequest::Save {
            id: None,
            input: input(Schedule::Interval { minutes: 5 }),
        },
        0,
    )
    .unwrap();
    let claimed = store::claim(&mut tasks, 3_600_000, 3).unwrap();
    assert_eq!(claimed.len(), 1);
    assert_eq!(tasks[0].next_run_at, Some(3_900_000));
    assert!(store::claim(&mut tasks, 4_000_000, 3).unwrap().is_empty());
    let request = TaskRequest::Delete {
        id: tasks[0].id.clone(),
    };
    assert!(matches!(
        store::apply(&mut tasks, request, 4_000_000),
        Err(TaskError::Busy)
    ));
}

#[test]
fn one_time_completion_and_recovery_are_truthful() {
    let mut tasks = Vec::new();
    store::apply(
        &mut tasks,
        TaskRequest::Save {
            id: None,
            input: input(Schedule::Once { at: 100 }),
        },
        0,
    )
    .unwrap();
    store::claim(&mut tasks, 100, 1).unwrap();
    assert_eq!(tasks[0].status, TaskStatus::Active);
    store::recover(&mut tasks);
    assert_eq!(tasks[0].status, TaskStatus::Paused);
    assert!(tasks[0].error.is_some());
    let request = TaskRequest::RunNow {
        id: tasks[0].id.clone(),
    };
    store::apply(&mut tasks, request, 200).unwrap();
    store::claim(&mut tasks, 200, 1).unwrap();
    store::finish(&mut tasks[0], true);
    assert_eq!(tasks[0].status, TaskStatus::Completed);
    assert_eq!(tasks[0].next_run_at, None);
}

#[test]
fn pause_resume_and_capacity_are_enforced() {
    let mut tasks = Vec::new();
    for _ in 0..4 {
        store::apply(
            &mut tasks,
            TaskRequest::Save {
                id: None,
                input: input(Schedule::Interval { minutes: 1 }),
            },
            0,
        )
        .unwrap();
    }
    let id = tasks[0].id.clone();
    store::apply(
        &mut tasks,
        TaskRequest::SetStatus {
            id: id.clone(),
            status: TaskStatus::Paused,
        },
        10,
    )
    .unwrap();
    assert_eq!(tasks[0].next_run_at, None);
    assert_eq!(store::claim(&mut tasks, 60_000, 2).unwrap().len(), 2);
    store::apply(
        &mut tasks,
        TaskRequest::SetStatus {
            id,
            status: TaskStatus::Active,
        },
        120_000,
    )
    .unwrap();
    assert_eq!(tasks[0].next_run_at, Some(180_000));
}

#[test]
fn task_storage_round_trips_and_requires_matching_turn_completion() {
    let mut tasks = Vec::new();
    store::apply(
        &mut tasks,
        TaskRequest::Save {
            id: None,
            input: input(Schedule::Interval { minutes: 5 }),
        },
        0,
    )
    .unwrap();
    let saved = serde_json::to_vec(&tasks).unwrap();
    let loaded: Vec<ScheduledTask> = serde_json::from_slice(&saved).unwrap();
    assert_eq!(loaded[0].id, tasks[0].id);
    let response = json!({"thread": {"turns": [{"id": "old", "status": "completed"},
        {"id": "current", "status": "inProgress"}]}});
    assert_eq!(
        runtime::observe_turn(&response, Some("current"))
            .unwrap()
            .completed,
        None
    );
    assert_eq!(
        runtime::observe_turn(&response, Some("old"))
            .unwrap()
            .completed,
        Some(true)
    );
}

#[test]
fn unacknowledged_submission_reserves_its_slot_until_a_turn_is_observed() {
    use crate::codex_gui::error::GuiError;
    assert_eq!(
        runtime::submitted_turn(Err(GuiError::Timeout)).unwrap(),
        None
    );
    assert!(runtime::submitted_turn(Err(GuiError::Rpc)).is_err());
    assert!(runtime::observe_turn(&json!({"thread": {"turns": []}}), None).is_none());
    let response = json!({"thread": {"turns": [
        {"id": "old", "status": "completed"}, {"id": "latest", "status": "inProgress"}
    ]}});
    let observed = runtime::observe_turn(&response, None).unwrap();
    assert_eq!(observed.turn_id.as_deref(), Some("latest"));
    assert_eq!(observed.completed, None);
    assert!(runtime::observe_turn(&response, Some("unknown")).is_none());
    let finished = json!({"thread": {"turns": [{"id": "latest", "status": "completed"}]}});
    assert_eq!(
        runtime::observe_turn(&finished, Some("latest"))
            .unwrap()
            .completed,
        Some(true)
    );
}
