export async function onRequest(context) {
  const { request, env, params } = context;
  const method = request.method;
  const path = (params.path || []).filter(Boolean);

  try {
    // GET /api/polls
    if (method === "GET" && path.length === 0) {
      return await getPolls(env);
    }

    // POST /api/polls
    if (method === "POST" && path.length === 0) {
      return await createPoll(request, env);
    }

    // POST /api/polls/:id/vote
    if (method === "POST" && path.length === 2 && path[1] === "vote") {
      const pollId = Number(path[0]);
      return await votePoll(request, env, pollId);
    }

    // DELETE /api/polls/:id
    if (method === "DELETE" && path.length === 1) {
      const pollId = Number(path[0]);
      return await deletePoll(env, pollId);
    }

    return text("Not found", 404);
  } catch (err) {
    return text("Server error: " + err.message, 500);
  }
}

async function getPolls(env) {
  const { results: polls } = await env.DB.prepare(`
    SELECT id, question, image, created_at
    FROM polls
    ORDER BY id DESC
  `).all();

  const finalPolls = [];

  for (const poll of polls) {
    const { results: options } = await env.DB.prepare(`
      SELECT option_text, option_index
      FROM poll_options
      WHERE poll_id = ?
      ORDER BY option_index ASC
    `).bind(poll.id).all();

    const { results: votes } = await env.DB.prepare(`
      SELECT option_index, voter_name
      FROM poll_votes
      WHERE poll_id = ?
    `).bind(poll.id).all();

    const mappedOptions = options.map(opt => {
      const voters = votes
        .filter(v => Number(v.option_index) === Number(opt.option_index))
        .map(v => v.voter_name);

      return {
        text: opt.option_text,
        votes: voters.length,
        voters
      };
    });

    finalPolls.push({
      id: poll.id,
      question: poll.question,
      image: poll.image || null,
      created_at: poll.created_at,
      options: mappedOptions
    });
  }

  return json(finalPolls);
}

async function createPoll(request, env) {
  const body = await request.json();
  const question = String(body.question || "").trim();
  const options = Array.isArray(body.options)
    ? body.options.map(x => String(x || "").trim()).filter(Boolean)
    : [];
  // image is an optional base64 data URL string
  const image = body.image && typeof body.image === "string" ? body.image : null;

  if (!question) {
    return text("Question is required", 400);
  }
  if (options.length < 2) {
    return text("At least 2 options are required", 400);
  }
  if (options.length > 6) {
    return text("Maximum 6 options allowed", 400);
  }

  const insertPoll = await env.DB.prepare(`
    INSERT INTO polls (question, image)
    VALUES (?, ?)
  `).bind(question, image).run();

  const pollId = insertPoll.meta.last_row_id;

  for (let i = 0; i < options.length; i++) {
    await env.DB.prepare(`
      INSERT INTO poll_options (poll_id, option_text, option_index)
      VALUES (?, ?, ?)
    `).bind(pollId, options[i], i).run();
  }

  return text("ok", 201);
}

async function votePoll(request, env, pollId) {
  if (!pollId || Number.isNaN(pollId)) {
    return text("Invalid poll id", 400);
  }

  const body = await request.json();
  const optionIndex = Number(body.option_index);
  const voterName = String(body.voter_name || "").trim();

  if (Number.isNaN(optionIndex)) {
    return text("Invalid option index", 400);
  }
  if (!voterName) {
    return text("Voter name is required", 400);
  }

  const existingPoll = await env.DB.prepare(`
    SELECT id FROM polls WHERE id = ?
  `).bind(pollId).first();

  if (!existingPoll) {
    return text("Poll not found", 404);
  }

  const validOption = await env.DB.prepare(`
    SELECT id FROM poll_options
    WHERE poll_id = ? AND option_index = ?
  `).bind(pollId, optionIndex).first();

  if (!validOption) {
    return text("Invalid option", 400);
  }

  const existingVote = await env.DB.prepare(`
    SELECT id FROM poll_votes
    WHERE poll_id = ? AND lower(voter_name) = lower(?)
    LIMIT 1
  `).bind(pollId, voterName).first();

  if (existingVote) {
    return text("You already voted on this poll", 400);
  }

  await env.DB.prepare(`
    INSERT INTO poll_votes (poll_id, option_index, voter_name)
    VALUES (?, ?, ?)
  `).bind(pollId, optionIndex, voterName).run();

  return text("ok", 201);
}

async function deletePoll(env, pollId) {
  if (!pollId || Number.isNaN(pollId)) {
    return text("Invalid poll id", 400);
  }

  await env.DB.prepare(`DELETE FROM poll_votes WHERE poll_id = ?`).bind(pollId).run();
  await env.DB.prepare(`DELETE FROM poll_options WHERE poll_id = ?`).bind(pollId).run();
  await env.DB.prepare(`DELETE FROM polls WHERE id = ?`).bind(pollId).run();

  return text("ok");
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
