import { supabase } from "@/integrations/supabase/client";
import type { SharedRide } from "./shared-rides";

export async function listSharedRides(): Promise<SharedRide[]> {
  const { data, error } = await supabase.rpc("shared_listing");
  if (error) throw new Error("دریافت فهرست سفرها ممکن نشد");
  return (data ?? []) as unknown as SharedRide[];
}
