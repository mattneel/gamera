import { join } from 'node:path';
import { defineConfig } from 'vite';
import { gamera } from 'gamera-vite';
import sharpMist from 'gamera-sharp-mist';

const scriptsDir = process.env.GAMERA_SCRIPTS_DIR
  ?? join(process.env.USERPROFILE ?? '', 'Documents', 'Sharp Mist', 'Scripts');

export default defineConfig({
  server: { host: '127.0.0.1' },
  preview: { host: '127.0.0.1' },
  plugins: [
    gamera({
      game: sharpMist({ scriptsDir }),
    }),
  ],
});
