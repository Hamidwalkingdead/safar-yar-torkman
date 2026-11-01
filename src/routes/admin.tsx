import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { ShieldAlert } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { SharedSignIn, useSharedAuth } from "@/components/shared-auth";
import { useAccount } from "@/lib/account";
import { Badge, Btn, Card } from "@/components/ui-kit";
import { fa, toman } from "@/lib/fare";
import { statusLabel, type TripStatus } from "@/lib/store";
import { departureLabel } from "@/lib/shared-rides";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "پنل مدیر | سفر یار ترکمن" },
      { name: "description", content: "آمار سفرها و مدیریت تیکت‌های پشتیبانی برای مدیران." },
      { name: "robots", content: "noindex" },
      { property: "og:title", content: "پنل مدیر | سفر یار ترکمن" },
      { property: "og:description", content: "پنل مدیریت سفر یار ترکمن." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Admin,
});

const ticketStatus = { open: "ثبت شد", review: "در حال بررسی", resolved: "حل شد" } as const;

function Admin() {
  const { userId, ready } = useSharedAuth();
  const account = useAccount();
  if (!ready || (userId && account.isPending)) return <p className="p-4">در حال بررسی دسترسی…</p>;
  if (!userId)
    return (
      <div className="space-y-4 p-4">
        <h1 className="text-2xl font-black">پنل مدیر</h1>
        <SharedSignIn />
      </div>
    );
  if (!account.data?.isAdmin)
    return (
      <div className="p-4">
        <Card className="flex items-center gap-3">
          <ShieldAlert className="size-8 text-destructive" />
          <div>
            <b>دسترسی محدود</b>
            <p className="text-sm text-muted-foreground">این بخش فقط برای مدیران است.</p>
          </div>
        </Card>
      </div>
    );
  return <Dashboard />;
}

function Dashboard() {
  const cache = useQueryClient();
  const [filter, setFilter] = useState<TripStatus | "all">("all");
  const trips = useQuery({
    queryKey: ["admin-trips"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("trips")
        .select("id,passenger_name,origin,destination,departure_at,status,agreed_fare,commission,driver_id")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return data;
    },
  });
  const tickets = useQuery({
    queryKey: ["admin-tickets"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("support_tickets")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data;
    },
  });
  async function setTicket(id: string, status: string) {
    const { error } = await supabase.rpc("admin_set_ticket_status", {
      p_ticket: id,
      p_status: status,
    });
    if (error) return void toast.error("تغییر وضعیت انجام نشد");
    await cache.invalidateQueries({ queryKey: ["admin-tickets"] });
    toast.success("وضعیت تیکت به‌روز شد");
  }
  const list = trips.data ?? [];
  const count = (s: TripStatus) => list.filter((t) => t.status === s).length;
  const done = list.filter((t) => t.status === "done");
  const shown = filter === "all" ? list : list.filter((t) => t.status === filter);
  return (
    <div className="space-y-4 p-4">
      <h1 className="text-2xl font-black">پنل مدیر</h1>
      {trips.error && <p role="alert">دریافت سفرها ممکن نشد.</p>}
      <div className="grid grid-cols-3 gap-2 text-center">
        {(["pending", "accepted", "ongoing", "done", "cancelled"] as const).map((s) => (
          <Card key={s} className="p-3">
            <b className="block text-xl">{fa(count(s))}</b>
            <span className="text-xs">{statusLabel[s]}</span>
          </Card>
        ))}
        <Card className="p-3">
          <b className="block text-sm">{toman(done.reduce((a, t) => a + t.commission, 0))}</b>
          <span className="text-xs">کمیسیون سفرهای پایان‌یافته</span>
        </Card>
      </div>
      <div className="flex flex-wrap gap-2">
        {(["all", "pending", "accepted", "ongoing", "done", "cancelled"] as const).map((s) => (
          <Btn key={s} variant={filter === s ? "primary" : "ghost"} onClick={() => setFilter(s)}>
            {s === "all" ? "همه" : statusLabel[s]}
          </Btn>
        ))}
      </div>
      {shown.slice(0, 50).map((t) => (
        <Card key={t.id} className="space-y-1 text-sm">
          <div className="flex justify-between">
            <b>
              {t.origin} ← {t.destination}
            </b>
            <Badge>{statusLabel[t.status as TripStatus]}</Badge>
          </div>
          <p>
            {t.passenger_name} · {departureLabel(t.departure_at)} · {toman(t.agreed_fare)}
          </p>
        </Card>
      ))}
      <h2 className="pt-2 text-lg font-bold">تیکت‌های پشتیبانی ({fa(tickets.data?.length ?? 0)})</h2>
      {tickets.error && <p role="alert">دریافت تیکت‌ها ممکن نشد.</p>}
      {(tickets.data ?? []).map((t) => (
        <Card key={t.id} className="space-y-2 text-sm">
          <div className="flex justify-between">
            <b>{t.subject}</b>
            <Badge>{ticketStatus[t.status as keyof typeof ticketStatus] ?? t.status}</Badge>
          </div>
          <p className="text-muted-foreground">
            {t.category} · {departureLabel(t.created_at)}
          </p>
          <p>{t.body}</p>
          <div className="flex gap-2">
            {(Object.keys(ticketStatus) as (keyof typeof ticketStatus)[])
              .filter((s) => s !== t.status)
              .map((s) => (
                <Btn key={s} variant="ghost" onClick={() => void setTicket(t.id, s)}>
                  {ticketStatus[s]}
                </Btn>
              ))}
          </div>
        </Card>
      ))}
    </div>
  );
}
