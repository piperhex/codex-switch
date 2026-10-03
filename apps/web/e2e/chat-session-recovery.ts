import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { connect, fixtureUrl, operationCount, send, settled } from './chat-helpers';

export async function sessionRecoveryJourney(page: Page, request: APIRequestContext) {
  let rejectResume = false;
  let rejectedResumes = 0;
  let disconnect: (() => void) | undefined;
  const pairedSessions: string[] = [];
  await page.routeWebSocket('**/device-chat', socket => {
    const server = socket.connectToServer();
    disconnect = () => {
      socket.close({ code: 1012, reason: 'Coordinator restarted' });
      server.close();
    };
    socket.onMessage(message => {
      const frame: { type?: string; resume?: unknown } = typeof message === 'string' ? JSON.parse(message) : {};
      if (rejectResume && frame.type === 'authenticate' && frame.resume) {
        rejectedResumes += 1;
        socket.close({ code: 4004, reason: 'Waiting for PC session' });
        return;
      }
      server.send(message);
    });
    server.onMessage(message => {
      const frame: { type?: string; sessionId?: string } = typeof message === 'string' ? JSON.parse(message) : {};
      if (frame.type === 'paired' && frame.sessionId) pairedSessions.push(frame.sessionId);
      socket.send(message);
    });
  });
  // Install the fault before creating the observed socket; recovery itself must not reload the page.
  await request.post(`${fixtureUrl}/test/reset`, { data: { transportVersion: 2 } });
  await page.reload();
  await connect(page);
  const status = page.getByRole('status').filter({ hasText: 'Relay' });
  await expect(status).toBeVisible({ timeout: 16_000 });
  const draft = page.getByRole('textbox', { name: '聊天消息' });
  await draft.fill('恢复连接后继续发送');
  const originalSession = pairedSessions.at(-1);
  expect(originalSession).toBeTruthy();
  rejectResume = true;
  expect(disconnect).toBeDefined();
  disconnect!();
  await expect.poll(() => rejectedResumes, { timeout: 15_000 }).toBe(2);
  await expect.poll(() => pairedSessions.at(-1), { timeout: 15_000 }).not.toBe(originalSession);
  await expect(status).toBeVisible({ timeout: 15_000 });
  await expect(draft).toHaveValue('恢复连接后继续发送');
  await expect.poll(() => operationCount(request, 'send')).toBe(0);
  await send(page, '恢复连接后继续发送');
  await settled(page);
  await expect.poll(() => operationCount(request, 'send')).toBe(1);
}
