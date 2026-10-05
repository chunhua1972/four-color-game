import { build } from 'esbuild';
await build({
  entryPoints: [
    'supabase/functions/core-proof/index.ts',
    'supabase/functions/game-api/index.ts',
    'supabase/functions/job-dispatch/index.ts',
  ],
  outdir: 'supabase/functions/dist',
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  target: 'es2022',
  external: ['npm:*'],
});
console.log('Edge shared-core ESM bundle built.');
