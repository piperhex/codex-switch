import { useCallback, useEffect, useRef, useState } from "react";
import { Modal, type ModalFuncProps } from "antd";

export function useThreadConfirmation() {
  const dialog = useRef<ReturnType<typeof Modal.confirm>>();
  const [confirming, setConfirming] = useState(false);
  useEffect(() => () => dialog.current?.destroy(), []);
  const confirm = useCallback((options: ModalFuncProps) => {
    setConfirming(true);
    dialog.current = Modal.confirm({
      ...options,
      width: 400,
      afterClose: () => {
        setConfirming(false);
        options.afterClose?.();
      },
    });
  }, []);
  return { confirm, confirming };
}
