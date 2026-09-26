import { invoke } from '@tauri-apps/api/core';

/** Binary IPC avoids JSON/base64 copies; capture, resize and JPEG encoding run in Rust workers. */
export class DesktopCapture {
  readonly canvas = document.createElement('canvas');
  private id?: string;
  private stopped = false;
  private stream?: MediaStream;
  async open(width: number) {
    this.id = await invoke<string>('remote_desktop_open');
    if (this.stopped) { await this.release(); throw new Error('桌面连接已结束。'); }
    await this.frame(width);
    if (this.stopped) throw new Error('桌面连接已结束。');
    this.stream = this.canvas.captureStream(0);
    return this.stream;
  }
  async frame(width: number) {
    if (this.stopped || !this.id) return;
    const data = await invoke<ArrayBuffer>('remote_desktop_frame', { id: this.id, width });
    if (this.stopped) return;
    const bitmap = await createImageBitmap(new Blob([data], { type: 'image/jpeg' }));
    try {
      if (this.stopped) return;
      if (this.canvas.width !== bitmap.width || this.canvas.height !== bitmap.height) {
        this.canvas.width = bitmap.width; this.canvas.height = bitmap.height;
      }
      const context = this.canvas.getContext('2d', { alpha: false });
      if (!context) throw new Error('暂时无法读取屏幕画面。');
      context.drawImage(bitmap, 0, 0);
      const track = this.stream?.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack | undefined;
      track?.requestFrame();
    } finally { bitmap.close(); }
  }
  async input(input: unknown) {
    if (!this.stopped && this.id) await invoke('remote_desktop_input', { id: this.id, input });
  }
  private async release() {
    if (!this.id) return;
    try { await invoke('remote_desktop_close', { id: this.id }); }
    catch { /* The native lease releases held buttons even if the WebView is torn down. */ }
  }
  close() {
    this.stopped = true;
    this.stream?.getTracks().forEach(track => track.stop());
    void this.release();
  }
}
