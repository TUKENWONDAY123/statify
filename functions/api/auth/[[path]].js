// functions/api/auth/[[path]].js

const ADMIN_USERNAME = 'waleed'; // change this to whatever you want your admin username to be

export async function onRequest(context) {
  const { request, env, params } = context;
  const method = request.method;
  const path = (params.path || []).filter(Boolean);

  try {
    // POST /api/auth/register
    if (method === 'POST' && path[0] === 'register') {
      return await register(request, env);
    }
    // POST /api/auth/login
    if (method === 'POST' && path[0] === 'login') {
      return await login(request, env);
    }
    return text('Not found', 404);
  } catch (err) {
    return text('Server error: ' + err.message, 500);
  }
}

async function hashPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

async function register(request, env) {
  const body = await request.json();
  const username = String(body.username || '').trim().toLowerCase();
  const password = String(body.password || '').trim();

  if (!username || username.length < 2) return text('Username must be at least 2 characters', 400);
  if (username.length > 30) return text('Username too long (max 30 chars)', 400);
  if (!/^[a-zA-Z0-9_]+$/.test(username)) return text('Username can only contain letters, numbers, and underscores', 400);
  if (!password || password.length < 4) return text('Password must be at least 4 characters', 400);

  const existing = await env.DB.prepare(
    'SELECT id FROM users WHERE username = ?'
  ).bind(username).first();

  if (existing) return text('Username already taken', 409);

  const hashed = await hashPassword(password);
  const isAdmin = username === ADMIN_USERNAME ? 1 : 0;

  const result = await env.DB.prepare(
    'INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, ?)'
  ).bind(username, hashed, isAdmin).run();

  return json({
    id: result.meta.last_row_id,
    username,
    is_admin: !!isAdmin,
  }, 201);
}

async function login(request, env) {
  const body = await request.json();
  const username = String(body.username || '').trim().toLowerCase();
  const password = String(body.password || '').trim();

  if (!username || !password) return text('Username and password required', 400);

  const user = await env.DB.prepare(
    'SELECT id, username, password_hash, is_admin FROM users WHERE username = ?'
  ).bind(username).first();

  if (!user) return text('Invalid username or password', 401);

  const hashed = await hashPassword(password);
  if (hashed !== user.password_hash) return text('Invalid username or password', 401);

  return json({
    id: user.id,
    username: user.username,
    is_admin: !!user.is_admin,
  });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function text(message, status = 200) {
  return new Response(message, { status });
}
