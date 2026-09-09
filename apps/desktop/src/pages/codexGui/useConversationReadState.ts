import { useEffect } from "react";
import type { GuiController } from "./controller";

export function useConversationReadState(active: boolean, controller: GuiController) {
  useEffect(() => {
    const update = () => controller.readState.setViewing(active && document.visibilityState === "visible"
      && document.hasFocus());
    update();
    document.addEventListener("visibilitychange", update);
    window.addEventListener("focus", update);
    window.addEventListener("blur", update);
    return () => {
      document.removeEventListener("visibilitychange", update);
      window.removeEventListener("focus", update);
      window.removeEventListener("blur", update);
      controller.readState.setViewing(false);
    };
  }, [active, controller]);
}
