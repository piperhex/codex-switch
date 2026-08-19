import { TimePicker } from "antd";
import dayjs, { type Dayjs } from "dayjs";

const DURATION_FORMAT = "HH:mm:ss";
const HOURS_PER_DAY = 24;
const MINUTES_PER_HOUR = 60;
const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3600;
const DEFAULT_MIN_DURATION_SECONDS = 1;
const DEFAULT_MAX_DURATION_SECONDS = 3_600;

interface DurationTimePickerProps {
  id: string;
  value: number;
  disabled: boolean;
  minSeconds?: number;
  maxSeconds?: number;
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

function disabledTime(minSeconds: number, maxSeconds: number) {
  return {
    disabledHours: () => range(HOURS_PER_DAY).filter((hour) => {
      const firstSecond = hour * SECONDS_PER_HOUR;
      const lastSecond = firstSecond + SECONDS_PER_HOUR - 1;
      return firstSecond > maxSeconds || lastSecond < minSeconds;
    }),
    disabledMinutes: (hour: number) => range(MINUTES_PER_HOUR).filter((minute) => {
      const firstSecond = hour * SECONDS_PER_HOUR + minute * SECONDS_PER_MINUTE;
      const lastSecond = firstSecond + SECONDS_PER_MINUTE - 1;
      return firstSecond > maxSeconds || lastSecond < minSeconds;
    }),
    disabledSeconds: (hour: number, minute: number) => range(SECONDS_PER_MINUTE).filter((second) => {
      const duration = hour * SECONDS_PER_HOUR + minute * SECONDS_PER_MINUTE + second;
      return duration < minSeconds || duration > maxSeconds;
    }),
  };
}

export function DurationTimePicker({
  id,
  value,
  disabled,
  minSeconds = DEFAULT_MIN_DURATION_SECONDS,
  maxSeconds = DEFAULT_MAX_DURATION_SECONDS,
  onChange,
}: DurationTimePickerProps) {
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
      disabledTime={() => disabledTime(minSeconds, maxSeconds)}
      onChange={(nextValue) => {
        if (nextValue) onChange(durationToSeconds(nextValue));
      }}
    />
  );
}
