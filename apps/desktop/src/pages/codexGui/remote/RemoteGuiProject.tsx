import { useEffect, useState } from 'react';
import { Button } from 'antd';
import { Folder } from 'lucide-react';
import { ChatProjectPicker } from '../../../../../web/src/chat/ChatProjectPicker';
import type { ChatController, ChatState } from '../../../../../web/src/chat/types';
import { projectName } from '../projectCatalog';
import styles from '../styles.module.less';

export function RemoteGuiProject({ state, controller, deviceName, active }: {
  state: ChatState; controller: ChatController; deviceName: string; active: boolean;
}) {
  const [picking, setPicking] = useState(false);
  const cwd = state.selected?.cwd ?? state.draftProject?.cwd ?? '';
  const canChoose = active && state.ready && !state.selected && !state.sending;
  useEffect(() => { if (!canChoose) setPicking(false); }, [canChoose]);
  return <div className="gui-remote-project">
    <div className={styles.projectBar}>
      <Button type="text" icon={<Folder size={15} />} disabled={!canChoose}
        aria-label="选择远程项目" title={cwd || undefined} onClick={() => setPicking(true)}>
        {cwd ? projectName(cwd) : '选择项目'}
      </Button>
      <span className={styles.localLabel}>远程 · {deviceName}</span>
    </div>
    {picking && canChoose && <ChatProjectPicker cwd={cwd} load={controller.loadProjectDirectories}
      close={() => setPicking(false)} choose={project => {
        controller.chooseDraftProject(project); setPicking(false);
      }} />}
  </div>;
}
