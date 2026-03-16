export async function onRequest(context) {
  const { request, env, params } = context;
  const method = request.method;
  const path = (params.path || []).filter(Boolean);

  try {
    // GET /api/posts
    if (method === "GET" && path.length === 0) {
      return await getPosts(env);
    }

    // POST /api/posts
    if (method === "POST" && path.length === 0) {
      return await createPost(request, env);
    }

    // DELETE /api/posts/:id
    if (method === "DELETE" && path.length === 1) {
      return await deletePost(env, Number(path[0]), request);
    }

    // GET /api/posts/:id/comments
    if (method === "GET" && path.length === 2 && path[1] === "comments") {
      return await getComments(env, Number(path[0]));
    }

    // POST /api/posts/:id/comments
    if (method === "POST" && path.length === 2 && path[1] === "comments") {
      return await addComment(request, env, Number(path[0]));
    }

    // DELETE /api/posts/:id/comments/:commentId
    if (method === "DELETE" && path.length === 3 && path[1] === "comments") {
      return await deleteComment(request, env, Number(path[0]), Number(path[2]));
    }

    // POST /api/posts/:id/pin  (admin only — toggled server-side)
    if (method === "POST" && path.length === 2 && path[1] === "pin") {
      return await pinPost(request, env, Number(path[0]));
    }

    // POST /api/posts/:id/like
    if (method === "POST" && path.length === 2 && path[1] === "like") {
      return await likePost(request, env, Number(path[0]));
    }

    // DELETE /api/posts/:id/like
    if (method === "DELETE" && path.length === 2 && path[1] === "like") {
      return await unlikePost(request, env, Number(path[0]));
    }

    return text("Not found", 404);
  } catch (err) {
    return text("Server error: " + err.message, 500);
  }
}

// ── GET ALL POSTS with comment count and like count ──
async function getPosts(env) {
  const { results: posts } = await env.DB.prepare(`
    SELECT p.id, p.author, p.content, p.image, p.pinned, p.created_at,
      (SELECT COUNT(*) FROM post_comments c WHERE c.post_id = p.id) AS comment_count,
      (SELECT COUNT(*) FROM post_likes l WHERE l.post_id = p.id) AS like_count
    FROM posts p
    ORDER BY p.pinned DESC, p.id DESC
  `).all();

  return json(posts.map(p => ({
    id: p.id,
    author: p.author,
    content: p.content,
    image: p.image || null,
    pinned: !!p.pinned,
    created_at: p.created_at,
    comment_count: p.comment_count,
    like_count: p.like_count,
  })));
}

// ── CREATE POST ──
async function createPost(request, env) {
  const body = await request.json();
  const author = String(body.author || "").trim();
  const content = String(body.content || "").trim();
  const image = body.image && typeof body.image === "string" ? body.image : null;

  if (!author) return text("Author is required", 400);
  if (!content && !image) return text("Content or image is required", 400);

  const result = await env.DB.prepare(`
    INSERT INTO posts (author, content, image) VALUES (?, ?, ?)
  `).bind(author, content, image).run();

  return json({ id: result.meta.last_row_id }, 201);
}

// ── DELETE POST (admin or own post) ──
async function deletePost(env, postId, request) {
  if (!postId || isNaN(postId)) return text("Invalid post id", 400);
  const body = await request.json().catch(() => ({}));
  const requester = String(body.requester || "").trim();
  const isAdmin = !!body.admin;

  if (!isAdmin) {
    const post = await env.DB.prepare(`SELECT author FROM posts WHERE id = ?`).bind(postId).first();
    if (!post) return text("Post not found", 404);
    if (post.author.toLowerCase() !== requester.toLowerCase()) {
      return text("Not your post", 403);
    }
  }

  await env.DB.prepare(`DELETE FROM post_likes WHERE post_id = ?`).bind(postId).run();
  await env.DB.prepare(`DELETE FROM post_comments WHERE post_id = ?`).bind(postId).run();
  await env.DB.prepare(`DELETE FROM posts WHERE id = ?`).bind(postId).run();
  return text("ok");
}

