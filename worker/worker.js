// Cloudflare Worker: receives the colour selection from the website and
// pushes it to the clinic's LINE (admin user or group) via the Messaging API.
// Secrets (set with `wrangler secret put`): LINE_TOKEN, LINE_TO
// Variable (wrangler.toml): ALLOWED_ORIGIN

export default {
  async fetch(req, env) {
    const origin = env.ALLOWED_ORIGIN || "";
    const cors = {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Vary": "Origin"
    };
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: cors });
    if (req.headers.get("Origin") !== origin) return new Response("Forbidden", { status: 403, headers: cors });

    let text = "";
    try { text = String((await req.json()).text || "").trim(); } catch (e) {}
    if (!text || text.length > 2000) return new Response("Bad Request", { status: 400, headers: cors });

    const r = await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + env.LINE_TOKEN },
      body: JSON.stringify({ to: env.LINE_TO, messages: [{ type: "text", text }] })
    });
    return new Response(r.ok ? "ok" : "line error " + r.status, { status: r.ok ? 200 : 502, headers: cors });
  }
};
