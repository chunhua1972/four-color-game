import { admin, command, roomAction, snapshot } from '../_shared/service.ts';
const allowed = new Set(
  (Deno.env.get('PUBLIC_ORIGINS') ?? 'http://localhost:5173,http://localhost:4173').split(','),
);
Deno.serve(async (request: Request) => {
  const origin = request.headers.get('origin');
  const headers = {
    'content-type': 'application/json',
    'cache-control': 'no-store',
    vary: 'Origin',
    'access-control-allow-origin': origin && allowed.has(origin) ? origin : '',
    'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info',
    'access-control-allow-methods': 'POST, OPTIONS',
  };
  const reply = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers });
  if (origin && !allowed.has(origin)) return reply({ error: 'ORIGIN_DENIED' }, 403);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (request.method !== 'POST') return reply({ error: 'METHOD_NOT_ALLOWED' }, 405);
  if (Number(request.headers.get('content-length') ?? 0) > 16000)
    return reply({ error: 'REQUEST_TOO_LARGE' }, 413);
  try {
    const authorization = request.headers.get('authorization') ?? '';
    if (!authorization.startsWith('Bearer ')) return reply({ error: 'UNAUTHORIZED' }, 401);
    const { data, error } = await admin.auth.getUser(authorization.slice(7));
    if (error || !data.user) return reply({ error: 'UNAUTHORIZED' }, 401);
    const text = await request.text();
    if (text.length > 16000) return reply({ error: 'REQUEST_TOO_LARGE' }, 413);
    const body = JSON.parse(text);
    let result: unknown;
    if (body.operation === 'snapshot') result = await snapshot(body.gameId, data.user.id);
    else if (body.operation === 'command') result = await command(data.user.id, body.request);
    else if (typeof body.operation === 'string' && body.operation.startsWith('room.'))
      result = await roomAction(data.user.id, body.operation.slice(5), body.data ?? {});
    else return reply({ error: 'INVALID_OPERATION' }, 400);
    return reply({ data: result });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'SERVER_ERROR';
    // Return only our known codes. SQL diagnostics and validation input stay on the server.
    const code = /^[A-Z][A-Z0-9_]{1,60}$/.test(message) ? message : 'REQUEST_FAILED';
    return reply(
      { error: code },
      code === 'NOT_GAME_MEMBER' || code === 'NOT_ROOM_MEMBER' ? 403 : 409,
    );
  }
});
