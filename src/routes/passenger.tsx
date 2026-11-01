import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { MapPin, Flag, Moon, Mountain, Users, Search, type LucideIcon } from "lucide-react";
import { RouteMap, reverseName, searchPlace, type Place } from "@/components/route-map";
import { JalaliDateInput } from "@/components/jalali-date-input";
import { estimatedRoadKm, isNightDeparture, type Point } from "@/lib/geo";
import { toast } from "sonner";
import { useSharedAuth, SharedSignIn } from "@/components/shared-auth";
import { useAccount } from "@/lib/account";
import { departureISO, parsePersianNumber } from "@/lib/shared-rides";
import { SharedRequest } from "@/components/shared-request";
import { sharedEligible, type RideType } from "@/lib/shared-rides";
import { Btn, Card, DemoNote, FareTable } from "@/components/ui-kit";
import { calculateFare, FARE, toman, fa } from "@/lib/fare";
import { useStore } from "@/lib/store";

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
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [op, setOp] = useState<Place | null>(null);
  const [dp, setDp] = useState<Place | null>(null);
  const [sharedDate, setSharedDate] = useState("");
  const km = op && dp ? estimatedRoadKm(op, dp) : 0;
  const night = isNightDeparture(departureISO(date, time));
  async function pick(which: "origin" | "destination", p: Point) {
    const name = (await reverseName(p)) || `${p.lat.toFixed(3)}, ${p.lng.toFixed(3)}`;
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
    const hit = await searchPlace(q.trim());
    if (!hit) return void toast.error("این مکان پیدا نشد؛ روی نقشه انتخاب کنید.");
    if (which === "origin") setOp(hit);
    else setDp(hit);
  }
  const [mountain, setMountain] = useState(false);
  const [suggest, setSuggest] = useState("");
  const [rideType, setRideType] = useState<RideType>("intercity");
  const [shared, setShared] = useState(false);
  const calc = calculateFare({ km, night, mountain }).total;
  const s = suggest ? parsePersianNumber(suggest) : undefined;
  const tooLow = s !== undefined && (!Number.isFinite(s) || s < FARE.minimum);

  const submit = async () => {
    setBusy(true);
    try {
      const id = await addTrip({
        from,
        to,
        departure: departureISO(date, time),
        km,
        night,
        mountain,
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
        <p className="text-sm opacity-80">مبدأ و مقصد را روی نقشه بزنید یا نامشان را بنویسید.</p>
      </div>
      <RouteMap
        origin={op}
        destination={dp}
        onPick={(w, p) => void pick(w, p)}
      />
      <Link
        to="/shared"
        search={{ origin: "", destination: "", departure: "", ride: "" }}
        className="flex items-center gap-2 text-sm font-bold text-primary"
      >
        <Users className="size-5" />
        فهرست سفرهای اشتراکی بین‌شهری ←
      </Link>
      <Card className="space-y-3">
        <label className="block space-y-1 text-sm">
          نوع مسیر
          <select
            aria-label="نوع مسیر"
            value={rideType}
            onChange={(e) => {
              const type = e.target.value as RideType;
              setRideType(type);
              if (!sharedEligible(type)) setShared(false);
            }}
            className="w-full rounded-2xl bg-muted px-3 py-3"
          >
            <option value="urban" disabled>
              درون‌شهری — فعلاً ارائه نمی‌شود
            </option>
            <option value="intercity">برون‌شهری / بین‌شهری</option>
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
          <button type="button" aria-label="یافتن مبدأ روی نقشه" onClick={() => void locate("origin")}>
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
          <button type="button" aria-label="یافتن مقصد روی نقشه" onClick={() => void locate("destination")}>
            <Search className="size-4" />
          </button>
        </label>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div className="rounded-2xl bg-muted p-3">
            مسافت (خودکار)
            <b className="block">{km ? `${fa(km)} کیلومتر` : "مبدأ و مقصد را مشخص کنید"}</b>
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
          مسافت از فاصلهٔ دو نقطه روی نقشه با ضریب جاده تخمین زده می‌شود؛ سرویس مسیریابی دقیق متصل نیست.
        </p>
        <Toggle on={mountain} set={setMountain} I={Mountain} l="جاده کوهستانی" />
        <div className="border-t border-border pt-3">
          <label
            className={`flex items-center gap-2 font-bold ${!sharedEligible(rideType) ? "text-muted-foreground" : "text-primary"}`}
          >
            <input
              type="checkbox"
              checked={shared}
              disabled={!sharedEligible(rideType)}
              onChange={(e) => setShared(e.target.checked)}
              className="size-5 accent-primary"
            />
            <Users className="size-5" />
            سفر اشتراکی
          </label>
          {!sharedEligible(rideType) && (
            <p className="mt-2 text-xs text-muted-foreground">
              سفر اشتراکی فقط برای مسیرهای برون‌شهری / بین‌شهری فعال است؛ برای سفر درون‌شهری در
              دسترس نیست.
            </p>
          )}
        </div>
        {!shared && (
          <div className="grid gap-2">
            <label>
              تاریخ حرکت (شمسی)
              <JalaliDateInput label="تاریخ حرکت" value={date} onChange={setDate} />
            </label>
            <label>
              ساعت حرکت
              <input
                aria-label="ساعت حرکت"
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="w-full rounded-2xl bg-muted p-3"
              />
            </label>
          </div>
        )}
        {shared && (
          <SharedRequest
            key={`${from}|${to}|${calc}`}
            origin={from}
            destination={to}
            fare={calc}
            date={sharedDate}
            onDate={setSharedDate}
          />
        )}
      </Card>
      <Card>
        <h2 className="mb-2 font-bold">جزئیات کرایه</h2>
        <FareTable km={km} night={night} mountain={mountain} />
      </Card>
      {!shared && (
        <>
          <Card className="space-y-2">
            <h2 className="font-bold">کرایه پیشنهادی شما (اختیاری)</h2>
            <p className="text-sm text-muted-foreground">
              کرایه محاسبه‌شده {toman(calc)} است. می‌توانید مبلغ دیگری پیشنهاد دهید؛ راننده تصمیم
              می‌گیرد.
            </p>
            <input
              inputMode="numeric"
              value={suggest}
              onChange={(e) => setSuggest(e.target.value)}
              placeholder="مثلاً ۱۵۰۰۰۰"
              className="w-full rounded-2xl bg-muted px-4 py-3 outline-none"
            />
            {s !== undefined && !tooLow && (
              <p className="text-sm text-primary">پیشنهاد شما: {toman(s)}</p>
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
          <DemoNote>
            شماره تماس شما فقط پس از پذیرش سفر به راننده نمایش داده می‌شود. نام شما از ابتدا دیده
            می‌شود.
          </DemoNote>
          <Btn
            className="w-full py-4 text-lg"
            disabled={
              busy ||
              !userId ||
              !account.data?.profile.phone ||
              tooLow ||
              !km ||
              !from ||
              !to ||
              from === to ||
              !date ||
              !time
            }
            onClick={submit}
          >
            ثبت درخواست سفر
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
