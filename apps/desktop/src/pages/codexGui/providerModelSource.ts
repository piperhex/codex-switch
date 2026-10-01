import { guiText } from "../../i18n/guiText";
import { invoke } from '../../api/backend';
import type { Provider } from '../../types';
import type { GuiAccountSelection } from '../../../../../shared/remote-chat/guiAccounts';
import { providerModels } from './providerModels';
import type { Model } from './types';

/** Read routing from the host session; page visibility and shared active flags are irrelevant. */
export async function readGuiProviderModels(): Promise<Model[] | null> {
  const selection = await invoke<GuiAccountSelection>('codex_gui_account_selection');
  if (selection.kind !== 'provider') return null;
  const providers = await invoke<Provider[]>('list_providers');
  const provider = providers.find(entry => entry.id === selection.id);
  if (!provider) throw new Error(guiText("此中转已不可用，请重新选择。"));
  return providerModels([{ ...provider, active: true }], []);
}
