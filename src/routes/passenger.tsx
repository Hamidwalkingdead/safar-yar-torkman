import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { MapPin, Flag, Moon, Mountain, Users, Search, type LucideIcon } from "lucide-react";
import { RouteMap, reverseName, searchPlace, type Place } from "@/components/route-map";
import { neshanRoute } from "@/lib/neshan.functions";
import { isNightDeparture, routeErrorMessage, type DrivingRoute, type Point } from "@/lib/geo";
import { toast } from "sonner";
import { useSharedAuth, SharedSignIn } from "@/components/shared-auth";
import { useAccount } from "@/lib/account";
import { parsePersianNumber, sharedEligible, type RideType } from "@/lib/shared-rides";

import { Btn, Card, DemoNote, FareTable } from "@/components/ui-kit";
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
        content: "مبدأ و مقصد را وارد کنید، کرایه را ببینید و کرایه پیشنهادی خود را ثبت کنید.",
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
    const fallback = `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`;
    if (which === "origin") { setOp({ ...p, name: "در حال یافتن نشانی…" }); setFrom(fallback); }
    else { setDp({ ...p, name: "در حال یافتن نشانی…" }); setTo(fallback); }
    const name = (await reverseName(p)) || fallback;
    if (which === "origin") {
      setOp({ ...p, name });
      setFrom(name);
    } else {
      setDp({ ...p, name });
      setTo(name);
    }
  }
  async function locate(which: "origin" | "destination") {
    const q = which === "origin" ? from : to;
    if (q.trim().length < 2) return;
    const hit = await searchPlace(q.trim(), op ?? dp ?? undefined);
    if (!hit) return void toast.error("این مکان پیدا نشد؛ روی نقشه انتخاب کنید.");
    if (which === "origin") setOp(hit);
    else setDp(hit);
  }
  const [rideType, setRideType] = useState<RideType>("intercity");
  const [showSharedForm, setShowSharedForm] = useState(false);
  const [mountain, setMountain] = useState(false);
  const [suggest, setSuggest] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "wallet">("cash");
  const [scheduled, setScheduled] = useState(false);
  const [scheduledAt, setScheduledAt] = useState("");
  const calc = calculateFare({ km, night, mountain }).total;
  const scheduledTimestamp = scheduledAt ? new Date(scheduledAt).getTime() : 0;
  const scheduleInvalid = scheduled && (!scheduledTimestamp || scheduledTimestamp < Date.now() + 15 * 60 * 1000);
  const fareDeparture = scheduled && Number.isFinite(scheduledTimestamp) && scheduledTimestamp > 0
    ? new Date(scheduledTimestamp).toISOString()
    : requestTime;
  const night = isNightDeparture(fareDeparture);
  const s = suggest ? parsePersianNumber(suggest) : undefined;
  const tooLow = s !== undefined && (!Number.isFinite(s) || s < FARE.minimum);

  const [locating, setLocating] = useState(false);
  function locateCurrentPosition() {
    if (locating) return;
    if (!window.isSecureContext) {
      toast.error("موقعیت‌یابی فقط روی نشانی امن (https) کار می‌کند.");
      return;
    }
    if (!navigator.geolocation) {
      toast.error("موقعیت‌یابی در این مرورگر پشتیبانی نمی‌شود.");
      return;
    }
    setLocating(true);
    toast.info("در حال دریافت موقعیت فعلی شما…");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocating(false);
        void pick("origin", {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        });
        toast.success("موقعیت فعلی به‌عنوان مبدأ انتخاب شد.");
      },
      (error) => {
        setLocating(false);
        const message =
          error.code === error.PERMISSION_DENIED
            ? "اجازه دسترسی به موقعیت مکانی داده نشد."
            : error.code === error.TIMEOUT
              ? "دریافت موقعیت مکانی بیش از حد طول کشید."
              : "موقعیت مکانی در دسترس نیست؛ GPS گوشی را بررسی کنید.";
        toast.error(message);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 },
    );
  }

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
      <div className="bg-hero rounded-3xl p-5 text-primary-foreground">
        <p className="text-xs opacity-80">پنل مسافر</p>
        <p className="text-lg font-black">کجا می‌روید؟</p>
        <p className="text-sm opacity-80">۱) مبدأ را روی نقشه بزنید  ۲) مقصد را بزنید  ۳) درخواست را ثبت کنید.</p>
      </div>
      <RouteMap origin={op} destination={dp} route={roadRoute?.geometry ?? null} onPick={(w, p, r) => void pick(w, p, r)} onClear={clearPoints} onLocate={locateCurrentPosition} locating={locating} />
      <Btn
        type="button"
        variant="ghost"
        className="w-full"
        onClick={locateCurrentPosition}
        disabled={locating}
        aria-busy={locating}
      >
        <MapPin className="ml-2 size-4" />
        {locating ? "در حال یافتن موقعیت…" : "تعیین مبدأ با موقعیت فعلی GPS"}
      </Btn>
      <Card className="space-y-3">
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
            <option value="suburban">حومه‌ای / اطراف شهر</option>
          </select>
        </label>
        <label className="flex items-center gap-2 rounded-2xl bg-muted px-3">
          <MapPin className="size-4 text-primary" />
          <input
            aria-label="مبدأ سفر"
            className="w-full bg-transparent py-3 outline-none"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
              setOp(null);
            }}
            onBlur={() => void locate("origin")}
            placeholder="مبدأ (تایپ یا کلیک روی نقشه)"
          />
          <button
            type="button"
            aria-label="یافتن مبدأ روی نقشه"
            onClick={() => void locate("origin")}
          >
            <Search className="size-4" />
          </button>
        </label>
        <label className="flex items-center gap-2 rounded-2xl bg-muted px-3">
          <Flag className="size-4 text-accent-foreground" />
          <input
            aria-label="مقصد سفر"
            className="w-full bg-transparent py-3 outline-none"
            value={to}
            onChange={(e) => {
              setTo(e.target.value);
              setDp(null);
            }}
            onBlur={() => void locate("destination")}
            placeholder="مقصد (تایپ یا کلیک روی نقشه)"
          />
          <button
            type="button"
            aria-label="یافتن مقصد روی نقشه"
            onClick={() => void locate("destination")}
          >
            <Search className="size-4" />
          </button>
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
          {routeLoading ? "در حال محاسبه مسیر جاده‌ای نشان…" : roadRoute ? `مسیر جاده‌ای نشان محاسبه شد · حدود ${fa(roadRoute.durationMinutes)} دقیقه` : routeError ? `${routeError} تا محاسبه مسیر، ثبت درخواست ممکن نیست.` : "مبدأ و مقصد را روی نقشه انتخاب کنید."}
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
          <Card className="space-y-2">
            <h2 className="font-bold">کرایه پیشنهادی شما (اختیاری)</h2>
            <p className="text-sm text-muted-foreground">
              کرایه محاسبه‌شده {toman(calc)} است. بدهی جریمه قبلی: {toman(cancellationDebt.data ?? 0)}؛ مبلغ کل درخواست: {toman(calc + (cancellationDebt.data ?? 0))}. می‌توانید مبلغ دیگری پیشنهاد دهید؛ راننده تصمیم می‌گیرد.
            </p>
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
          {userId && !account.data?.profile.phone && (
            <Link to="/profile" className="text-primary">
              تکمیل نام و شماره تماس در پروفایل
            </Link>
          )}
          <Card className="space-y-2">
            <h2 className="font-bold">روش پرداخت کرایه</h2>
            <label className="flex items-center gap-2 rounded-xl bg-muted p-3">
              <input type="radio" name="payment-method" checked={paymentMethod === "cash"} onChange={() => setPaymentMethod("cash")} />
              <span>نقدی به راننده · کمیسیون ۱۰٪ از کیف پول راننده کسر می‌شود</span>
            </label>
            <label className="flex items-center gap-2 rounded-xl bg-muted p-3">
              <input type="radio" name="payment-method" checked={paymentMethod === "wallet"} onChange={() => setPaymentMethod("wallet")} />
              <span>کیف پول · کل کرایه از موجودی شما رزرو می‌شود</span>
            </label>
            {paymentMethod === "wallet" && <p className="text-xs text-muted-foreground">در صورت لغو سفر، مبلغ رزروشده به کیف پول شما برمی‌گردد. پس از پایان سفر، ۹۰٪ به راننده و ۱۰٪ به سامانه می‌رسد. شارژ آنلاین هنوز فعال نیست.</p>}
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
              !account.data?.profile.phone ||
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
      <div className="flex justify-between">
        <h2 className="font-bold">سفرهای من</h2>
        <Btn variant="ghost" onClick={refresh}>
          تازه‌سازی
        </Btn>
      </div>
      {loading && <p>در حال دریافت…</p>}
      {error && <p role="alert">{error}</p>}
      {trips
        .filter((t) => t.passenger_id === userId)
        .map((t) => (
          <Link
            key={t.id}
            to="/trip/$id"
            params={{ id: t.id }}
            search={{ as: "passenger" }}
            className="block rounded-2xl bg-card p-4"
          >
            {t.from} ← {t.to} · {t.status}
          </Link>
        ))}
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
