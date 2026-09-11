import { GuiController } from './controller';
import { guiComposer } from './composerBridge';
import { guiSidebar } from './sidebarBridge';
import { hasLocalBackend } from '../../api/backend';
import { modelSettingsApi } from './modelSettingsApi';

let controller: GuiController | undefined;
let owners = 0;
let detach: (() => void) | undefined;

/** The workspace and remote host share one queue, including before the GUI is first opened. */
export function getGuiController() { return controller ??= new GuiController(); }

export function retainGuiSession() {
  const current = getGuiController();
  if (owners++ === 0) {
    current.activate();
    const models = hasLocalBackend ? current.modelSettings.start(modelSettingsApi) : undefined;
    const composer = guiComposer.attach(current);
    const sidebar = guiSidebar.attach(current);
    detach = () => { models?.(); composer(); sidebar(); current.dispose(); };
  }
  return () => { if (--owners === 0) { detach?.(); detach = undefined; } };
}
