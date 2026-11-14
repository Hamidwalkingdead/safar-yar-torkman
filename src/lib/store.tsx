import { createContext, useContext, useEffect, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSharedAuth } from "@/components/shared-auth";
import type { Database } from "@/integrations/supabase/types";
import type { TripStatus } from "./trip-rules";
import { createTripFromRoute } from "./trip.functions";
import type { Point } from "./geo";
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
  originPoint: Point;
  destinationPoint: Point;
  mountain: boolean;
  suggested?: number;
  paymentMethod?: "cash" | "wallet";
  rideType: "urban" | "intercity" | "suburban";
};
type Ctx = {
  trips: Trip[];
  tickets: Ticket[];
  ticketsLoading: boolean;
  ticketsError: string;
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
    // RLS hides an accepted row from losing drivers, so their UPDATE event may
    // not arrive. Keep polling even while a Realtime channel is subscribed.
    refetchInterval: 5000,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
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
    refetchInterval: 15000,
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
  });
  const refresh = () => {
    void cache.invalidateQueries({ queryKey: ["trips"] });
    void cache.invalidateQueries({ queryKey: ["contacts"] });
    void cache.invalidateQueries({ queryKey: ["trip-events"] });
  };
  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`trips-${userId}-${crypto.randomUUID()}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "trips" }, () => {
        void cache.invalidateQueries({ queryKey: ["trips"] });
        void cache.invalidateQueries({ queryKey: ["contacts"] });
        void cache.invalidateQueries({ queryKey: ["trip-events"] });
      })
      .subscribe(() => {
        // Re-fetch on initial connection, recovery, and failed subscriptions.
        void cache.invalidateQueries({ queryKey: ["trips"] });
      });
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId, cache]);
  async function setStatus(id: string, status: TripStatus) {
    const { error } = await supabase.rpc("change_trip_status", { p_trip: id, p_status: status });
    // Refresh on conflicts as well as success, including the driver's offers.
    await cache.invalidateQueries({ queryKey: ["trips"] });
    await cache.invalidateQueries({ queryKey: ["contacts"] });
    await cache.invalidateQueries({ queryKey: ["trip-events"] });
    if (error) throw new Error(error.message);
  }
  const value: Ctx = {
    trips: userId ? (trips.data ?? []) : [],
    tickets: userId ? (tickets.data ?? []) : [],
    ticketsLoading: !!userId && tickets.isPending,
    ticketsError: tickets.error ? "دریافت تیکت‌ها ممکن نشد؛ دوباره تلاش کنید." : "",
    loading: !!userId && trips.isPending,
    error: trips.error ? "دریافت سفرها ممکن نشد؛ دوباره تلاش کنید." : "",
    refresh,
    setStatus,
    accept: (id) => setStatus(id, "accepted"),
    addTrip: async (t) => {
      const result = await createTripFromRoute({
        data: {
          origin: t.originPoint,
          destination: t.destinationPoint,
          originName: t.from,
          destinationName: t.to,
          departure: t.departure,
          mountain: t.mountain,
          suggested: t.suggested ?? null,
          paymentMethod: t.paymentMethod ?? "cash",
          rideType: t.rideType,
        },
      });
      await cache.invalidateQueries({ queryKey: ["trips"] });
      return result.id;
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
