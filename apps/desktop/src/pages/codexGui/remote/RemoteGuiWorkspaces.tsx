import { lazy, Suspense, useState, type ComponentProps } from 'react';
import type { GuiComputer } from './types';

const RemoteGuiWorkspace = lazy(() => import('./RemoteGuiWorkspace'));
type WorkspaceProps = ComponentProps<typeof RemoteGuiWorkspace>;

/** The parent keys this collection by cloud identity so logout releases every connection. */
export function RemoteGuiWorkspaces(props: Omit<WorkspaceProps, 'device'> & { current: GuiComputer | null }) {
  const [visited, setVisited] = useState<GuiComputer[]>([]);
  const { current, active, ...workspace } = props;
  let devices = visited;
  if (current && !visited.some(device => device.deviceId === current.deviceId)) {
    devices = [...visited, current];
    setVisited(devices);
  }
  return devices.map(device => {
    const selected = device.deviceId === current?.deviceId;
    return <div key={device.deviceId} hidden={!selected} style={{ height: '100%' }}>
      <Suspense fallback={<p role="status">正在连接电脑…</p>}>
        <RemoteGuiWorkspace {...workspace} device={selected && current ? current : device} active={active && selected} />
      </Suspense>
    </div>;
  });
}
