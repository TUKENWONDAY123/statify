// functions/api/rooms/[[path]].js

export async function onRequest(context) {
  const { request, env, params } = context;
  const method = request.method;
  const path = (params.path || []).filter(Boolean);

  try {
    // POST /api/rooms — create a room
    if (method === 'POST' && path.length === 0) return await createRoom(request, env);

    // GET /api/rooms/:code — get room info + messages
    if (method === 'GET' && path.length === 1) return await getRoom(env, path[0].toUpperCase());

    // POST /api/rooms/:code/join — join a room
    if (method === 'POST' && path.length === 2 && path[1] === 'join') return await joinRoom(request, env, path[0].toUpperCase());

    // POST /api/rooms/:code/messages — send a message
    if (method === 'POST' && path.length === 2 && path[1] === 'messages') return await sendMessage(request, env, path[0].toUpperCase());

    // DELETE /api/rooms/:code — delete a room (admin or creator)
    if (method === 'DELETE' && path.length === 1) return await deleteRoom(request, env, path[0].toUpperCase());

    // DELETE /api/rooms/:code/messages/:id — delete a message (admin or own)
    if (method === 'DELETE' && path.length === 3 && path[1] === 'messages') return await deleteMessage(request, env, path[0].toUpperCase(), Number(path[2]));

    return text('Not found', 404);
  } catch (err) {
    return text('Server error: ' + err.message, 500);
  }
}

function generateCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

async function createRoom(request, env) {
  const body = await request.json();
  const name = String(body.name || '').trim();
  const created_by = String(body.created_by || '').trim();

  if (!name) return text('Room name is required', 400);
  if (!created_by) return text('Creator name is required', 400);
  if (name.length > 50) return text('Name too long (max 50 chars)', 400);

  // Generate unique 6-digit code
  let code, attempts = 0;
  do {
    code = generateCode();
    const existing = await env.DB.prepare('SELECT id FROM rooms WHERE code = ?').bind(code).first();
    if (!existing) break;
    attempts++;
  } while (attempts < 10);

  await env.DB.prepare(
    'INSERT INTO rooms (code, name, created_by) VALUES (?, ?, ?)'
  ).bind(code, name, created_by).run();

  return json({ code, name, created_by }, 201);
}

async function getRoom(env, code) {
  const room = await env.DB.prepare(
    'SELECT id, code, name, created_by, created_at FROM rooms WHERE code = ?'
  ).bind(code).first();

  if (!room) return text('Room not found', 404);

  const { results: messages } = await env.DB.prepare(`
    SELECT id, author, content, created_at
    FROM room_messages
    WHERE room_code = ?
    ORDER BY id ASC
  `).bind(code).all();

  return json({ ...room, messages });
}

async function joinRoom(request, env, code) {
  const room = await env.DB.prepare('SELECT id FROM rooms WHERE code = ?').bind(code).first();
  if (!room) return text('Room not found', 404);
  return json({ code });
}

async function sendMessage(request, env, code) {
  const room = await env.DB.prepare('SELECT id FROM rooms WHERE code = ?').bind(code).first();
  if (!room) return text('Room not found', 404);

  const body = await request.json();
  const author = String(body.author || '').trim();
  const content = String(body.content || '').trim();

  if (!author) return text('Author is required', 400);
  if (!content) return text('Message cannot be empty', 400);
  if (content.length > 1000) return text('Message too long', 400);

  const result = await env.DB.prepare(
    'INSERT INTO room_messages (room_code, author, content) VALUES (?, ?, ?)'
  ).bind(code, author, content).run();

  return json({ id: result.meta.last_row_id, author, content }, 201);
}

async function deleteRoom(request, env, code) {
  const body = await request.json().catch(() => ({}));
  const requester = String(body.requester || '').trim();
  const isAdmin = !!body.admin;

  const room = await env.DB.prepare('SELECT created_by FROM rooms WHERE code = ?').bind(code).first();
  if (!room) return text('Room not found', 404);

  if (!isAdmin && room.created_by.toLowerCase() !== requester.toLowerCase()) {
    return text('Not your room', 403);
  }

  await env.DB.prepare('DELETE FROM room_messages WHERE room_code = ?').bind(code).run();
  await env.DB.prepare('DELETE FROM rooms WHERE code = ?').bind(code).run();
  return text('ok');
}

async function deleteMessage(request, env, code, messageId) {
  const body = await request.json().catch(() => ({}));
  const requester = String(body.requester || '').trim();
  const isAdmin = !!body.admin;

  if (!isAdmin) {
    const msg = await env.DB.prepare(
      'SELECT author FROM room_messages WHERE id = ? AND room_code = ?'
    ).bind(messageId, code).first();
    if (!msg) return text('Message not found', 404);
    if (msg.author.toLowerCase() !== requester.toLowerCase()) return text('Not your message', 403);
  }

  await env.DB.prepare('DELETE FROM room_messages WHERE id = ? AND room_code = ?').bind(messageId, code).run();
  return text('ok');
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
function text(msg, status = 200) {
  return new Response(msg, { status });
}
