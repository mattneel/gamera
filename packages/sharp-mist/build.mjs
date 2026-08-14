import { build } from 'esbuild';
import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const scriptsDir = process.env.GAMERA_SCRIPTS_DIR
  ?? join(process.env.USERPROFILE ?? '', 'Documents', 'Sharp Mist', 'Scripts');
const outfile = process.env.GAMERA_AGENT_OUT ?? join(scriptsDir, 'GameraAgent.cjs');
const discoveryAbs = process.env.GAMERA_DISCOVERY
  ?? join(scriptsDir, '.gamera.json');

mkdirSync(dirname(outfile), { recursive: true });

const result = await build({
  absWorkingDir: import.meta.dirname,
  entryPoints: [join(import.meta.dirname, 'src', 'inject.ts')],
  outfile,
  bundle: true,
  format: 'cjs',
  platform: 'neutral',
  target: 'es2020',
  charset: 'utf8',
  legalComments: 'none',
  define: {
    __GAMERA_DISCOVERY_ABS__: JSON.stringify(discoveryAbs.replace(/\\/g, '/')),
  },
  external: [
    './SharpMist/*',
    'ue',
    'puerts',
    'cpp',
    'config',
    'config/*',
    'module/*',
    'net/*',
    'protocols/*',
    'ui/*',
    'utils/*',
    'core/*',
  ],
});

const bytes = statSync(outfile).size;
const limit = 512 * 1024;
if (bytes > limit) {
  throw new Error(`GameraAgent.cjs is ${bytes} bytes; editable-entry limit is ${limit}`);
}
if (bytes > 64 * 1024) {
  console.warn(`GameraAgent.cjs is ${bytes} bytes (target < 64 KiB)`);
}
writeFileSync(`${outfile}.size`, `${bytes}\n`);
console.log(`Built ${outfile} (${bytes} bytes)`);
void result;
