import { Tooltip } from 'antd';
import type { RequestSpeed } from './composer';
import { nextRequestSpeed, requestSpeedLabel, speedBoltCount } from './requestSpeed';
import './requestSpeedButton.css';

export function RequestSpeedButton({ speed, disabled, busy, onChange, translate = (text) => text,
  error, available = true }: {
  speed?: RequestSpeed; disabled?: boolean; busy?: boolean; error?: string; available?: boolean;
  onChange: (speed: RequestSpeed) => void; translate?: (text: string) => string;
}) {
  const current = speed ?? 'normal';
  const label = !available && current === 'normal' ? translate('当前账户暂不支持加速模式')
    : requestSpeedLabel(current, translate, available);
  const bolts = speedBoltCount(current);
  return <Tooltip title={error || label} trigger={['hover', 'focus']} styles={{ root: { maxWidth: 400 } }}>
    <button type="button" className="request-speed-button" data-speed={current}
      disabled={disabled || busy || speed === undefined || (!available && current === 'normal')}
      aria-busy={busy} aria-label={label} onClick={() => onChange(nextRequestSpeed(current, available))}>
      <svg width="30" height="20" viewBox="0 0 30 20" fill="none" aria-hidden="true">
        {[0, 1].map((index) => <path key={index} transform={`translate(${index * 12} 0)`}
          d="M10 1 2 11h6l-1 8 9-11h-6l1-7Z" className={index < bolts ? 'is-lit' : undefined}
          stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />)}
      </svg>
    </button>
  </Tooltip>;
}
