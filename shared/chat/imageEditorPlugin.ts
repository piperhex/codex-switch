import type { Plugin } from 'vite';
import { IMAGE_EDITOR_ASSET } from './imageEditorAsset';
import { imageEditorScript } from './imageEditorScript';

/** Package the trusted editor as a same-origin asset, without allowing inline scripts in the host. */
export function imageEditorPlugin(): Plugin {
  const source = `const config = JSON.parse(document.getElementById('image-editor-config').textContent);\n`
    + imageEditorScript;
  let base = '/';
  return {
    name: 'chat-image-editor',
    configResolved(config) { base = config.base; },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (request.url?.split('?')[0] !== `${base}${IMAGE_EDITOR_ASSET}`) { next(); return; }
        response.setHeader('Content-Type', 'text/javascript; charset=utf-8');
        response.setHeader('Cache-Control', 'no-store');
        response.end(source);
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: IMAGE_EDITOR_ASSET, source });
    },
  };
}
