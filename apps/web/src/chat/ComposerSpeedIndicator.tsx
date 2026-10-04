import { Zap } from 'lucide-react';
import type { RequestSpeed } from '../../../../shared/remote-chat/composer';
import { speedBoltCount } from '../../../../shared/remote-chat/requestSpeed';

export function ComposerSpeedIndicator({ speed }: { speed?: RequestSpeed }) {
  const bolts = speedBoltCount(speed ?? 'normal');
  if (!bolts) return null;
  return <span className="chat-model-speed" aria-hidden="true" data-speed={speed}>
    <span className="chat-model-speed-separator">·</span>
    {Array.from({ length: bolts }, (_, index) => <Zap key={index} size="1em" />)}
  </span>;
}
