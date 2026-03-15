export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === "GET") {
    try {
      const { results } = await env.DB.prepare(
        "SELECT id, author, content, created_at FROM posts ORDER BY id DESC"
      ).all();

      return new Response(JSON.stringify(results), {
        headers: {
          "Content-Type": "application/json"
        }
      });
    } catch (error) {
      return new Response("Failed to fetch posts", { status: 500 });
    }
  }

  if (request.method === "POST") {
    try {
      const body = await request.json();
      const author = (body.author || "").trim();
      const content = (body.content || "").trim();

      if (!author || !content) {
        return new Response("Author and content are required", { status: 400 });
      }

      await env.DB.prepare(
        "INSERT INTO posts (author, content) VALUES (?, ?)"
      )
        .bind(author, content)
        .run();

      return new Response("Post saved", { status: 201 });
    } catch (error) {
      return new Response("Failed to save post", { status: 500 });
    }
  }

  return new Response("Method not allowed", { status: 405 });
}
