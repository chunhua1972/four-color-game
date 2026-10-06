import { build } from 'esbuild';
await build({
  entryPoints: [
    'supabase/functions/fourcolor_core_proof/index.ts',
    'supabase/functions/fourcolor_game_api/index.ts',
    'supabase/functions/fourcolor_job_dispatch/index.ts',
  ],
  outdir: 'supabase/functions/dist',
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  target: 'es2022',
  external: ['npm:*'],
});
console.log('Edge shared-core ESM bundle built.');
