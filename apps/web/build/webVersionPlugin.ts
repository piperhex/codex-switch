import type { Plugin } from 'vite';
import { version } from '../../../package.json';

/** Publish the deployed web version alongside its assets, under the configured base path. */
export function webVersionPlugin(): Plugin {
  const source = JSON.stringify({ version });
  return {
    name: 'web-version',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source });
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (request.url?.split('?')[0] !== `${server.config.base}version.json`) return next();
        response.setHeader('Content-Type', 'application/json');
        response.setHeader('Cache-Control', 'no-store');
        response.end(source);
      });
    },
  };
}
