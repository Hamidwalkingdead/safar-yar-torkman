import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { MapPin, Flag, Moon, Mountain, Users, type LucideIcon } from "lucide-react";
import { RouteMap, reverseName, type Place } from "@/components/route-map";
import { neshanRoute } from "@/lib/neshan.functions";
import { isNightDeparture, routeErrorMessage, type DrivingRoute, type Point } from "@/lib/geo";
import { toast } from "sonner";
import { useSharedAuth, SharedSignIn } from "@/components/shared-auth";
import { useAccount } from "@/lib/account";
import { departureLabel, parsePersianNumber, sharedEligible, type RideType } from "@/lib/shared-rides";
import { passengerProfileComplete, passengerTripStatusLabel } from "@/lib/passenger-panel";
import { billingFeatures } from "@/lib/billing-config";

import { Badge, Btn, Card, DemoNote, FareTable } from "@/components/ui-kit";
import { calculateFare, FARE, toman, fa } from "@/lib/fare";
import { useStore } from "@/lib/store";
import { supabase } from "@/integrations/supabase/client";
import { SharedRequest } from "@/components/shared-request";
export const Route = createFileRoute("/passenger")({
  head: () => ({
    meta: [
      { title: "درخواست سفر | سفر یار ترکمن" },
      {
        name: "description",
        content: "مبدأ و مقصد را از روی نقشه انتخاب کنید؛ مسافت و کرایه جاده‌ای خودکار محاسبه می‌شود.",
      },
      { property: "og:title", content: "درخواست سفر | سفر یار ترکمن" },
      { property: "og:description", content: "درخواست سفر با محاسبه شفاف کرایه و پیشنهاد قیمت." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Passenger,
});

function Passenger() {
  const { addTrip, trips, loading, error, refresh } = useStore();
  const { userId } = useSharedAuth();
  const account = useAccount();
  const [busy, setBusy] = useState(false);
  const profileComplete = passengerProfileComplete(account.data?.profile ?? null);
  const cancellationDebt = useQuery({
    queryKey: ["passenger-cancellation-debt", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_passenger_cancellation_debt");
      if (error) throw error;
      return Number(data ?? 0);
    },
  });
  const nav = useNavigate();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [op, setOp] = useState<Place | null>(null);
  const [dp, setDp] = useState<Place | null>(null);
  const [roadRoute, setRoadRoute] = useState<DrivingRoute | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeError, setRouteError] = useState("");
  const [mapOpen, setMapOpen] = useState(false);
  const [mapTarget, setMapTarget] = useState<"origin" | "destination">("origin");
  const [mapCenter, setMapCenter] = useState<Point>({ lat: 37.25, lng: 55.17 });
  const [mapZoom, setMapZoom] = useState(14);
  const [locating, setLocating] = useState(false);
  useEffect(() => {
    let active = true;
    setRoadRoute(null);
    setRouteError("");
    if (!op || !dp) { setRouteLoading(false); return; }
    if (!navigator.onLine) { setRouteError(routeErrorMessage("offline")); return; }
    setRouteLoading(true);
    void neshanRoute({ data: { origin: { lat: op.lat, lng: op.lng }, destination: { lat: dp.lat, lng: dp.lng } } })
      .then((result) => {
        if (active) {
          setRouteLoading(false);
          if (result.ok) setRoadRoute(result);
          else setRouteError(routeErrorMessage(result.reason));
        }
      })
      .catch(() => {
        if (active) {
          setRoadRoute(null);
          setRouteLoading(false);
          setRouteError(routeErrorMessage(navigator.onLine ? "failed" : "offline"));
        }
      });
    return () => { active = false; };
  }, [op, dp]);
  const km = roadRoute?.distanceKm ?? 0;
  const requestTime = new Date().toISOString();
  function clearPoints() {
    setOp(null); setDp(null); setFrom(""); setTo(""); setRoadRoute(null); setRouteError("");
  }
  async function pick(which: "origin" | "destination", p: Point, reset = false) {
    if (reset) clearPoints();
    const name = (await reverseName(p)).trim();
    if (!name) {
      toast.error("نشانی این نقطه از سرویس نشان دریافت نشد؛ دوباره انتخاب کنید.");
      return;
    }
    if (which === "origin") {
      setOp({ ...p, name });
      setFrom(name);
    } else {
      setDp({ ...p, name });
      setTo(name);
    }
  }
  function openMapPicker(which: "origin" | "destination") {
    setMapTarget(which);
    setLocating(true);
    const openAtGonbad = () => {
      setMapCenter({ lat: 37.25, lng: 55.17 });
      setMapZoom(16);
      setMapOpen(true);
      setLocating(false);
    };
    if (!window.isSecureContext || !navigator.geolocation) {
      openAtGonbad();
      toast.info("موقعیت‌یابی در دسترس نیست؛ نقشه روی گنبد کاووس باز شد.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setMapCenter({ lat: position.coords.latitude, lng: position.coords.longitude });
        setMapZoom(18);
        setMapOpen(true);
        setLocating(false);
      },
      () => {
        openAtGonbad();
        toast.info("موقعیت‌یابی انجام نشد؛ نقشه روی گنبد کاووس باز شد. می‌توانید نقطه را دستی انتخاب کنید.");
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 5000 },
    );
  }
  const [rideType, setRideType] = useState<RideType>("intercity");
  const [showSharedForm, setShowSharedForm] = useState(false);
  const [mountain, setMountain] = useState(false);
  const [suggest, setSuggest] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "wallet">("cash");
  const [scheduled, setScheduled] = useState(false);
  const [scheduledAt, setScheduledAt] = useState("");
  const scheduledTimestamp = scheduledAt ? new Date(scheduledAt).getTime() : 0;
  const scheduleInvalid = scheduled && (!scheduledTimestamp || scheduledTimestamp < Date.now() + 15 * 60 * 1000);
  const fareDeparture = scheduled && Number.isFinite(scheduledTimestamp) && scheduledTimestamp > 0
    ? new Date(scheduledTimestamp).toISOString()
    : requestTime;
  const night = isNightDeparture(fareDeparture);
  const calc = calculateFare({ km, night, mountain }).total;
  const s = suggest ? parsePersianNumber(suggest) : undefined;
  const tooLow = s !== undefined && (!Number.isFinite(s) || s < FARE.minimum);

  const submit = async () => {
    setBusy(true);
    try {
      if (scheduleInvalid) throw new Error("زمان رزرو باید دست‌کم ۱۵ دقیقه بعد از زمان فعلی باشد.");
      const departure = scheduled ? new Date(scheduledTimestamp).toISOString() : new Date().toISOString();
      if (!op || !dp) throw new Error("مبدأ و مقصد را از روی نقشه انتخاب کنید.");
      const id = await addTrip({
        from,
        to,
        departure,
        originPoint: { lat: op.lat, lng: op.lng },
        destinationPoint: { lat: dp.lat, lng: dp.lng },
        mountain,
        paymentMethod,
        rideType,
        ...(s === undefined ? {} : { suggested: s }),
      });
      await nav({ to: "/trip/$id", params: { id }, search: { as: "passenger" } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "ثبت سفر انجام نشد");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4 p-4">
      <h1 className="pt-2 text-2xl font-black">پنل مسافر · درخواست سفر</h1>
      <Card className="space-y-3">
        <div className="space-y-4 rounded-2xl border border-primary/20 bg-primary/5 p-3">
          <p className="font-bold">مبدأ و مقصد</p>
          <div className="space-y-2">
            <p className="text-sm font-semibold">مبدأ</p>
            <div className="min-h-12 rounded-xl border bg-background px-3 py-3 text-sm">{op?.name ?? "مبدأ هنوز از روی نقشه انتخاب نشده است"}</div>
            <Btn type="button" className="w-full justify-center" onClick={() => openMapPicker("origin")}>
              <MapPin className="ml-2 size-4" /> {op ? "تغییر مبدأ روی نقشه" : "انتخاب مبدأ از نقشه"}
            </Btn>
          </div>
          <div className="space-y-2">
            <p className="text-sm font-semibold">مقصد</p>
            <div className="min-h-12 rounded-xl border bg-background px-3 py-3 text-sm">{dp?.name ?? "مقصد هنوز از روی نقشه انتخاب نشده است"}</div>
            <Btn type="button" variant="ghost" className="w-full justify-center border" onClick={() => openMapPicker("destination")}>
              <Flag className="ml-2 size-4" /> {dp ? "تغییر مقصد روی نقشه" : "انتخاب مقصد از نقشه"}
            </Btn>
          </div>
          {locating && <p className="text-xs text-muted-foreground">در حال یافتن موقعیت فعلی شما؛ نقشه پس از دریافت GPS روی همان نقطه باز می‌شود…</p>}
        </div>
        {mapOpen && <RouteMap
          origin={op}
          destination={dp}
          route={roadRoute?.geometry ?? null}
          onPick={(w, p, reset) => void pick(w, p, reset)}
          onClear={clearPoints}
          initialCenter={mapCenter}
          initialZoom={mapZoom}
          startFullScreen
          pickTarget={mapTarget}
          onClose={() => setMapOpen(false)}
        />}
        <label className="block space-y-1 text-sm">
          زمان سفر
          <select aria-label="زمان سفر" value={scheduled ? "scheduled" : "now"} onChange={(e) => setScheduled(e.target.value === "scheduled")} className="w-full rounded-2xl bg-muted px-3 py-3">
            <option value="now">درخواست فوری</option>
            <option value="scheduled">رزرو برای زمان آینده</option>
          </select>
        </label>
        {scheduled && <label className="block space-y-1 text-sm">
          تاریخ و ساعت حرکت
          <input aria-label="تاریخ و ساعت حرکت" type="datetime-local" min={new Date(Date.now() + 15 * 60 * 1000).toISOString().slice(0, 16)} value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} className="w-full rounded-2xl bg-muted px-3 py-3" />
          {scheduleInvalid && <span className="text-xs text-destructive">زمان حرکت باید حداقل ۱۵ دقیقه بعد باشد.</span>}
        </label>}
        <label className="block space-y-1 text-sm">
          نوع مسیر
          <select
            aria-label="نوع مسیر"
            value={rideType}
            onChange={(e) => {
              const type = e.target.value as RideType;
              setRideType(type);
              if (type !== "intercity") setShowSharedForm(false);
            }}
            className="w-full rounded-2xl bg-muted px-3 py-3"
          >
            <option value="urban">داخل‌شهری</option>
            <option value="intercity">بین‌شهری</option>
            <option value="suburban">حومه‌ای / اطراف شهر · تعرفه فعلی بین‌شهری</option>
          </select>
        </label>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div className="rounded-2xl bg-muted p-3">
            مسافت مسیر
            <b className="block">{routeLoading ? "در حال محاسبه مسیر…" : km ? `${fa(km)} کیلومتر (جاده‌ای)` : routeError ? "محاسبه نشد" : "مبدأ و مقصد را مشخص کنید"}</b>
          </div>
          <div className="flex items-center gap-2 rounded-2xl bg-muted p-3">
            <Moon className="size-4" />
            <span>
              سفر شبانه (خودکار)
              <b className="block">{night ? "بله — ۲۲ تا ۶ صبح" : "خیر"}</b>
            </span>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          {routeLoading ? "در حال محاسبه خودکار مسافت جاده‌ای و کرایه…" : roadRoute ? `مسافت جاده‌ای: ${fa(roadRoute.distanceKm)} کیلومتر · زمان تقریبی: ${fa(roadRoute.durationMinutes)} دقیقه · کرایه تخمینی: ${toman(calc)}` : routeError ? `${routeError} تا محاسبه مسیر، ثبت درخواست ممکن نیست.` : "مبدأ و مقصد را روی نقشه انتخاب کنید؛ مسافت و کرایه خودکار محاسبه می‌شوند."}
        </p>
        <Toggle on={mountain} set={setMountain} I={Mountain} l="جاده کوهستانی" />
        {sharedEligible(rideType) && <Btn
        variant="ghost"
        className="flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-primary bg-primary/10 px-4 py-4 font-bold text-primary"
        onClick={() => setShowSharedForm((v) => !v)}
      >
        <Users className="size-5" />
        {showSharedForm ? "بستن فرم سفر اشتراکی" : "درخواست سفر اشتراکی"}
      </Btn>}
      {sharedEligible(rideType) && (
        <Link to="/shared" className="block text-center text-sm font-bold text-primary">
          مشاهده درخواست‌های اشتراکی من
        </Link>
      )}
      {sharedEligible(rideType) && showSharedForm && (
        <SharedRequest origin={from} destination={to} fare={calc} routeVerified={!!roadRoute} />
      )}
      </Card>
      <Card>
        <h2 className="mb-2 font-bold">جزئیات کرایه</h2>
        <FareTable km={km} night={night} mountain={mountain} />
      </Card>
      {!showSharedForm && (
        <>
          {userId && account.isLoading && <p className="text-sm text-muted-foreground">در حال بررسی کامل بودن پروفایل…</p>}
          {userId && account.isError && <p role="alert" className="text-sm text-destructive">بررسی پروفایل ناموفق بود؛ اتصال اینترنت را بررسی و دوباره تلاش کنید.</p>}
          <Card className="space-y-2">
            <h2 className="font-bold">کرایه پیشنهادی شما (اختیاری)</h2>
            <p className="text-sm text-muted-foreground">
              کرایه تخمینی {toman(calc)} است؛ مبلغ نهایی با پذیرش راننده مشخص می‌شود. بدهی جریمه قبلی: {cancellationDebt.isError ? "قابل دریافت نیست" : toman(cancellationDebt.data ?? 0)}؛ مبلغ کل درخواست: {toman(calc + (cancellationDebt.data ?? 0))}. می‌توانید مبلغ دیگری پیشنهاد دهید؛ راننده تصمیم می‌گیرد.
            </p>
            {cancellationDebt.isError && <p role="alert" className="text-xs text-destructive">بدهی قبلی از سرور دریافت نشد؛ پیش از ثبت درخواست، دوباره بررسی کنید.</p>}
            {cancellationDebt.isLoading && <p className="text-xs text-muted-foreground">در حال دریافت بدهی و محاسبه مبلغ نهایی…</p>}
            {cancellationDebt.isError && <Btn variant="ghost" onClick={() => void cancellationDebt.refetch()}>تلاش دوباره برای دریافت بدهی</Btn>}
            <input
              inputMode="numeric"
              value={suggest}
              onChange={(e) => setSuggest(e.target.value)}
              placeholder="مثلاً ۱۵۰۰۰۰"
              className="w-full rounded-2xl bg-muted px-4 py-3 outline-none"
            />
            {s !== undefined && !tooLow && (
              <p className="text-sm text-primary">پیشنهاد شما: {toman(s)} · با بدهی قبلی: {toman(s + (cancellationDebt.data ?? 0))}</p>
            )}
            {tooLow && (
              <p className="text-sm text-destructive">
                پیشنهاد نمی‌تواند کمتر از حداقل کرایه ({toman(FARE.minimum)}) باشد.
              </p>
            )}
          </Card>
          {!userId && <SharedSignIn />}
          {userId && account.isSuccess && !profileComplete && (
            <Card className="space-y-2 border-amber-500/40">
              <b>برای ثبت درخواست، پروفایل خود را کامل کنید.</b>
              <p className="text-sm text-muted-foreground">نام واقعی، نام خانوادگی، نام نمایشی، شماره همراه ثبت‌شده و شماره تماس اضطراری لازم است.</p>
              <Link to="/profile" className="font-bold text-primary">تکمیل پروفایل ←</Link>
            </Card>
          )}
          <Card className="space-y-2">
            <h2 className="font-bold">روش پرداخت کرایه</h2>
            <label className="flex items-center gap-2 rounded-xl bg-muted p-3">
              <input type="radio" name="payment-method" checked={paymentMethod === "cash"} onChange={() => setPaymentMethod("cash")} />
              <span>پرداخت نقدی به راننده در زمان سفر</span>
            </label>
            {billingFeatures.wallet && <>
              <label className="flex items-center gap-2 rounded-xl bg-muted p-3">
                <input type="radio" name="payment-method" checked={paymentMethod === "wallet"} onChange={() => setPaymentMethod("wallet")} />
                <span>پرداخت از کیف پول</span>
              </label>
              {paymentMethod === "wallet" && <p className="text-xs text-muted-foreground">مبلغ کرایه در کیف پول رزرو و پس از پایان سفر تسویه می‌شود.</p>}
            </>}
            {!billingFeatures.wallet && <p className="text-xs text-muted-foreground">پرداخت آنلاین و کیف پول در نسخه فعلی غیرفعال‌اند؛ مبلغ سفر مستقیماً به راننده پرداخت می‌شود.</p>}
          </Card>
          <DemoNote>
            شماره تماس شما فقط پس از پذیرش سفر به راننده نمایش داده می‌شود. نام شما از ابتدا دیده
            می‌شود.
          </DemoNote>
          <Btn
            className="w-full py-4 text-lg"
            disabled={
              busy ||
              scheduleInvalid ||
              routeLoading ||
              !userId ||
              !profileComplete ||
              !cancellationDebt.isSuccess ||
              tooLow ||
              !km ||
              !from ||
              !to ||
              from === to
            }
            onClick={submit}
          >
            درخواست سفر
          </Btn>
        </>
      )}
      <div className="flex items-center justify-between">
        <h2 className="font-bold">سفرهای من</h2>
        <Btn variant="ghost" onClick={refresh} disabled={loading}>
          {loading ? "در حال دریافت…" : "تازه‌سازی"}
        </Btn>
      </div>
      {loading && <p>در حال دریافت…</p>}
      {error && <p role="alert">{error}</p>}
      {trips.filter((t) => t.passenger_id === userId).length === 0 && !loading && !error && (
        <Card className="space-y-2 text-center">
          <p className="font-bold">هنوز سفری ثبت نکرده‌اید.</p>
          <p className="text-sm text-muted-foreground">پس از ثبت درخواست، وضعیت راننده و جزئیات سفر را همین‌جا پیگیری می‌کنید.</p>
        </Card>
      )}
      {trips
        .filter((t) => t.passenger_id === userId)
        .map((t) => (
          <Link
            key={t.id}
            to="/trip/$id"
            params={{ id: t.id }}
            search={{ as: "passenger" }}
            className="block rounded-2xl border border-border bg-card p-4 transition hover:border-primary/50"
          >
            <div className="flex items-center justify-between gap-2">
              <b className="min-w-0 truncate">{t.from} ← {t.to}</b>
              <Badge tone={t.status === "done" ? "primary" : t.status === "cancelled" ? "muted" : "accent"}>{passengerTripStatusLabel(t.status)}</Badge>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">حرکت: {departureLabel(t.departure_at)}</p>
            <p className="mt-1 text-sm font-bold">{toman(t.agreed_fare)}</p>
            <p className="mt-2 text-xs font-bold text-primary">مشاهده جزئیات و پیگیری ←</p>
          </Link>
        ))}
      <div className="flex flex-wrap gap-3 border-t border-border pt-3 text-sm">
        <Link to="/profile" className="font-bold text-primary">پروفایل و تنظیمات</Link>
        <Link to="/support" className="font-bold text-primary">پشتیبانی</Link>
        <Link to="/shared" className="font-bold text-primary">درخواست‌های اشتراکی</Link>
      </div>
    </div>
  );
}

function Toggle({
  on,
  set,
  I,
  l,
}: {
  on: boolean;
  set: (v: boolean) => void;
  I: LucideIcon;
  l: string;
}) {
  return (
    <Btn
      variant="ghost"
      aria-pressed={on}
      onClick={() => set(!on)}
      className={`flex items-center justify-center gap-2 rounded-2xl border-2 py-3 text-sm font-bold transition ${on ? "border-primary bg-primary text-primary-foreground" : "border-border"}`}
    >
      <I className="size-4" />
      {l}
    </Btn>
  );
}
