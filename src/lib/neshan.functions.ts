import { supabase } from "@/integrations/supabase/client";
import type { Point, RouteResult } from "./geo";

type InvokeError = { context?: Response };

async function edgeError(error: unknown): Promise<{ error?: string; reason?: string } | null> {
  const response = (error as InvokeError | null)?.context;
  if (!response) return null;
  try {
    return await response.clone().json() as { error?: string; reason?: string };
  } catch {
    return null;
  }
}

/** Calls the authenticated Supabase Edge Function; no TanStack server runtime is needed in the APK. */
export async function neshanRoute({ data }: { data: { origin: Point; destination: Point } }): Promise<RouteResult> {
  const { data: result, error } = await supabase.functions.invoke<RouteResult>("neshan-route", { body: data });
  if (error) {
    const payload = await edgeError(error);
    if (payload?.reason === "missing_key" || payload?.error?.includes("کلید"))
      return { ok: false, reason: "missing_key" };
    if (payload?.reason === "no_route") return { ok: false, reason: "no_route" };
    return { ok: false, reason: "failed" };
  }
  return result ?? { ok: false, reason: "failed" };
}

export async function neshanReverse({ data }: { data: Point }): Promise<string> {
  const { data: result, error } = await supabase.functions.invoke<{ name?: string }>("neshan-reverse", { body: data });
  if (error) return "";
  return result?.name ?? "";
}

export async function neshanSearch({ data }: { data: { q: string } }): Promise<(Point & { name: string }) | null> {
  const { data: result, error } = await supabase.functions.invoke<{ place?: (Point & { name: string }) | null }>("neshan-search", { body: data });
  if (error) return null;
  return result?.place ?? null;
}

/** Public map key; restrict this key to the app's web origins in the Neshan console. */
export function neshanMapKey(): string | null {
  return import.meta.env.VITE_NESHAN_MAP_KEY || null;
}

