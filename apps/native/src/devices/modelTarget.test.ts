import { describe, expect, it } from 'vitest';
import { mergeRemoteModelState, remoteModelOptions } from '../../../../shared/remote-chat/modelTarget';

const device = {
  activeAccountId: 'proxy-account', activeProviderId: 'proxy-provider', activeProviderGroup: 'work',
  guiAccountId: 'gui-account', guiProviderId: null,
  capabilities: ['provider-switch', 'provider-group-switch', 'gui-model-switch'], localProxyRunning: false,
};

describe('remote model targets', () => {
  it('uses independent current choices and allows GUI switching before proxy startup', () => {
    expect(remoteModelOptions(device, 'gui')).toMatchObject({
      accountId: 'gui-account', providerId: null, group: null,
      accountAvailable: true, providerAvailable: true, groupSupported: false,
    });
    expect(remoteModelOptions(device, 'proxy')).toMatchObject({
      accountId: 'proxy-account', providerId: 'proxy-provider', group: 'work',
      accountAvailable: true, providerAvailable: false, groupSupported: true,
    });
  });

  it('disables GUI changes on older desktops while keeping official proxy choices available', () => {
    const legacy = { ...device, capabilities: [] };
    expect(remoteModelOptions(legacy, 'gui')).toMatchObject({ accountAvailable: false, providerAvailable: false });
    expect(remoteModelOptions(legacy, 'proxy').accountAvailable).toBe(true);
  });

  it('preserves the other target, handles nulls and accepts legacy partial responses', () => {
    const gui = mergeRemoteModelState(device, { guiAccountId: null, guiProviderId: 'new-gui' });
    expect(gui).toEqual({ ...device, guiAccountId: null, guiProviderId: 'new-gui' });
    expect(mergeRemoteModelState(gui, { activeAccountId: 'next', activeProviderId: null, activeProviderGroup: null }))
      .toEqual({ ...gui, activeAccountId: 'next', activeProviderId: null, activeProviderGroup: null });
    expect(device.guiAccountId).toBe('gui-account');
  });
});
