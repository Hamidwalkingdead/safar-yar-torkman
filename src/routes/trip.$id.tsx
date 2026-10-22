import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Badge, Btn, Card, DemoNote, FareTable } from "@/components/ui-kit";
import { toman } from "@/lib/fare";
import { useStore, statusLabel, type TripStatus } from "@/lib/store";
import { useSharedAuth, SharedSignIn } from "@/components/shared-auth";
import { supabase } from "@/integrations/supabase/client";
import { allowedTransition, contactsVisible } from "@/lib/trip-rules";
import { departureLabel } from "@/lib/shared-rides";
type Contact = { name: string; phone: string; car?: string; plate?: string };
export const Route = createFileRoute("/trip/$id")({
  validateSearch: (s: Record<string, unknown>) => ({
    as: s["as"] === "driver" ? ("driver" as const) : ("passenger" as const),
  }),
  head: () => ({
    meta: [
      { title: "جزئیات سفر | سفر یار ترکمن" },
      { name: "description", content: "وضعیت سفر، اطلاعات طرفین و جزئیات کرایه و کمیسیون." },
      { property: "og:title", content: "جزئیات سفر | سفر یار ترکمن" },
      { property: "og:description", content: "وضعیت و جزئیات سفر در سفر یار ترکمن." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Trip,
});

function Trip() {
  const { id } = Route.useParams();
  const { userId } = useSharedAuth();
  const { trips, setStatus, loading, error, refresh } = useStore();
  const [busy, setBusy] = useState(false);
  const t = trips.find((x) => x.id === id);
  const participant = !!userId && !!t && (t.passenger_id === userId || t.driver_id === userId);
  const contact = useQuery({
    queryKey: ["contacts", id, userId, t?.status],
    enabled: !!t && contactsVisible(t.status as TripStatus, participant),
    queryFn: async () => {
      const { data, error } = await supabase.rpc("trip_contacts", { p_trip: id });
      if (error) throw error;
      return data as unknown as { passenger?: Contact; driver?: Contact };
    },
  });
  const events = useQuery({
    queryKey: ["trip-events", id, t?.status, userId],
    enabled: participant,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("trip_events")
        .select("*")
        .eq("trip_id", id)
        .order("created_at");
      if (error) throw error;
      return data ?? [];
    },
  });
  if (!userId)
    return (
      <div className="p-4">
        <SharedSignIn />
      </div>
    );
  if (!t)
    return (
      <div className="p-4">
        {loading ? "در حال دریافت…" : error || "سفر پیدا نشد یا دسترسی ندارید."}
        <Btn onClick={refresh}>تازه‌سازی</Btn>
      </div>
    );
  const party = t.driver_id === userId ? "driver" : "passenger";
  async function update(status: TripStatus) {
    setBusy(true);
    try {
      await setStatus(id, status);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "تغییر انجام نشد");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-4 p-4">
      <div className="flex justify-between">
        <h1 className="text-2xl font-black">جزئیات سفر</h1>
        <Badge>{statusLabel[t.status as TripStatus]}</Badge>
      </div>
      <p className="break-all text-xs text-muted-foreground">{t.id}</p>
      <Card>
        <b>
          {t.from} ← {t.to}
        </b>
        <p>{departureLabel(t.departure_at)}</p>
      </Card>
      <Card className="space-y-3">
        <b>مسافر: {t.passengerName}</b>
        {contactsVisible(t.status as TripStatus, participant) ? (
          contact.data ? (
            <>
              {[contact.data.passenger, contact.data.driver].map(
                (p, i) =>
                  p && (
                    <div key={i} className="border-t border-border pt-3">
                      <p>
                        {i === 0 ? "مسافر" : "راننده"}: {p.name}
                      </p>
                      {p.car && (
                        <p>
                          {p.car} · {p.plate}
                        </p>
                      )}
                      <a className="text-primary" href={`tel:${p.phone}`}>
                        {p.phone}
                      </a>
                      <span className="mr-2 text-xs text-muted-foreground">تماس با شماره</span>
                    </div>
                  ),
              )}
            </>
          ) : (
            <p>{contact.error ? "دریافت تماس ممکن نشد" : "در حال دریافت شماره‌ها…"}</p>
          )
        ) : (
          <p className="text-sm text-muted-foreground">
            اطلاعات تماس تا پذیرش سفر پنهان است؛ سفر لغوشده اطلاعات تماس ندارد.
          </p>
        )}
      </Card>
      <Card>
        <FareTable
          km={t.km}
          night={t.night}
          mountain={t.mountain}
          agreed={t.suggested ?? undefined}
        />
        <p>کرایه ثبت‌شده: {toman(t.agreed_fare)}</p>
        <p>کمیسیون ثبت‌شده: {toman(t.commission)}</p>
        <p>سهم راننده: {toman(t.driver_net)}</p>
      </Card>
      {participant && (
        <div className="grid gap-2">
          {(
            [
              ["ongoing", "شروع سفر"],
              ["done", "پایان سفر"],
              ["cancelled", "لغو سفر"],
            ] as [TripStatus, string][]
          )
            .filter(([next]) => allowedTransition(t.status as TripStatus, next, party))
            .map(([next, label]) => (
              <Btn key={next} disabled={busy} onClick={() => update(next)}>
                {label}
              </Btn>
            ))}
        </div>
      )}
      <Btn variant="ghost" onClick={refresh}>
        تازه‌سازی
      </Btn>
      {participant && (
        <section>
          <h2 className="font-bold">سوابق وضعیت و کرایه</h2>
          {events.data?.map((e) => (
            <p key={e.id} className="py-2 text-sm">
              {statusLabel[e.status as TripStatus]} ·{" "}
              {new Date(e.created_at).toLocaleString("fa-IR")} · {toman(e.agreed_fare)}
            </p>
          ))}
        </section>
      )}
      <Link to="/support" className="block text-primary">
        گزارش مشکل سفر
      </Link>
      <DemoNote>
        پرداخت آنلاین فعال نیست و پایان سفر به معنی وصول وجه نیست. نقشه و مسافت خودکار هنوز متصل
        نشده‌اند؛ مسافت واردشده مبنای محاسبه است.
      </DemoNote>
    </div>
  );
}
