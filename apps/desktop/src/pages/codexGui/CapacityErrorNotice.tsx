import { CircleAlert, X } from "lucide-react";
import type { CapacityRetryState } from "./capacityRetry";
import { MODEL_CAPACITY_MESSAGE } from "./requestError";
import styles from "./RequestErrorNotice.module.less";

export interface CapacityRetryControl {
  retry?: CapacityRetryState;
  onCancelRetry?: () => void;
}

export function CapacityErrorNotice({ retry, onCancelRetry }: CapacityRetryControl) {
  return <div className={styles.capacityNotice}>
    <div className={styles.capacityContent}>
      <CircleAlert size={20} aria-hidden="true" />
      <span className={styles.capacityMessage}>{MODEL_CAPACITY_MESSAGE}</span>
    </div>
    {retry && <div className={styles.countdown}>
      <span role="status">{retry.seconds > 0 ? `${retry.seconds} 秒后自动重试` : "等待重试…"}</span>
      <button type="button" aria-label="停止自动重试" onClick={onCancelRetry}>
        <X size={14} aria-hidden="true" />
      </button>
    </div>}
  </div>;
}
