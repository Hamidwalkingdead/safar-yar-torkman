import { createContext, useContext, useEffect, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSharedAuth } from "@/components/shared-auth";
import type { Database } from "@/integrations/supabase/types";
import type { TripStatus } from "./trip-rules";
export type { TripStatus } from "./trip-rules";
export type Trip = Database["public"]["Tables"]["trips"]["Row"] & {
  from: string;
  to: string;
  passengerName: string;
};
export type Ticket = Database["public"]["Tables"]["support_tickets"]["Row"];
type Input = {
  from: string;
  to: string;
  departure: string;
  km: number;
  night: boolean;
  mountain: boolean;
  suggested?: number;
};
type Ctx = {
  trips: Trip[];
  tickets: Ticket[];
  loading: boolean;
  error: string;
  addTrip: (input: Input) => Promise<string>;
  setStatus: (id: string, status: TripStatus) => Promise<void>;
  accept: (id: string) => Promise<void>;
  addTicket: (t: { subject: string; category: string; body: string }) => Promise<void>;
  refresh: () => void;
};
const C = createContext<Ctx | null>(null);
export function StoreProvider({ children }: { children: ReactNode }) {
  const { userId } = useSharedAuth();
  const cache = useQueryClient();
  const trips = useQuery({
    queryKey: ["trips", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("trips")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((t) => ({
        ...t,
        from: t.origin,
        to: t.destination,
        passengerName: t.passenger_name,
      }));
    },
    refetchInterval: 15000,
  });
  const tickets = useQuery({
    queryKey: ["tickets", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("support_tickets")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
  const refresh = () => {
    void cache.invalidateQueries({ queryKey: ["trips"] });
    void cache.invalidateQueries({ queryKey: ["contacts"] });
  };
  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`trips-${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "trips" }, () => {
        void cache.invalidateQueries({ queryKey: ["trips"] });
        void cache.invalidateQueries({ queryKey: ["contacts"] });
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId, cache]);
  async function setStatus(id: string, status: TripStatus) {
    const { error } = await supabase.rpc("change_trip_status", { p_trip: id, p_status: status });
    if (error) throw new Error(error.message);
    await cache.invalidateQueries({ queryKey: ["trips"] });
    await cache.invalidateQueries({ queryKey: ["contacts"] });
  }
  const value: Ctx = {
    trips: userId ? (trips.data ?? []) : [],
    tickets: userId ? (tickets.data ?? []) : [],
    loading: !!userId && trips.isPending,
    error: trips.error ? "دریافت سفرها ممکن نشد؛ دوباره تلاش کنید." : "",
    refresh,
    setStatus,
    accept: (id) => setStatus(id, "accepted"),
    addTrip: async (t) => {
      const { data, error } = await supabase.rpc("create_trip", {
        p_origin: t.from,
        p_destination: t.to,
        p_departure: t.departure,
        p_km: t.km,
        p_night: t.night,
        p_mountain: t.mountain,
        ...(t.suggested === undefined ? {} : { p_suggested: t.suggested }),
      });
      if (error) throw new Error(error.message);
      await cache.invalidateQueries({ queryKey: ["trips"] });
      return data;
    },
    addTicket: async (t) => {
      const { error } = await supabase.from("support_tickets").insert(t);
      if (error) throw new Error(error.message);
      await cache.invalidateQueries({ queryKey: ["tickets"] });
    },
  };
  return <C.Provider value={value}>{children}</C.Provider>;
}
export function useStore() {
  const value = useContext(C);
  if (!value) throw new Error("Store unavailable");
  return value;
}
export const statusLabel: Record<TripStatus, string> = {
  pending: "در انتظار راننده",
  accepted: "پذیرفته شد",
  ongoing: "در حال سفر",
  done: "پایان یافته",
  cancelled: "لغو شده",
};
