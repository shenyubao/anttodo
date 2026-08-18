import * as Sentry from "@sentry/react";
import { buildSentryTracePropagationTargets } from "./lib/sentryTraceTargets";
import type { AntTodoInstanceConfig } from "./lib/instanceConfig";

let initialized = false;

export function initializeSentry(config: AntTodoInstanceConfig | null) {
  if (initialized) return;
  initialized = true;
  Sentry.init({
    dsn: "https://6127dda84e70e410d3713c5b8f70df67@sentry.spiderhero.cc/7",
    environment: import.meta.env.MODE,
    integrations: [Sentry.browserTracingIntegration()],
    tracesSampleRate: 1.0,
    // Supabase must stay out of this list — see buildSentryTracePropagationTargets.
    tracePropagationTargets: buildSentryTracePropagationTargets({
      publicAppUrl: config?.appUrl,
    }),
    initialScope: config ? { tags: { instanceId: config.instanceId } } : undefined,
    enableLogs: true,
    // Avoid polluting Sentry during Vitest runs.
    enabled: import.meta.env.MODE !== "test",
  });
}
