import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Capacitor } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";
import { Badge, Btn, Card } from "@/components/ui-kit";
import { RouteMap } from "@/components/route-map";
import { mapirRoute } from "@/lib/mapir.functions";
import { fa, toman } from "@/lib/fare";
import { useStore, statusLabel, type TripStatus } from "@/lib/store";
import { useSharedAuth, SharedSignIn } from "@/components/shared-auth";
import { useAccount } from "@/lib/account";
import { departureLabel, waitingDurationLabel } from "@/lib/shared-rides";
import { isImmediateTrip, pendingForDriver } from "@/lib/trip-rules";
import { SharedRideChat } from "@/components/shared-ride-chat";
import { SharedRideLiveTracking } from "@/components/shared-ride-live-tracking";
export const Route = createFileRoute("/driver")({
  head: () => ({
    meta: [
      { title: "پنل راننده | سفر یار ترکمن" },
      {
        name: "description",
        content: "درخواست‌های ورودی سفر، کرایه پیشنهادی مسافر و سهم خالص راننده.",
      },
      { property: "og:title", content: "پنل راننده | سفر یار ترکمن" },
      { property: "og:description", content: "درخواست‌های سفر را ببینید و بپذیرید." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Driver,
});

function Driver() {
  const { trips, accept, refresh, loading, error } = useStore();
  const { userId, isAnonymous } = useSharedAuth();
  const account = useAccount();
  const nav = useNavigate();
  const [busy, setBusy] = useState<string | null>(null);
  const [sharedContacts, setSharedContacts] = useState<Record<string, {name:string;phone:string}|null>>({});
  const [tripFilter, setTripFilter] = useState<"all" | "nearest" | "intercity" | "urban" | "suburban" | "shared">("all");
  const [selectedTrip, setSelectedTrip] = useState<(typeof trips)[number] | null>(null);
  const selectedTripRoute = useQuery({
    queryKey: ["driver-offer-route", selectedTrip?.id],
    enabled: !!selectedTrip && selectedTrip.origin_lat != null && selectedTrip.origin_lng != null
      && selectedTrip.destination_lat != null && selectedTrip.destination_lng != null,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const result = await mapirRoute({
        data: {
          origin: { lat: selectedTrip!.origin_lat!, lng: selectedTrip!.origin_lng! },
          destination: { lat: selectedTrip!.destination_lat!, lng: selectedTrip!.destination_lng! },
        },
      });
      return result.ok ? result : null;
    },
  });
  const [driverPosition, setDriverPosition] = useState<{lat:number;lng:number}|null>(null);
  const knownPendingTrips = useRef<Set<string> | null>(null);
  const alertAudioContext = useRef<AudioContext | null>(null);
  const [notificationsEnabled, setNotificationsEnabled] = useState(
    Capacitor.getPlatform() === "android" ? false : typeof Notification !== "undefined" && Notification.permission === "granted",
  );
  function playTripAlert() {
    const context = alertAudioContext.current;
    if (!context || context.state !== "running") return;
    const start = context.currentTime;
    [880, 660, 880].forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const at = start + index * 0.22;
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(frequency, at);
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.18, at + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.17);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(at);
      oscillator.stop(at + 0.18);
    });
  }
  useEffect(() => {
    if (!navigator.geolocation) return;
    const id = navigator.geolocation.watchPosition(
      p => setDriverPosition({lat:p.coords.latitude,lng:p.coords.longitude}),
      () => setDriverPosition(null),
      {enableHighAccuracy:true,maximumAge:30000,timeout:15000},
    );
    return () => navigator.geolocation.clearWatch(id);
  }, []);
  const verification = useQuery({
    queryKey: ["driver-verification", userId],
    enabled: !!userId && !!account.data?.isDriver,
    refetchInterval: 15000,
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
    queryFn: async () => {
      const client = (await import("@/integrations/supabase/client")).supabase;
      const [verification, approval] = await Promise.all([
        client.from("driver_verifications").select("status,note").eq("user_id", userId!).maybeSingle(),
        client.rpc("is_my_driver_fully_approved"),
      ]);
      if (verification.error) throw verification.error;
      if (approval.error) throw approval.error;
      return { ...verification.data, fullyApproved: approval.data === true };
    },
  });
  const verified = verification.data?.status === "approved" && verification.data?.fullyApproved === true; 
  useEffect(() => {
    if (!verified || loading) return;
    const current = new Set(trips.filter((trip) => pendingForDriver(trip, userId)).map((trip) => trip.id));
    if (knownPendingTrips.current === null) { knownPendingTrips.current = current; return; }
    const incoming = [...current].filter((id) => !knownPendingTrips.current?.has(id));
    knownPendingTrips.current = current;
    if (!incoming.length) return;
    const newest = trips.find((trip) => trip.id === incoming[0]);
    const message = newest ? `${newest.from} ← ${newest.to} · ${toman(newest.agreed_fare)}` : "درخواست تازه‌ای ثبت شده است.";
    toast("درخواست سفر تازه رسید", { description: message, duration: 7000 });
    playTripAlert();
    if ("vibrate" in navigator) navigator.vibrate([180, 90, 180, 90, 260]);
    if (document.visibilityState !== "visible" && Capacitor.getPlatform() === "android") {
      void LocalNotifications.schedule({
        notifications: [{
          id: Math.max(1, Date.now() % 2147483647),
          title: "درخواست سفر تازه",
          body: message,
          channelId: "trip-requests",
          schedule: { at: new Date(Date.now() + 500) },
          extra: { tripId: incoming[0] },
        }],
      }).catch(() => undefined);
    } else if (document.visibilityState !== "visible" && typeof Notification !== "undefined" && Notification.permission === "granted") {
      new Notification("درخواست سفر تازه", { body: message, tag: incoming[0] });
    }
  }, [trips, verified, loading, userId]);
  async function enableTripNotifications() {
    try {
      const AudioContextClass = window.AudioContext;
      if (AudioContextClass && !alertAudioContext.current) alertAudioContext.current = new AudioContextClass();
      if (alertAudioContext.current?.state === "suspended") await alertAudioContext.current.resume();
    } catch {
      // System notification sound remains available even if Web Audio is blocked.
    }
    if (Capacitor.getPlatform() === "android") {
      let permission = await LocalNotifications.checkPermissions();
      if (permission.display !== "granted") permission = await LocalNotifications.requestPermissions();
      const enabled = permission.display === "granted";
      if (enabled) {
        await LocalNotifications.createChannel({
          id: "trip-requests",
          name: "درخواست‌های سفر",
          description: "هشدار صوتی درخواست تازه برای راننده آماده‌به‌کار",
          importance: 5,
          vibration: true,
          visibility: 1,
        });
      }
      setNotificationsEnabled(enabled);
      toast(enabled ? "اعلان و هشدار سفر فعال شد." : "اجازه اعلان داده نشد؛ اعلان داخل برنامه فعال می‌ماند.");
      return;
    }
    if (typeof Notification === "undefined") {
      toast.info("اعلان سیستمی در این محیط پشتیبانی نمی‌شود؛ اعلان داخل برنامه فعال است.");
      return;
    }
    const permission = await Notification.requestPermission();
    setNotificationsEnabled(permission === "granted");
    toast(permission === "granted" ? "اعلان سفر فعال شد." : "اجازه اعلان داده نشد؛ اعلان داخل برنامه فعال می‌ماند.");
  }

  const cache = useQueryClient();
  const sharedRequests = useQuery({
    queryKey: ["driver-shared-rides", userId],
    enabled: !!userId && !!account.data?.isDriver && verified,
    queryFn: async () => {
      const { data, error } = await (await import("@/integrations/supabase/client")).supabase.rpc("driver_shared_requests");
      if (error) throw error;
      return (data ?? []) as { id: string; origin: string; destination: string; departureAt: string; totalFare: number; state: string; occupied: number; ownerName: string; totalDistanceKm: number | null; routePlan: {name:string;kind:"pickup"|"dropoff";lat:number;lng:number}[]; passengerRequests: { bookingId:string; name: string; seats: number; requestedAt: string; origin:string; destination:string; distanceKm:number|null; fareAmount:number|null; requestNote:string; womenOnly:boolean; femaleDriverRequested:boolean; forOtherPerson:boolean; contactName:string|null }[] }[];
    },
    refetchInterval: 15000,
  });
  const assignedSharedRides = useQuery({
    queryKey: ["driver-assigned-shared-rides", userId],
    enabled: !!userId && !!account.data?.isDriver && verified,
    queryFn: async () => {
      const { data, error } = await (await import("@/integrations/supabase/client")).supabase.rpc("driver_assigned_shared_rides");
      if (error) throw error;
      return (data ?? []) as { id: string; origin: string; destination: string; departureAt: string; totalFare: number; state: string; occupied: number; ownerName: string; totalDistanceKm:number|null; routePlan:{name:string;kind:"pickup"|"dropoff";lat:number;lng:number}[]; passengerRequests:{bookingId:string;name:string;seats:number;origin:string;destination:string;distanceKm:number|null;fareAmount:number|null;requestNote:string;womenOnly:boolean;femaleDriverRequested:boolean;forOtherPerson:boolean;contactName:string|null}[] }[];
    },
    refetchInterval: 15000,
  });
  async function revealSharedContact(rideId: string, bookingId: string) {
    const key = `${rideId}:${bookingId}`;
    if (sharedContacts[key]) return;
    try {
      const { supabase } = await import("@/integrations/supabase/client");
      const { data, error } = await supabase.rpc("get_shared_booking_contact", { p_ride: rideId, p_booking: bookingId });
      if (error) throw error;
      if (!data) throw new Error("شماره جایگزین برای این مسافر ثبت نشده است.");
      setSharedContacts((old) => ({ ...old, [key]: data as {name:string;phone:string} }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "دریافت شماره مسافر انجام نشد");
    }
  }
  async function takeShared(id: string) {
    setBusy(id);
    try {
      const { supabase } = await import("@/integrations/supabase/client");
      const { error } = await supabase.rpc("accept_shared_ride", { p_ride: id });
      if (error) throw error;
      toast.success("سفر اشتراکی به شما واگذار شد.");
      await cache.invalidateQueries({ queryKey: ["driver-shared-rides"] });
      await cache.invalidateQueries({ queryKey: ["driver-assigned-shared-rides"] });
      await cache.invalidateQueries({ queryKey: ["shared-rides"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "پذیرش سفر اشتراکی انجام نشد");
      await cache.invalidateQueries({ queryKey: ["driver-shared-rides"] });
    } finally { setBusy(null); }
  }
  async function changeSharedStatus(id: string, action: "start" | "complete" | "cancel") {
    setBusy(id);
    try {
      const { supabase } = await import("@/integrations/supabase/client");
      const result = action === "start"
        ? await supabase.rpc("start_shared_ride", { p_ride: id })
        : action === "complete"
          ? await supabase.rpc("complete_shared_ride", { p_ride: id })
          : await supabase.rpc("cancel_shared_ride", { p_ride: id, p_reason: "لغو توسط راننده" });
      if (result.error) throw result.error;
      toast.success(action === "start" ? "سفر اشتراکی آغاز شد." : action === "complete" ? "پایان سفر ثبت شد." : "گروه سفر اشتراکی لغو شد.");
      await cache.invalidateQueries({ queryKey: ["driver-assigned-shared-rides"] });
      await cache.invalidateQueries({ queryKey: ["driver-shared-rides"] });
      await cache.invalidateQueries({ queryKey: ["shared-rides"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "تغییر وضعیت سفر انجام نشد");
    } finally {
      setBusy(null);
    }
  }
  async function take(id: string) {
    setBusy(id);
    try {
      if (!verified) throw new Error("ابتدا باید مدارک و مشخصات شما توسط مدیر تأیید شود");
      await accept(id);
      await nav({ to: "/trip/$id", params: { id }, search: { as: "driver" } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "پذیرش انجام نشد");
    } finally {
      setBusy(null);
    }
  }
  const pending = trips.filter((t) => pendingForDriver(t, userId));
  const distanceFromDriver = (trip: (typeof trips)[number]) => {
    if (!driverPosition || trip.origin_lat == null || trip.origin_lng == null) return Number.POSITIVE_INFINITY;
    const rad=(n:number)=>n*Math.PI/180;
    const dLat=rad(trip.origin_lat-driverPosition.lat),dLng=rad(trip.origin_lng-driverPosition.lng);
    const a=Math.sin(dLat/2)**2+Math.cos(rad(driverPosition.lat))*Math.cos(rad(trip.origin_lat))*Math.sin(dLng/2)**2;
    return 6371*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
  };
  const visibleTrips = tripFilter === "all" || tripFilter === "shared"
    ? (tripFilter === "all" ? pending : [])
    : tripFilter === "nearest"
      ? [...pending].sort((a,b) => distanceFromDriver(a)-distanceFromDriver(b) || new Date(a.departure_at).getTime()-new Date(b.departure_at).getTime())
      : pending.filter(t => t.ride_type === tripFilter);
  return (
    <div className="driver-dashboard space-y-4 p-4">
      <header className="driver-dashboard-head">
        <div>
          <span className="driver-eyebrow">سفر‌یار ترکمن · مرکز عملیات</span>
          <h1 className="text-2xl font-black">مرکز سفر راننده</h1>
          <p className="mt-1 text-xs text-muted-foreground">درخواست‌ها را بررسی کن و پس از تأیید نهایی، سفر را تحویل بگیر.</p>
        </div>
        <div className="driver-live-indicator"><span /> آماده بررسی</div>
      </header>
      {(!userId || isAnonymous) ? (
        <SharedSignIn target="driver" />
      ) : account.isPending ? (
        <Card><p>در حال بررسی وضعیت حساب راننده…</p></Card>
      ) : account.isError ? (
        <Card><p role="alert">اطلاعات حساب دریافت نشد. اتصال اینترنت را بررسی و دوباره تلاش کنید.</p><Btn variant="ghost" onClick={() => void account.refetch()}>تلاش دوباره</Btn></Card>
      ) : !account.data?.isDriver ? (
        <Card>
          <p>برای پذیرش سفر، مشخصات خودرو را در پروفایل کامل و ثبت‌نام راننده را انجام دهید.</p>
          <Link to="/profile" className="text-primary">
            تکمیل پروفایل راننده
          </Link>
        </Card>
      ) : (
        <>
          <p>
            {account.data.profile.display_name} · {account.data.profile.car}
          </p>
          <Card className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <b>وضعیت تأیید رانندگی</b>
              {verification.isLoading ? <Badge>در حال بررسی</Badge> :
                verified ? <Badge tone="primary">تأیید شده</Badge> :
                verification.data?.status === "rejected" ? <Badge tone="accent">رد مدارک</Badge> :
                <Badge>در انتظار تأیید</Badge>}
            </div>
            {verification.isError ? (
              <p role="alert" className="text-sm text-destructive">وضعیت مدارک از سرور دریافت نشد؛ پذیرش سفر تا تأیید قطعی غیرفعال می‌ماند.</p>
            ) : verification.data?.note ? (
              <p className="text-sm">{verification.data.note}</p>
            ) : verified ? (
              <p className="text-sm">مدارک شما تأیید شده و امکان دریافت درخواست سفر فعال است.</p>
            ) : (
              <p className="text-sm">پس از بارگذاری و بررسی همه مدارک توسط مدیر، درخواست‌های سفر نمایش داده می‌شوند.</p>
            )}
            {!verified && <Link to="/profile" className="text-sm text-primary">بررسی یا تکمیل مدارک راننده</Link>}
          </Card>
          <div className="driver-toolbar">
            <Btn variant="ghost" onClick={refresh}>↻ تازه‌سازی</Btn>
            <Btn variant="ghost" onClick={() => void enableTripNotifications()} className="notification-toggle">
              {notificationsEnabled ? "🔔 اعلان‌ها روشن" : "♧ فعال‌سازی اعلان و صدا"}
            </Btn>
          </div>
          {loading && <p>در حال دریافت…</p>}
          {error && <p role="alert">{error}</p>}
          {verified && <>
          <div className="driver-section-title">
            <div><span className="driver-eyebrow">درخواست‌های ورودی</span><h2 className="font-bold">سفرهای آماده بررسی</h2></div>
            <span className="driver-count">{fa(tripFilter === "shared" ? sharedRequests.data?.length ?? 0 : visibleTrips.length)} درخواست</span>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {([
              ["all", "همه درخواست‌ها"],
              ["nearest", "نزدیک‌ترین سفرها"],
              ["intercity", "بین‌شهری"],
              ["urban", "درون‌شهری"],
              ["suburban", "حومه‌شهری"],
              ["shared", "سفرهای اشتراکی"],
            ] as const).map(([key, label]) => (
              <Btn key={key} variant={tripFilter === key ? "primary" : "ghost"} onClick={() => setTripFilter(key)}>
                {label}
              </Btn>
            ))}
          </div>
          {tripFilter !== "shared" && !pending.length && <p>درخواستی نیست.</p>}
          {tripFilter !== "shared" && !!pending.length && !visibleTrips.length && <p className="text-sm text-muted-foreground">در این دسته سفری موجود نیست.</p>}
          {tripFilter === "nearest" && !driverPosition && <p className="text-xs text-muted-foreground">برای مرتب‌سازی دقیق بر اساس فاصله، GPS را روشن کنید؛ فعلاً سفرهای نزدیک‌تر از نظر زمان حرکت در اولویت‌اند.</p>}
          {visibleTrips.map((t) => (
            <Card key={t.id} className="driver-request-card grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 p-3">
              <div className="min-w-0 space-y-1">
                <b className="block truncate">{t.passengerName}</b>
                <p className="truncate text-sm">{t.from} ← {t.to}</p>
                <p className="text-xs text-muted-foreground">
                  {fa(t.km)} کیلومتر · {isImmediateTrip(t) ? "فوری" : `رزرو · ${departureLabel(t.departure_at)}`}
                </p>
              </div>
              <div className="flex min-w-[112px] flex-col items-end gap-2">
                <b className="text-sm">{toman(t.agreed_fare)}</b>
                <Btn disabled={!!busy} onClick={() => setSelectedTrip(t)} className="accept-trip-cta min-h-10 px-3 text-xs">
                  جزئیات سفر
                </Btn>
              </div>
            </Card>
          ))}
          </>}
          {verified && tripFilter === "shared" && <><h2 className="font-bold">درخواست‌های سفر اشتراکی ({fa(sharedRequests.data?.length ?? 0)})</h2>
          {sharedRequests.isLoading && <p>در حال دریافت سفرهای اشتراکی…</p>}
          {sharedRequests.isError && <p role="alert">دریافت سفرهای اشتراکی ناموفق بود.</p>}
          {!sharedRequests.isLoading && !sharedRequests.data?.length && <p className="text-sm text-muted-foreground">درخواست اشتراکی فعالی نیست.</p>}
          {sharedRequests.data?.map((r) => (
            <Card key={r.id} className="space-y-3 border-2 border-primary/20">
              <Badge tone="primary">درخواست سفر اشتراکی</Badge>
              <b>{r.ownerName}</b>
              <p>{r.origin} ← {r.destination}</p>
              <p className="text-sm text-muted-foreground">{fa(r.occupied)} از ۳ صندلی پر شده</p>
              <div className="space-y-2 rounded-xl bg-muted p-3">
                <b className="text-sm">مدت انتظار مسافران</b>
                {r.passengerRequests.map((passenger, index) => (
                  <div key={`${r.id}-${passenger.requestedAt}-${index}`} className="space-y-1 border-b border-border/60 pb-2 last:border-0 last:pb-0 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <b>{passenger.name}{passenger.seats > 1 ? ` · ${fa(passenger.seats)} نفر` : ""}</b>
                      <b className="shrink-0 text-primary">انتظار {waitingDurationLabel(passenger.requestedAt)}</b>
                    </div>
                    <p className="text-xs">{passenger.origin} ← {passenger.destination}</p>
                    <p className="text-xs text-muted-foreground">{fa(passenger.distanceKm ?? 0)} کیلومتر محاسباتی · سهم کرایه {toman(passenger.fareAmount ?? 0)}</p>
                    {passenger.requestNote && <p className="rounded-lg bg-background p-2 text-xs">توضیح: {passenger.requestNote}</p>}
                    <div className="flex flex-wrap gap-1 text-[10px]">
                      {passenger.womenOnly && <Badge>ترجیح هم‌سفر خانم</Badge>}
                      {passenger.femaleDriverRequested && <Badge>درخواست راننده خانم</Badge>}
                      {passenger.forOtherPerson && <Badge>برای {passenger.contactName || "شخص دیگر"}</Badge>}
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex justify-between gap-2">
                <b>کرایه کل: {toman(r.totalFare)}</b>
                <span className="text-sm">سهم هر نفر در ۳ نفر: {toman(Math.floor(r.totalFare / 3))}</span>
              </div>
              <Btn disabled={!!busy} onClick={() => takeShared(r.id)}>
                {busy === r.id ? "در حال پذیرش…" : "پذیرش سفر اشتراکی"}
              </Btn>
            </Card>
          ))}
          </>}
          {verified && <section className="space-y-3">
            <h2 className="font-bold">گروه‌های اشتراکی پذیرفته‌شده ({fa(assignedSharedRides.data?.length ?? 0)})</h2>
            {assignedSharedRides.isLoading && <p className="text-sm text-muted-foreground">در حال دریافت گروه‌های پذیرفته‌شده…</p>}
            {assignedSharedRides.isError && <p role="alert" className="text-sm text-destructive">دریافت گروه‌های پذیرفته‌شده ناموفق بود.</p>}
            {assignedSharedRides.data?.map((ride) => (
              <Card key={ride.id} className="space-y-3">
                <Badge>گروه سفر اشتراکی</Badge>
                <b>{ride.ownerName}</b>
                <p>{ride.origin} ← {ride.destination}</p>
                <p className="text-sm">{departureLabel(ride.departureAt)} · {fa(ride.occupied)} از ۳ نفر</p>
                <p className="font-bold">کرایه کل گروه: {toman(ride.totalFare)}</p>
                <div className="space-y-2 rounded-xl bg-muted p-3">
                  <b className="text-sm">توقف‌های مسیر</b>
                  <p className="text-xs leading-6">{ride.routePlan?.map((stop,index)=>`${fa(index+1)}. ${stop.name} · ${stop.kind==="pickup"?"سوارکردن":"پیاده‌کردن"}`).join(" ← ")}</p>
                </div>
                <div className="space-y-2">
                  {ride.passengerRequests?.map((passenger)=> {
                    const contactKey=`${ride.id}:${passenger.bookingId}`;
                    return <div key={passenger.bookingId} className="space-y-1 rounded-xl border p-3 text-sm">
                      <b>{passenger.name}{passenger.seats>1?` · ${fa(passenger.seats)} نفر`:""}</b>
                      <p className="text-xs">{passenger.origin} ← {passenger.destination}</p>
                      <p className="text-xs text-muted-foreground">{fa(passenger.distanceKm??0)} کیلومتر محاسباتی · سهم {toman(passenger.fareAmount??0)}</p>
                      {passenger.requestNote&&<p className="text-xs">توضیح: {passenger.requestNote}</p>}
                      <div className="flex flex-wrap gap-1 text-[10px]">
                        {passenger.womenOnly&&<Badge>ترجیح هم‌سفر خانم</Badge>}
                        {passenger.femaleDriverRequested&&<Badge>درخواست راننده خانم</Badge>}
                        {passenger.forOtherPerson&&<Badge>برای {passenger.contactName||"شخص دیگر"}</Badge>}
                      </div>
                      {passenger.forOtherPerson&&<div className="space-y-1">
                        {sharedContacts[contactKey]
                          ? <p className="text-sm font-bold">شماره تماس: {sharedContacts[contactKey]!.phone}</p>
                          : <Btn variant="ghost" className="min-h-9 px-3 text-xs" onClick={()=>void revealSharedContact(ride.id,passenger.bookingId)}>نمایش شماره تماس مسافر</Btn>}
                      </div>}
                    </div>;
                  })}
                </div>
                <SharedRideChat rideId={ride.id} userId={userId!} enabled canSend={ride.state !== "cancelled" && ride.state !== "done"} />
                <SharedRideLiveTracking rideId={ride.id} userId={userId!} driverId={userId} enabled={ride.state !== "cancelled" && ride.state !== "done"} />
                {ride.state === "confirmed" && <Btn disabled={!!busy} onClick={() => void changeSharedStatus(ride.id, "start")}>{busy === ride.id ? "در حال ثبت…" : "آغاز سفر اشتراکی"}</Btn>}
                {ride.state === "ongoing" && <Btn disabled={!!busy} onClick={() => void changeSharedStatus(ride.id, "complete")}>{busy === ride.id ? "در حال ثبت…" : "پایان سفر اشتراکی"}</Btn>}
                {["open", "locked", "confirmed"].includes(ride.state) && <Btn variant="ghost" disabled={!!busy} onClick={() => void changeSharedStatus(ride.id, "cancel")}>لغو گروه سفر</Btn>}
                {ride.state === "ongoing" && <Badge tone="primary">در حال سفر</Badge>}
                {ride.state === "done" && <Badge>پایان یافته</Badge>}
              </Card>
            ))}
          </section>}
          {selectedTrip && <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/70 p-3 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="confirm-trip-title">
            <Card className="flex h-[55dvh] min-h-[330px] w-full max-w-xl flex-col gap-2 overflow-hidden p-3">
              <div className="flex shrink-0 items-center justify-between gap-2">
                <div className="min-w-0">
                  <h2 id="confirm-trip-title" className="text-base font-black">جزئیات درخواست سفر</h2>
                  <p className="truncate text-xs text-muted-foreground">{selectedTrip.passengerName}</p>
                </div>
                <Btn variant="ghost" onClick={() => setSelectedTrip(null)} className="shrink-0 px-3">بستن</Btn>
              </div>
              <div className="grid min-h-0 flex-1 grid-cols-2 gap-2" dir="ltr">
                <div className="min-h-0 overflow-hidden rounded-2xl">
                  {selectedTrip.origin_lat != null && selectedTrip.origin_lng != null
                    && selectedTrip.destination_lat != null && selectedTrip.destination_lng != null ? (
                    <RouteMap
                      className="h-full min-h-0 rounded-2xl"
                      origin={{ lat: selectedTrip.origin_lat, lng: selectedTrip.origin_lng, name: selectedTrip.from }}
                      destination={{ lat: selectedTrip.destination_lat, lng: selectedTrip.destination_lng, name: selectedTrip.to }}
                      route={selectedTripRoute.data?.geometry ?? null}
                      initialCenter={{ lat: selectedTrip.origin_lat, lng: selectedTrip.origin_lng }}
                      initialZoom={11}
                    />
                  ) : (
                    <div className="map-grid grid h-full place-items-center rounded-2xl p-2 text-center text-xs text-muted-foreground" dir="rtl">
                      مختصات مسیر ثبت نشده است
                    </div>
                  )}
                </div>
                <div className="flex min-h-0 flex-col justify-between gap-2 overflow-y-auto rounded-2xl bg-muted/60 p-2" dir="rtl">
                  <div className="space-y-2">
                    <div>
                      <span className="text-[10px] text-muted-foreground">مبدأ</span>
                      <b className="block text-xs leading-5">{selectedTrip.from}</b>
                    </div>
                    <div className="border-t border-border/70 pt-2">
                      <span className="text-[10px] text-muted-foreground">مقصد</span>
                      <b className="block text-xs leading-5">{selectedTrip.to}</b>
                    </div>
                    <div className="border-t border-border/70 pt-2">
                      <span className="text-[10px] text-muted-foreground">کرایه سفر</span>
                      <b className="block text-lg font-black">{toman(selectedTrip.agreed_fare)}</b>
                      {(selectedTrip.prior_debt_amount ?? 0) > 0 && (
                        <p className="mt-1 text-[10px] text-amber-400">بدهی قبلی: {toman(selectedTrip.prior_debt_amount)}</p>
                      )}
                    </div>
                    <p className="text-[10px] text-muted-foreground">{fa(selectedTrip.km)} کیلومتر · سهم راننده {toman(selectedTrip.driver_net)}</p>
                    {selectedTrip.request_note && <p className="rounded-lg bg-background p-2 text-[10px]">توضیح: {selectedTrip.request_note}</p>}
                    {selectedTrip.female_driver_requested && <Badge>درخواست راننده خانم</Badge>}
                    {selectedTrip.for_other_person && <Badge>درخواست برای شخص دیگر</Badge>}
                    {!isImmediateTrip(selectedTrip) && (
                      <p className="text-[10px] text-primary">رزرو: {departureLabel(selectedTrip.departure_at)}</p>
                    )}
                    {selectedTripRoute.isError && <p className="text-[10px] text-amber-400">مسیر رنگی نقشه بارگذاری نشد.</p>}
                  </div>
                  <Btn disabled={!!busy} onClick={() => { const id=selectedTrip.id; setSelectedTrip(null); void take(id); }} className="accept-trip-cta min-h-11 px-2 text-xs">
                    {busy === selectedTrip.id ? "در حال پذیرش…" : "قبول سفر"}
                  </Btn>
                </div>
              </div>
            </Card>
          </div>}
          <h2 className="font-bold">سفرهای من</h2>
          {trips
            .filter((t) => t.driver_id === userId)
            .map((t) => (
              <Link
                key={t.id}
                to="/trip/$id"
                params={{ id: t.id }}
                search={{ as: "driver" }}
                className="block"
              >
                <Card className="flex justify-between">
                  <span>
                    {t.passengerName} · {t.to}
                  </span>
                  <Badge>{statusLabel[t.status as TripStatus]}</Badge>
                </Card>
              </Link>
            ))}
        </>
      )}
    </div>
  );
}
