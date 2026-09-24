import * as React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AgreementConsent as Consent } from '../../../../shared/legal/useAgreementConsent';
import { AgreementConsent } from './AgreementConsent';

const state = vi.hoisted(() => ({ reading: false, setReading: vi.fn(), dismiss: vi.fn() }));
vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof React>(), useState: () => [state.reading, state.setReading],
}));
vi.mock('react-native', () => ({
  Keyboard: { dismiss: state.dismiss }, Modal: 'Modal', Pressable: 'Pressable', ScrollView: 'ScrollView',
  Text: 'Text', View: 'View', StyleSheet: { create: <T,>(styles: T) => styles },
}));
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView' }));

interface Props {
  children?: React.ReactNode;
  accessibilityRole?: string;
  accessibilityState?: { checked: boolean; disabled: boolean };
  onPress?: () => void;
  onRequestClose?: () => void;
  visible?: boolean;
}

function descendants(node: React.ReactNode): React.ReactElement<Props>[] {
  if (!React.isValidElement<Props>(node)) return [];
  return [node, ...React.Children.toArray(node.props.children).flatMap(descendants)];
}

function consent(): Consent {
  return { accepted: false, setAccepted: vi.fn(), pendingAction: 'login',
    request: vi.fn(), cancel: vi.fn(), confirm: vi.fn() };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('React', React);
  state.reading = false;
});

afterEach(() => vi.unstubAllGlobals());

it('exposes an unchecked accessible checkbox and changes it only when pressed', () => {
  const model = consent();
  const nodes = descendants(AgreementConsent({ consent: model, disabled: false }));
  const checkbox = nodes.find(node => node.props.accessibilityRole === 'checkbox')!;
  expect(checkbox.props.accessibilityState).toEqual({ checked: false, disabled: false });
  checkbox.props.onPress!();
  expect(model.setAccepted).toHaveBeenCalledExactlyOnceWith(true);
  expect(model.confirm).not.toHaveBeenCalled();
});

it('system back cancels the prompt without granting consent', () => {
  const model = consent();
  const modal = descendants(AgreementConsent({ consent: model, disabled: false }))
    .find(node => node.props.onRequestClose)!;
  expect(modal.props.visible).toBe(true);
  modal.props.onRequestClose!();
  expect(model.cancel).toHaveBeenCalledOnce();
  expect(model.confirm).not.toHaveBeenCalled();
  expect(model.setAccepted).not.toHaveBeenCalled();
});

it('system back from reading preserves the pending login confirmation', () => {
  state.reading = true;
  const model = consent();
  const modal = descendants(AgreementConsent({ consent: model, disabled: false }))
    .find(node => node.props.onRequestClose)!;
  modal.props.onRequestClose!();
  expect(state.setReading).toHaveBeenCalledExactlyOnceWith(false);
  expect(model.cancel).not.toHaveBeenCalled();
  expect(model.confirm).not.toHaveBeenCalled();
});
