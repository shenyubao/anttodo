/**
 * Build Sentry `tracePropagationTargets`.
 *
 * Never include the Supabase project origin: Edge Functions only allow
 * `authorization, x-client-info, apikey, content-type, x-retry-count` in CORS.
 * Injecting `sentry-trace` / `baggage` makes the browser preflight fail, which
 * breaks public calls such as enterprise `sso-login` and QR login.
 */
export function buildSentryTracePropagationTargets(input: {
  publicAppUrl?: string;
}): Array<string | RegExp> {
  const targets: Array<string | RegExp> = ["localhost", /^\//];

  if (input.publicAppUrl) {
    try {
      targets.push(new URL(input.publicAppUrl).origin);
    } catch {
      // Ignore malformed env values; tracing still works for same-origin requests.
    }
  }

  return targets;
}
