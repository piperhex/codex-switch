import { useSyncExternalStore } from 'react';
import { getInterfaceLanguage, subscribeInterfaceLanguage } from '../../../../shared/i18n/interfaceLanguage';

/** Memoised conversation views must update copy without remounting their editor or message state. */
export function useGuiLanguage() {
  return useSyncExternalStore(subscribeInterfaceLanguage, getInterfaceLanguage, () => 'zh' as const);
}