// ── GET COMMENTS ──
async function getComments(env, postId) {
  if (!postId || isNaN(postId)) return text("Invalid post id", 400);
  const { results } = await env.DB.prepare(`
    SELECT id, post_id, author, content, created_at
    FROM post_comments
    WHERE post_id = ?
    ORDER BY id ASC
  `).bind(postId).all();
  return json(results);
}

// ── ADD COMMENT ──
async function addComment(request, env, postId) {
  if (!postId || isNaN(postId)) return text("Invalid post id", 400);
  const body = await request.json();
  const author = String(body.author || "").trim();
  const content = String(body.content || "").trim();
  if (!author) return text("Author is required", 400);
  if (!content) return text("Content is required", 400);

  const result = await env.DB.prepare(`
    INSERT INTO post_comments (post_id, author, content) VALUES (?, ?, ?)
  `).bind(postId, author, content).run();

  return json({ id: result.meta.last_row_id }, 201);
}

// ── DELETE COMMENT (own comment, or admin) ──
async function deleteComment(request, env, postId, commentId) {
  if (!postId || isNaN(postId)) return text("Invalid post id", 400);
  if (!commentId || isNaN(commentId)) return text("Invalid comment id", 400);

  const body = await request.json().catch(() => ({}));
  const requester = String(body.requester || "").trim();
  const adminDelete = !!body.admin;

  if (!adminDelete) {
    // Verify ownership
    const comment = await env.DB.prepare(`
      SELECT author FROM post_comments WHERE id = ? AND post_id = ?
    `).bind(commentId, postId).first();
    if (!comment) return text("Comment not found", 404);
    if (comment.author.toLowerCase() !== requester.toLowerCase()) {
      return text("Not your comment", 403);
    }
  }

  await env.DB.prepare(`DELETE FROM post_comments WHERE id = ? AND post_id = ?`)
    .bind(commentId, postId).run();
  return text("ok");
}

// ── PIN POST ──
async function pinPost(request, env, postId) {
  if (!postId || isNaN(postId)) return text("Invalid post id", 400);
  const body = await request.json();
  const pinned = body.pinned ? 1 : 0;
  await env.DB.prepare(`UPDATE posts SET pinned = ? WHERE id = ?`).bind(pinned, postId).run();
  return text("ok");
}

// ── LIKE POST ──
async function likePost(request, env, postId) {
  if (!postId || isNaN(postId)) return text("Invalid post id", 400);
  const body = await request.json();
  const liker = String(body.liker || "").trim();
  if (!liker) return text("Liker name required", 400);

  const existing = await env.DB.prepare(`
    SELECT id FROM post_likes WHERE post_id = ? AND lower(liker_name) = lower(?)
  `).bind(postId, liker).first();

  if (existing) return text("Already liked", 400);

  await env.DB.prepare(`
    INSERT INTO post_likes (post_id, liker_name) VALUES (?, ?)
  `).bind(postId, liker).run();

  const { count } = await env.DB.prepare(
    `SELECT COUNT(*) as count FROM post_likes WHERE post_id = ?`
  ).bind(postId).first();

  return json({ likes: count });
}

// ── UNLIKE POST ──
async function unlikePost(request, env, postId) {
  if (!postId || isNaN(postId)) return text("Invalid post id", 400);
  const body = await request.json();
  const liker = String(body.liker || "").trim();
  if (!liker) return text("Liker name required", 400);

  await env.DB.prepare(`
    DELETE FROM post_likes WHERE post_id = ? AND lower(liker_name) = lower(?)
  `).bind(postId, liker).run();

  const { count } = await env.DB.prepare(
    `SELECT COUNT(*) as count FROM post_likes WHERE post_id = ?`
  ).bind(postId).first();

  return json({ likes: count });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function text(message, status = 200) {
  return new Response(message, { status });
}
