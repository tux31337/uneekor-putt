import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { appendFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [react(), {
    name: 'putting-render-diagnostics',
    configureServer(server) {
      server.middlewares.use('/__putting-diagnostics', (request, response, next) => {
        if (request.method !== 'POST') { next(); return; }
        let body = '';
        request.on('data', (chunk: Buffer) => {
          body += chunk.toString();
          if (body.length > 24000) request.destroy();
        });
        request.on('end', () => {
          try {
            const entry = JSON.parse(body);
            if (typeof entry.stage !== 'string' || !entry.detail || typeof entry.detail !== 'object') throw new Error('Invalid diagnostic');
            const directory = resolve(server.config.root, '.tmp');
            mkdirSync(directory, { recursive: true });
            appendFileSync(resolve(directory, 'render-diagnostics.ndjson'), JSON.stringify(entry) + '\n');
            response.statusCode = 204;
          } catch { response.statusCode = 400; }
          response.end();
        });
      });
    },
  }],
  base: './',
  server: { port: 5173, strictPort: true },
  build: { target: 'es2022' },
});
