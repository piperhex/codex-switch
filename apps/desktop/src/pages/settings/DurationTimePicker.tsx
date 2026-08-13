import { TimePicker } from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { MAX_AUTO_REFRESH_SECONDS, MIN_AUTO_REFRESH_SECONDS } from "../../hooks/useAutoRefresh";

const DURATION_FORMAT = "HH:mm:ss";
const HOURS_PER_DAY = 24;
const MINUTES_PER_HOUR = 60;
const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3600;

interface DurationTimePickerProps {
  id: string;
  value: number;
  disabled: boolean;
  onChange: (value: number | string | null) => void;
}

function range(end: number) {
  return Array.from({ length: end }, (_, index) => index);
}

function secondsToDuration(seconds: number) {
  return dayjs().startOf("day").add(seconds, "second");
}

function durationToSeconds(value: Dayjs) {
  return value.hour() * SECONDS_PER_HOUR
    + value.minute() * SECONDS_PER_MINUTE
    + value.second();
}

function disabledTime() {
  return {
    disabledHours: () => range(HOURS_PER_DAY).filter((hour) => {
      const firstSecond = hour * SECONDS_PER_HOUR;
      const lastSecond = firstSecond + SECONDS_PER_HOUR - 1;
      return firstSecond > MAX_AUTO_REFRESH_SECONDS || lastSecond < MIN_AUTO_REFRESH_SECONDS;
    }),
    disabledMinutes: (hour: number) => range(MINUTES_PER_HOUR).filter((minute) => {
      const firstSecond = hour * SECONDS_PER_HOUR + minute * SECONDS_PER_MINUTE;
      const lastSecond = firstSecond + SECONDS_PER_MINUTE - 1;
      return firstSecond > MAX_AUTO_REFRESH_SECONDS || lastSecond < MIN_AUTO_REFRESH_SECONDS;
    }),
    disabledSeconds: (hour: number, minute: number) => range(SECONDS_PER_MINUTE).filter((second) => {
      const duration = hour * SECONDS_PER_HOUR + minute * SECONDS_PER_MINUTE + second;
      return duration < MIN_AUTO_REFRESH_SECONDS || duration > MAX_AUTO_REFRESH_SECONDS;
    }),
  };
}

export function DurationTimePicker({ id, value, disabled, onChange }: DurationTimePickerProps) {
  return (
    <TimePicker
      id={id}
      className="duration-time-picker"
      value={secondsToDuration(value)}
      format={DURATION_FORMAT}
      placeholder="00:00:00"
      allowClear={false}
      showNow={false}
      disabled={disabled}
      disabledTime={disabledTime}
      onChange={(nextValue) => {
        if (nextValue) onChange(durationToSeconds(nextValue));
      }}
    />
  );
}
