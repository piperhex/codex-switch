import type { GuiAccountChoice } from '../../../../../../shared/remote-chat/guiAccounts';
import { GuiAccountSummary, GuiPrimaryQuota } from '../GuiAccountSummary';

export function RemoteAccountSummary({ name, current, ready, running }: {
  name: string; current?: GuiAccountChoice; ready: boolean; running?: boolean;
}) {
  const plan = current?.kind === 'account' ? current.plan : undefined;
  let detail = <small>选择这台电脑的账户</small>;
  if (!ready) detail = <small>等待连接电脑</small>;
  else if (running === false) detail = <small>代理未启动</small>;
  else if (current?.kind === 'account' && current.primaryRemainingPercent !== undefined) {
    detail = <GuiPrimaryQuota remainingPercent={current.primaryRemainingPercent} />;
  } else if (current?.detail) {
    // Older computers send only the description; keep it readable until they are updated.
    detail = <small>{current.detail}</small>;
  }
  return <GuiAccountSummary name={name} plan={plan} detail={detail} />;
}
