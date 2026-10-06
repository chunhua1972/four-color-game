import { dispatchJobs } from '../_4color_shared/service.ts';
Deno.serve(async (request: Request) => {
  const expected = Deno.env.get('FOURCOLOR_JOB_DISPATCH_SECRET');
  const supplied = request.headers.get('x-job-secret');
  if (!expected || !supplied || expected.length !== supplied.length)
    return new Response('Unauthorized', { status: 401 });
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ supplied.charCodeAt(i);
  if (diff || request.method !== 'POST') return new Response('Unauthorized', { status: 401 });
  try {
    return Response.json(await dispatchJobs(), { headers: { 'cache-control': 'no-store' } });
  } catch {
    return Response.json({ error: 'DISPATCH_FAILED' }, { status: 503 });
  }
});
