use chrono::{DateTime, Datelike, Duration, Local, NaiveTime, TimeZone, Timelike};

use super::types::{Result, Schedule, TaskError, TaskInput};

const MAX_INTERVAL_MINUTES: u32 = 525_600;
const MAX_TITLE_CHARACTERS: usize = 120;
const MAX_PROMPT_CHARACTERS: usize = 20_000;

pub(super) fn validate(input: &TaskInput, now: i64) -> Result<()> {
    if input.title.trim().is_empty()
        || input.title.chars().count() > MAX_TITLE_CHARACTERS
        || input.prompt.trim().is_empty()
        || input.prompt.chars().count() > MAX_PROMPT_CHARACTERS
    {
        return Err(TaskError::Invalid);
    }
    if !input.cwd.is_empty() {
        super::super::protocol::directory(&input.cwd).map_err(|_| TaskError::Invalid)?;
    }
    if next_run(&input.schedule, now)?.is_none() {
        return Err(TaskError::Invalid);
    }
    Ok(())
}

/// Missed repetitions coalesce into a single run; the next time is always strictly after `now`.
pub(super) fn next_run(schedule: &Schedule, now: i64) -> Result<Option<i64>> {
    match schedule {
        Schedule::Once { at } => {
            DateTime::from_timestamp_millis(*at).ok_or(TaskError::Invalid)?;
            Ok((*at > now).then_some(*at))
        }
        Schedule::Interval { minutes } if (1..=MAX_INTERVAL_MINUTES).contains(minutes) => now
            .checked_add(i64::from(*minutes) * 60_000)
            .map(Some)
            .ok_or(TaskError::Invalid),
        Schedule::Interval { .. } => Err(TaskError::Invalid),
        _ => calendar_next(schedule, now).map(Some),
    }
}

fn calendar_next(schedule: &Schedule, now: i64) -> Result<i64> {
    let (time, weekday, weekdays) = match schedule {
        Schedule::Daily { time } => (time, None, false),
        Schedule::Weekdays { time } => (time, None, true),
        Schedule::Weekly { time, weekday } if *weekday < 7 => (time, Some(*weekday), false),
        _ => return Err(TaskError::Invalid),
    };
    let time = NaiveTime::parse_from_str(time, "%H:%M").map_err(|_| TaskError::Invalid)?;
    let date = DateTime::from_timestamp_millis(now)
        .ok_or(TaskError::Invalid)?
        .with_timezone(&Local)
        .date_naive();
    for offset in 0..=14 {
        let day = date + Duration::days(offset);
        let day_index = day.weekday().num_days_from_monday();
        if weekday.is_some_and(|value| value != day_index) || (weekdays && day_index >= 5) {
            continue;
        }
        // A missing local minute at a DST transition is skipped, not silently shifted.
        if let Some(candidate) = Local
            .from_local_datetime(
                &day.and_hms_opt(time.hour(), time.minute(), 0)
                    .ok_or(TaskError::Invalid)?,
            )
            .earliest()
            .filter(|value| value.timestamp_millis() > now)
        {
            return Ok(candidate.timestamp_millis());
        }
    }
    Err(TaskError::Invalid)
}
