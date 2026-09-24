export type RemoteModelTarget = 'proxy' | 'gui';

export interface RemoteModelState {
  activeAccountId?: string | null;
  activeProviderId?: string | null;
  activeProviderGroup?: string | null;
  guiAccountId?: string | null;
  guiProviderId?: string | null;
}

/** Omitted fields belong to another target or an older server; null explicitly clears a choice. */
export function mergeRemoteModelState<T extends RemoteModelState>(device: T, result: RemoteModelState): T {
  const next = { ...device };
  const fields = ['activeAccountId', 'activeProviderId', 'activeProviderGroup',
    'guiAccountId', 'guiProviderId'] as const;
  for (const field of fields) {
    if (result[field] !== undefined) next[field] = result[field];
  }
  return next;
}

/** Keep existing proxy endpoints compatible with older desktop clients. */
export function remoteModelPath(kind: 'account' | 'provider', target: RemoteModelTarget): string {
  return target === 'gui' ? `gui-${kind}` : kind;
}

export function remoteModelOptions(device: (RemoteModelState & {
  capabilities: readonly string[];
  localProxyRunning: boolean;
}) | null, target: RemoteModelTarget) {
  const gui = target === 'gui';
  const supported = device?.capabilities.includes(gui ? 'gui-model-switch' : 'provider-switch') ?? false;
  return {
    supported,
    accountAvailable: !gui || supported,
    providerAvailable: supported && (gui || Boolean(device?.localProxyRunning)),
    groupSupported: !gui && (device?.capabilities.includes('provider-group-switch') ?? false),
    accountId: gui ? device?.guiAccountId : device?.activeAccountId,
    providerId: gui ? device?.guiProviderId : device?.activeProviderId,
    group: gui ? null : device?.activeProviderGroup,
  };
}
