import express from 'express';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export function serveClient(app, directory = fileURLToPath(new URL('../../client/dist/', import.meta.url))) {
  const index = resolve(directory, 'index.html');
  if (!existsSync(index)) throw new Error('Frontend build missing. Build client before starting in production.');
  app.use(express.static(directory, { index: false }));
  app.get('*', (req, res, next) => {
    if (!req.accepts('html')) return next();
    res.set('Cache-Control', 'no-store').sendFile(index);
  });
}
