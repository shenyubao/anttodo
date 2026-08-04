interface Env {
  ASSETS: {
    fetch(request: Request): Promise<Response>;
  };
}

const SECURITY_HEADERS = {
  "Content-Security-Policy": [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "connect-src 'self' https://anttodo-yuce.oss-cn-hangzhou.aliyuncs.com",
    "frame-src https://app.anttodo.com",
    "font-src 'self'",
    "base-uri 'self'",
    "form-action 'self' https://app.anttodo.com",
    "frame-ancestors 'none'",
  ].join("; "),
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
} as const;

export function canonicalLandingRedirect(request: Request): string | null {
  const url = new URL(request.url);
  const requestHostname = request.headers.get("host")?.split(":", 1)[0] ?? url.hostname;
  if (url.hostname !== "www.anttodo.com" && requestHostname !== "www.anttodo.com") {
    return null;
  }
  url.protocol = "https:";
  url.hostname = "anttodo.com";
  url.port = "";
  return url.toString();
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const redirectUrl = canonicalLandingRedirect(request);
    if (redirectUrl) return Response.redirect(redirectUrl, 308);

    if (url.pathname === "/api/downloads/macos") {
      const manifest = await fetch(
        "https://anttodo-yuce.oss-cn-hangzhou.aliyuncs.com/release/macos/latest.json",
        {
          headers: { Accept: "application/json" },
        },
      );
      if (!manifest.ok) {
        return new Response(JSON.stringify({ error: "manifest_unavailable" }), {
          status: 502,
          headers: { "Content-Type": "application/json; charset=utf-8" },
        });
      }
      return new Response(manifest.body, {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "public, max-age=300, stale-while-revalidate=3600",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }

    const response = await env.ASSETS.fetch(request);
    const headers = new Headers(response.headers);
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      headers.set(name, value);
    }
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  },
};
