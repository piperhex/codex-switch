import { useRef, useState } from 'react';
import type { AgreementAction } from './types';

type Operation = () => Promise<void>;

/** Consent lasts only for this mounted login form; reading or dismissing never grants it. */
export function useAgreementConsent() {
  const [accepted, setAccepted] = useState(false);
  const [pendingAction, setPendingAction] = useState<AgreementAction | null>(null);
  const pending = useRef<Operation | null>(null);
  const running = useRef(false);

  const execute = async (operation: Operation) => {
    if (running.current) return;
    running.current = true;
    try { await operation(); }
    finally { running.current = false; }
  };

  const request = async (action: AgreementAction, operation: Operation) => {
    if (running.current || pending.current) return;
    if (accepted) return execute(operation);
    pending.current = operation;
    setPendingAction(action);
  };

  const cancel = () => {
    pending.current = null;
    setPendingAction(null);
  };

  const confirm = async () => {
    const operation = pending.current;
    if (!operation) return;
    cancel();
    setAccepted(true);
    await execute(operation);
  };

  return { accepted, setAccepted, pendingAction, request, cancel, confirm };
}

export type AgreementConsent = ReturnType<typeof useAgreementConsent>;
