import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export async function allowRequest(
  client: SupabaseClient,
  endpoint: "create-trip" | "neshan-route" | "neshan-reverse" | "neshan-search",
  limit: number,
): Promise<boolean> {
  const { data, error } = await client.rpc("consume_edge_api_rate_limit", {
    p_endpoint: endpoint,
    p_limit: limit,
    p_window_seconds: 60,
  });
  if (error) {
    console.error("Edge API rate limit check failed", endpoint, error.message);
    throw new Error("کنترل امنیتی درخواست در دسترس نیست؛ عملیات انجام نشد.");
  }
  return data === true;
}
