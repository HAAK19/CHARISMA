import http from 'node:http';
import path from 'node:path';
import express from 'express';

const PORT = Number(process.env.PORT || 3000);

async function startServer() {
  const app = express();
  const server = http.createServer(app);

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, mode: 'local-only', timestamp: Date.now() });
  });

  // Serve Vite SPA in dev or prebuilt dist in production.
  // Zero user data, auth, messages, or keys ever touch the server.
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
        ws: { server },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`CHARISMA static SPA host listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
