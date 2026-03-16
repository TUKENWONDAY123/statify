// functions/api/auth/[[path]].js

const ADMIN_USERNAME = 'waleed';
const SESSION_TTL_DAYS = 30;

export async function onRequest(context) {
  const { request, env, params } = context;
  const method = request.method;
  const path = (params.path || []).filter(Boolean);

  try {
    if (method === 'POST' && path[0] === 'register') return await register(request, env);
    if (method === 'POST' && path[0] === 'login')    return await login(request, env);
    if (method === 'POST' && path[0] === 'logout')   return await logout(request, env);
    if (method === 'POST' && path[0] === 'validate') return await validate(request, env);
    if (method === 'GET'  && path[0] === 'users')    return await listUsers(request, env);
    if (method === 'DELETE' && path[0] === 'users' && path[2] === 'session') return await kickUser(request, env, path[1]);
    if (method === 'DELETE' && path[0] === 'users' && path.length === 2)     return await deleteUser(request, env, path[1]);
    return text('Not found', 404);
  } catch (err) {
    return text('Server error: ' + err.message, 500);
  }
}

function generateToken() {
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

function getToken(request) {
  const auth = request.headers.get('Authorization') || '';
  return auth.replace('Bearer ', '').trim() || null;
}

async function verifyToken(token, env) {
  if (!token) return null;
  return await env.DB.prepare(
    'SELECT s.token, s.username, u.is_admin FROM sessions s JOIN users u ON u.username = s.username WHERE s.token = ? AND s.expires_at > datetime("now")'
  ).bind(token).first();
}

async function register(request, env) {
  const body = await request.json();
  const username = String(body.username || '').trim().toLowerCase();
  const password = String(body.password || '').trim();

  if (!username || username.length < 2) return text('Username must be at least 2 characters', 400);
  if (username.length > 30) return text('Username too long (max 30 chars)', 400);
  if (!/^[a-zA-Z0-9_]+$/.test(username)) return text('Username can only contain letters, numbers, and underscores', 400);
  if (!password || password.length < 4) return text('Password must be at least 4 characters', 400);

  const existing = await env.DB.prepare('SELECT id FROM users WHERE username = ?').bind(username).first();
  if (existing) return text('Username already taken', 409);

  const isAdmin = username === ADMIN_USERNAME ? 1 : 0;
  const result = await env.DB.prepare(
    'INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, ?)'
  ).bind(username, password, isAdmin).run();

  const token = generateToken();
  const expires = new Date(Date.now() + SESSION_TTL_DAYS * 86400000).toISOString().replace('T', ' ').split('.')[0];
  await env.DB.prepare('INSERT INTO sessions (token, username, expires_at) VALUES (?, ?, ?)').bind(token, username, expires).run();

  return json({ id: result.meta.last_row_id, username, is_admin: !!isAdmin, token }, 201);
}

async function login(request, env) {
  const body = await request.json();
  const username = String(body.username || '').trim().toLowerCase();
  const password = String(body.password || '').trim();

  if (!username || !password) return text('Username and password required', 400);

  const user = await env.DB.prepare(
    'SELECT id, username, password_hash, is_admin FROM users WHERE username = ?'
  ).bind(username).first();

  if (!user || password !== user.password_hash) return text('Invalid username or password', 401);

  await env.DB.prepare('DELETE FROM sessions WHERE username = ?').bind(username).run();
  const token = generateToken();
  const expires = new Date(Date.now() + SESSION_TTL_DAYS * 86400000).toISOString().replace('T', ' ').split('.')[0];
  await env.DB.prepare('INSERT INTO sessions (token, username, expires_at) VALUES (?, ?, ?)').bind(token, username, expires).run();

  return json({ id: user.id, username: user.username, is_admin: !!user.is_admin, token });
}

async function logout(request, env) {
  const token = getToken(request);
  if (token) await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
  return text('ok');
}

async function validate(request, env) {
  const token = getToken(request);
  const session = await verifyToken(token, env);
  if (!session) return text('Invalid or expired session', 401);
  return json({ username: session.username, is_admin: !!session.is_admin, token });
}

async function listUsers(request, env) {
  const token = getToken(request);
  const session = await verifyToken(token, env);
  if (!session || !session.is_admin) return text('Forbidden', 403);
  const { results } = await env.DB.prepare(`
    SELECT u.id, u.username, u.password_hash, u.is_admin, u.created_at,
      CASE WHEN s.token IS NOT NULL THEN 1 ELSE 0 END as online
    FROM users u
    LEFT JOIN sessions s ON s.username = u.username AND s.expires_at > datetime('now')
    ORDER BY u.created_at DESC
  `).all();
  return json(results);
}

async function kickUser(request, env, username) {
  const token = getToken(request);
  const session = await verifyToken(token, env);
  if (!session || !session.is_admin) return text('Forbidden', 403);
  if (username === session.username) return text('Cannot kick yourself', 400);
  await env.DB.prepare('DELETE FROM sessions WHERE username = ?').bind(decodeURIComponent(username)).run();
  return text('ok');
}

async function deleteUser(request, env, username) {
  const token = getToken(request);
  const session = await verifyToken(token, env);
  if (!session || !session.is_admin) return text('Forbidden', 403);
  if (username === session.username) return text('Cannot delete yourself', 400);
  await env.DB.prepare('DELETE FROM sessions WHERE username = ?').bind(decodeURIComponent(username)).run();
  await env.DB.prepare('DELETE FROM users WHERE username = ?').bind(decodeURIComponent(username)).run();
  return text('ok');
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
function text(message, status = 200) {
  return new Response(message, { status });
}
