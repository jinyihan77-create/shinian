import type { SupabaseClient } from "@supabase/supabase-js";

// Both Supabase and CloudBase PostgreSQL expose the PostgREST data protocol.
// Authentication remains provider-specific; no administrative credentials belong here.
export type DataClient = Pick<SupabaseClient, "from" | "rpc">;
