import { useQuery } from "@tanstack/react-query";
import { useSharedAuth } from "@/components/shared-auth";
import { supabase } from "@/integrations/supabase/client";
export function useAccount(){const {userId}=useSharedAuth();return useQuery({queryKey:["account",userId],enabled:!!userId,queryFn:async()=>{const [profile,roles]=await Promise.all([supabase.from("profiles").select("*").eq("id",userId??"").single(),supabase.from("user_roles").select("role").eq("user_id",userId??"")]);if(profile.error)throw profile.error;if(roles.error)throw roles.error;return {profile:profile.data,isDriver:roles.data.some(r=>r.role==="driver")};}});}
