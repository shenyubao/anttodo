import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  authStorageKey,
  type AntTodoInstanceConfig,
} from "./instanceConfig";

export let hasSupabaseConfig = false;
export let supabase: SupabaseClient | null = null;

export function configureSupabase(config: AntTodoInstanceConfig | null) {
  hasSupabaseConfig = Boolean(config?.supabaseUrl && config.publishableKey);
  supabase = config
    ? createClient(config.supabaseUrl, config.publishableKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          ...(config.official ? {} : { storageKey: authStorageKey(config) }),
        },
        realtime: {
          params: { eventsPerSecond: 10 },
        },
      })
    : null;
  return supabase;
}
