import { GuiController } from './controller';
import { guiComposer } from './composerBridge';
import { guiSidebar } from './sidebarBridge';

let controller: GuiController | undefined;
let owners = 0;
let detach: (() => void) | undefined;

/** The workspace and remote host share one queue, including before the GUI is first opened. */
export function getGuiController() { return controller ??= new GuiController(); }

export function retainGuiSession() {
  const current = getGuiController();
  if (owners++ === 0) {
    current.activate();
    const composer = guiComposer.attach(current);
    const sidebar = guiSidebar.attach(current);
    detach = () => { composer(); sidebar(); current.dispose(); };
  }
  return () => { if (--owners === 0) { detach?.(); detach = undefined; } };
}
