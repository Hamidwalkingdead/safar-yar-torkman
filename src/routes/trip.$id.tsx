import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Badge, Btn, Card, DemoNote, FareTable } from "@/components/ui-kit";
import { toman } from "@/lib/fare";
import { useStore, statusLabel, type TripStatus } from "@/lib/store";
import { useSharedAuth, SharedSignIn } from "@/components/shared-auth";
import { supabase } from "@/integrations/supabase/client";
import { allowedTransition, contactsVisible, tripParty } from "@/lib/trip-rules";
import { departureLabel } from "@/lib/shared-rides";
import { TripChat } from "@/components/trip-chat";
import { TripLiveTracking } from "@/components/trip-live-tracking";
import { neshanRoute } from "@/lib/neshan.functions";
import { billingFeatures } from "@/lib/billing-config";
type Contact = {
  name: string; phone: string; car?: string; plate?: string;
  photoPath?: string | null; ratingAverage?: number | null; ratingCount?: number; myRating?: number | null;
};
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
  const [selectedRating, setSelectedRating] = useState(0);
  const [ratingBusy, setRatingBusy] = useState(false);
  const t = trips.find((x) => x.id === id);
  const party = t ? tripParty(t, userId) : null;
  const participant = party !== null;
  const origin = t?.origin_lat != null && t.origin_lng != null
    ? { lat: t.origin_lat, lng: t.origin_lng, name: t.origin }
    : null;
  const destination = t?.destination_lat != null && t.destination_lng != null
    ? { lat: t.destination_lat, lng: t.destination_lng, name: t.destination }
    : null;
  const routeQuery = useQuery({
    queryKey: ["trip-route", id, t?.origin_lat, t?.origin_lng, t?.destination_lat, t?.destination_lng],
    enabled: !!t && (t.status === "pending" || t.status === "accepted" || t.status === "ongoing") && !!origin && !!destination,
    queryFn: async () => {
      const result = await neshanRoute({
        data: {
          origin: { lat: origin!.lat, lng: origin!.lng },
          destination: { lat: destination!.lat, lng: destination!.lng },
        },
      });
      if (!result.ok) throw new Error(result.reason);
      return result.geometry;
    },
  });
  const routeGeometry = routeQuery.data ?? null;
  const contact = useQuery({
    queryKey: ["contacts", id, userId, t?.status],
    enabled: !!t && contactsVisible(t.status as TripStatus, participant),
    queryFn: async () => {
      const { data, error } = await supabase.rpc("trip_contacts", { p_trip: id });
      if (error) throw error;
      return data as unknown as { passenger?: Contact; driver?: Contact };
    },
  });
  const driverPhoto = useQuery({
    queryKey: ["trip-driver-selfie", id, contact.data?.driver?.photoPath],
    enabled: !!contact.data?.driver?.photoPath && participant,
    queryFn: async () => {
      const path = contact.data?.driver?.photoPath;
      if (!path) return null;
      const { data, error } = await supabase.storage.from("driver-documents").createSignedUrl(path, 3600);
      if (error) throw error;
      return data.signedUrl;
    },
    refetchInterval: 45 * 60 * 1000,
  });
  const driverLocation = useQuery({
    queryKey: ["trip-driver-location", id, t?.driver_id, t?.status],
    enabled: !!t?.driver_id && party === "passenger" && (t.status === "accepted" || t.status === "ongoing"),
    queryFn: async () => {
      const { data, error } = await supabase.from("trip_locations")
        .select("latitude,longitude,updated_at")
        .eq("trip_id", id).eq("user_id", t!.driver_id!).maybeSingle();
      if (error) throw error;
      return data;
    },
    refetchInterval: 10000,
  });
  const etaTarget = t?.status === "ongoing" ? destination : origin;
  const etaPoint = driverLocation.data
    ? { lat: Math.round(driverLocation.data.latitude * 100) / 100, lng: Math.round(driverLocation.data.longitude * 100) / 100 }
    : null;
  const etaQuery = useQuery({
    queryKey: ["trip-driver-eta", id, etaPoint?.lat, etaPoint?.lng, etaTarget?.lat, etaTarget?.lng, t?.status],
    enabled: !!etaPoint && !!etaTarget && party === "passenger" && (t?.status === "accepted" || t?.status === "ongoing"),
    queryFn: async () => {
      const result = await neshanRoute({ data: { origin: etaPoint!, destination: etaTarget! } });
      if (!result.ok) throw new Error(result.reason);
      return result.durationMinutes;
    },
    refetchInterval: 60 * 1000,
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
  if (!party)
    return (
      <div className="p-4" role="alert">
        جزئیات این سفر فقط برای مسافر و راننده پذیرفته‌شده در دسترس است.
      </div>
    );
  async function submitRating() {
    if (!t || party !== "passenger" || t.status !== "done" || selectedRating < 1 || selectedRating > 5 || ratingBusy) return;
    setRatingBusy(true);
    const { error } = await supabase.rpc("submit_driver_rating", { p_trip: id, p_stars: selectedRating });
    setRatingBusy(false);
    if (error) return void toast.error(error.message || "ثبت امتیاز انجام نشد");
    setSelectedRating(0);
    await contact.refetch();
    toast.success("امتیاز شما برای راننده ثبت شد");
  }
  async function update(status: TripStatus) {
    if (!t) return;
    if (status === "cancelled" && party === "passenger" && t.status === "accepted" && t.driver_id) {
      const penalty = Math.round(t.agreed_fare * 0.2);
      const platformShare = Math.round(penalty * 0.1);
      const driverShare = penalty - platformShare;
      const settlement = billingFeatures.wallet && t.payment_method === "wallet"
        ? "این مبلغ از کرایه رزروشده کیف پول کسر می‌شود."
        : "این مبلغ به‌عنوان بدهی به درخواست سفر بعدی شما اضافه می‌شود؛ در نسخه فعلی تسویه نقدی است و برداشت کیف پول انجام نمی‌شود.";
      const confirmed = window.confirm(
        `لغو سفر پس از پذیرش راننده شامل جریمه ۲۰٪ است.\n\nجریمه: ${toman(penalty)}\nسهم راننده (۹۰٪): ${toman(driverShare)}\nسهم سامانه (۱۰٪): ${toman(platformShare)}\n\n${settlement}\n\nآیا سفر را لغو می‌کنید؟`
      );
      if (!confirmed) return;
    }
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
        <p>زمان حرکت: {departureLabel(t.departure_at)} · ثبت درخواست: {departureLabel(t.created_at)}</p>
      </Card>
      <Card className="space-y-3">
        <b>مسافر: {t.passengerName}</b>
        {contactsVisible(t.status as TripStatus, participant) ? (
          contact.data ? (
            <>
              {contact.data.passenger && (
                <div className="border-t border-border pt-3">
                  <p>مسافر: {contact.data.passenger.name}</p>
                  <a className="text-primary" href={`tel:${contact.data.passenger.phone}`}>{contact.data.passenger.phone}</a>
                </div>
              )}
              {contact.data.driver && (
                <div className="space-y-2 border-t border-border pt-3">
                  <div className="flex items-center gap-3">
                    {driverPhoto.data ? (
                      <img src={driverPhoto.data} alt="تصویر راننده" className="size-16 rounded-full object-cover" />
                    ) : (
                      <div className="grid size-16 place-items-center rounded-full bg-muted text-2xl" aria-label="تصویر راننده">👤</div>
                    )}
                    <div>
                      <p className="font-bold">راننده: {contact.data.driver.name}</p>
                      {contact.data.driver.ratingCount ? (
                        <p className="text-sm text-amber-600">★ {Number(contact.data.driver.ratingAverage ?? 0).toFixed(1)} · {contact.data.driver.ratingCount} امتیاز</p>
                      ) : (
                        <p className="text-xs text-muted-foreground">هنوز امتیازی ثبت نشده</p>
                      )}
                    </div>
                  </div>
                  {contact.data.driver.car && <p>{contact.data.driver.car} · پلاک {contact.data.driver.plate}</p>}
                  <a className="text-primary" href={`tel:${contact.data.driver.phone}`}>{contact.data.driver.phone}</a>
                  <span className="mr-2 text-xs text-muted-foreground">تماس با راننده</span>
                  {driverPhoto.error && <p className="text-xs text-muted-foreground">تصویر راننده فعلاً بارگذاری نشد.</p>}
                </div>
              )}
            </>
          ) : (
            <p>{contact.error ? "دریافت اطلاعات تماس ممکن نشد" : "در حال دریافت اطلاعات طرفین…"}</p>
          )
        ) : (
          <p className="text-sm text-muted-foreground">
            اطلاعات تماس تا پذیرش سفر پنهان است؛ سفر لغوشده اطلاعات تماس ندارد.
          </p>
        )}
        {party === "passenger" && (t.status === "accepted" || t.status === "ongoing") && (
          <div className="rounded-xl bg-muted p-3 text-sm">
            <b>زمان رسیدن تخمینی راننده</b>
            {etaQuery.data != null ? (
              <p className="mt-1">حدود {Math.max(1, Math.round(etaQuery.data))} دقیقه تا {t.status === "ongoing" ? "مقصد" : "مبدأ"}</p>
            ) : driverLocation.data ? (
              <p className="mt-1 text-muted-foreground">در حال محاسبه زمان مسیر با نشان…</p>
            ) : (
              <p className="mt-1 text-muted-foreground">در انتظار دریافت موقعیت زنده راننده…</p>
            )}
            {driverLocation.data?.updated_at && <p className="mt-1 text-xs text-muted-foreground">آخرین موقعیت: {new Date(driverLocation.data.updated_at).toLocaleTimeString("fa-IR")}</p>}
            {etaQuery.error && <p className="mt-1 text-xs text-muted-foreground">زمان رسیدن فعلاً قابل محاسبه نیست؛ موقعیت زنده همچنان نمایش داده می‌شود.</p>}
          </div>
        )}
      </Card>
      {party === "passenger" && t.status === "done" && contact.data?.driver && (
        <Card className="space-y-3">
          <b>به راننده امتیاز بدهید</b>
          {contact.data.driver.myRating != null ? (
            <p className="text-sm text-muted-foreground">امتیاز شما: {"★".repeat(Number(contact.data.driver.myRating))}</p>
          ) : (
            <>
              <div className="flex gap-2" role="radiogroup" aria-label="امتیاز راننده">
                {[1, 2, 3, 4, 5].map((star) => (
                  <button key={star} type="button" aria-label={`${star} ستاره`} aria-pressed={selectedRating === star}
                    onClick={() => setSelectedRating(star)}
                    className={selectedRating >= star ? "text-2xl text-amber-500" : "text-2xl text-muted-foreground"}>★</button>
                ))}
              </div>
              <Btn disabled={selectedRating === 0 || ratingBusy} onClick={() => void submitRating()}>
                {ratingBusy ? "در حال ثبت…" : "ثبت امتیاز"}
              </Btn>
            </>
          )}
        </Card>
      )}
      <Card>
        <FareTable
          km={t.km}
          night={t.night}
          mountain={t.mountain}
          agreed={t.suggested ?? undefined}
        />
        <p>کرایه سفر: {toman(t.agreed_fare)}</p>
        {(t.prior_debt_amount ?? 0) > 0 && <p>بدهی جریمه قبلی مسافر: {toman(t.prior_debt_amount)}</p>}
        <p className="font-bold">مبلغ کل قابل پرداخت: {toman(t.agreed_fare + (t.prior_debt_amount ?? 0))}</p>
        <p>کمیسیون ثبت‌شده: {toman(t.commission)}</p>
        <p>سهم راننده: {toman(t.driver_net)}</p>
      </Card>
      <TripChat tripId={id} userId={userId} enabled={contactsVisible(t.status as TripStatus, participant)} canSend={t.status === "accepted" || t.status === "ongoing"} />
      <TripLiveTracking
        tripId={id}
        userId={userId}
        passengerId={t.passenger_id}
        driverId={t.driver_id}
        status={t.status}
        origin={origin}
        destination={destination}
        route={routeGeometry}
        trackingEnabled={true}
      />
      {routeQuery.error && (t.status === "accepted" || t.status === "ongoing") && (
        <p className="text-xs text-muted-foreground">مسیر جاده‌ای فعلاً بارگذاری نشد؛ موقعیت زنده طرفین همچنان نمایش داده می‌شود.</p>
      )}
      {party && (
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
        {billingFeatures.wallet
          ? "پرداخت از کیف پول طبق وضعیت فعال‌سازی این قابلیت انجام می‌شود."
          : "در نسخه فعلی، کرایه مستقیماً و نقدی به راننده پرداخت می‌شود؛ کیف پول و عملیات بانکی غیرفعال‌اند."}
        {" "}مسافت جاده‌ای هنگام ثبت سفر دوباره در سرور با سرویس نشان محاسبه می‌شود؛ اگر نشان در دسترس نباشد، سفر ثبت نخواهد شد.
      </DemoNote>
    </div>
  );
}
