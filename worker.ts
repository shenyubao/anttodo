type Assets = { fetch(request: Request): Promise<Response> };
export default {
  async fetch(request: Request, env: { ASSETS: Assets }): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/open/v1/")) return env.ASSETS.fetch(request);
    const manifestResponse = await env.ASSETS.fetch(new Request(new URL("/.well-known/anttodo.json", url), { method: "GET" }));
    const manifest = await manifestResponse.json() as { supabaseUrl?: string; publishableKey?: string };
    if (!manifest.supabaseUrl || !manifest.publishableKey) return Response.json({ code: "service_not_configured", message: "Open API is unavailable", request_id: crypto.randomUUID() }, { status: 503 });
    const target = new URL(manifest.supabaseUrl);
    target.pathname = `/functions/v1/open-api${url.pathname.slice("/api/open/v1".length)}`;
    target.search = url.search;
    const headers = new Headers(request.headers);
    headers.delete("host"); headers.set("x-anttodo-origin",url.origin); headers.set("apikey", manifest.publishableKey);
    return fetch(target, { method: request.method, headers, body: ["GET","HEAD"].includes(request.method) ? undefined : request.body, redirect: "manual" });
  },
};
