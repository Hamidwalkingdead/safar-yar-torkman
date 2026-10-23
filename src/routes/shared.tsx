import { createFileRoute, Link } from "@tanstack/react-router";
import { queryOptions, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Users, MapPin, CalendarClock, Check, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { listSharedRides } from "@/lib/shared-rides.functions";
import {
  type SharedRide,
  fareShares,
  joiningAmount,
  canJoin,
  matchesRide,
  departureISO,
  departureLabel,
} from "@/lib/shared-rides";
import { fa, toman } from "@/lib/fare";
import { Badge, Btn, Card } from "@/components/ui-kit";
import { SharedSignIn, useSharedAuth } from "@/components/shared-auth";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";

const publicOptions = queryOptions({
  queryKey: ["shared-rides", "public"],
  queryFn: () => listSharedRides(),
});
export const Route = createFileRoute("/shared")({
  validateSearch: (s: Record<string, unknown>) => ({
    origin: typeof s["origin"] === "string" ? s["origin"] : "",
    destination: typeof s["destination"] === "string" ? s["destination"] : "",
    departure: typeof s["departure"] === "string" ? s["departure"] : "",
    ride: typeof s["ride"] === "string" ? s["ride"] : "",
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(publicOptions),
  head: () => ({
    meta: [
      { title: "سفرهای اشتراکی بین‌شهری | سفر یار ترکمن" },
      {
        name: "description",
        content:
          "سفر هم‌مسیر و هم‌زمان پیدا کنید، با تأیید خودتان ملحق شوید و سهم کرایه را ببینید.",
      },
      { property: "og:title", content: "سفرهای اشتراکی بین‌شهری | سفر یار ترکمن" },
      { property: "og:description", content: "هم‌سفر شوید؛ ظرفیت سه مسافر و کرایه شفاف." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Shared,
  errorComponent: () => (
    <div className="space-y-3 p-6">
      <h1 className="text-xl font-bold">فهرست سفرها در دسترس نیست</h1>
      <p>لطفاً دوباره تلاش کنید.</p>
      <Btn onClick={() => window.location.reload()}>تلاش دوباره</Btn>
    </div>
  ),
});

function Shared() {
  const search = Route.useSearch();
  const { userId, ready } = useSharedAuth();
  const { data: publicRides } = useSuspenseQuery(publicOptions);
  const cache = useQueryClient();
  const privateQuery = useQuery({
    queryKey: ["shared-rides", "private", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("shared_listing");
      if (error) throw new Error("دریافت اطلاعات حساب ممکن نشد");
      return data as unknown as SharedRide[];
    },
    refetchInterval: 15000,
  });
  const rides = userId ? (privateQuery.data ?? []) : publicRides;
  const [origin, setOrigin] = useState(search.origin);
  const [destination, setDestination] = useState(search.destination);
  const [date, setDate] = useState(search.departure ? search.departure.slice(0, 10) : "");
  const [time, setTime] = useState(
    search.departure
      ? new Intl.DateTimeFormat("en-GB", {
          timeZone: "Asia/Tehran",
          hour: "2-digit",
          minute: "2-digit",
        }).format(new Date(search.departure))
      : "08:00",
  );
  const [filter, setFilter] = useState(
    !!search.origin && !!search.destination && !!search.departure,
  );
  const [mine, setMine] = useState(false);
  const [action, setAction] = useState<{ id: string; kind: "join" | "lock" | "confirm" } | null>(
    null,
  );
  const [seats, setSeats] = useState(1);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const selected = rides.find((r) => r.id === action?.id);
  const departure = departureISO(date, time);
  const shown = rides.filter(
    (r) =>
      (!mine || r.myBooking) &&
      (!filter || (departure && matchesRide(r, origin, destination, departure))),
  );
  const refresh = () => cache.invalidateQueries({ queryKey: ["shared-rides"] });
  const open = (r: SharedRide, kind: "join" | "lock" | "confirm") => {
    setAction({ id: r.id, kind });
    setConsent(false);
    setSeats(1);
    setError("");
  };
  const joinAmount =
    selected && canJoin(selected.occupied, seats, true)
      ? joiningAmount(selected.totalFare, selected.occupied, seats)
      : 0;
  async function apply() {
    if (!action || !selected || !userId || !consent || busy) return;
    setBusy(true);
    setError("");
    try {
      const result =
        action.kind === "join"
          ? await supabase.rpc("join_shared_ride", {
              p_ride: selected.id,
              p_seats: seats,
              p_expected: joinAmount,
              p_consent: consent,
            })
          : action.kind === "lock"
            ? await supabase.rpc("lock_shared_ride", { p_ride: selected.id })
            : await supabase.rpc("confirm_shared_price", {
                p_ride: selected.id,
                p_amount: selected.myBooking?.amount ?? 0,
                p_consent: consent,
              });
      if (result.error) {
        setError(
          "ثبت انجام نشد؛ ظرفیت یا قیمت ممکن است تغییر کرده باشد. اطلاعات تازه را بررسی و دوباره تأیید کنید.",
        );
        setConsent(false);
        await refresh();
        return;
      }
      await refresh();
      setAction(null);
    } catch {
      setError("ارتباط برقرار نشد؛ دوباره تلاش کنید.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-4 p-4">
      <header className="flex items-center justify-between gap-2 pt-2">
        <div>
          <h1 className="text-2xl font-black">سفرهای اشتراکی</h1>
          <p className="mt-1 text-sm text-muted-foreground">بین‌شهری · حداکثر ۳ مسافر</p>
        </div>
        <Users className="size-9 shrink-0 text-primary" />
      </header>
      <p className="text-sm text-muted-foreground">
        رزرو صندلی و تأیید سهم کرایه ثبت می‌شود؛ اتصال به پذیرش راننده، تماس طرفین و شروع یا پایان
        سفر اشتراکی هنوز فعال نیست. تأیید مبلغ به معنی تأمین خودرو یا پرداخت نیست.
      </p>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link to="/passenger" className="text-sm font-bold text-primary">
          + درخواست سفر جدید
        </Link>
        <Btn
          variant="ghost"
          aria-label="تازه‌سازی سفرها"
          title="تازه‌سازی سفرها"
          onClick={refresh}
          className="px-3"
        >
          <RefreshCw className="size-4" />
        </Btn>
      </div>
      <section className="space-y-3 border-y border-border py-4">
        <h2 className="font-bold">پیدا کردن هم‌مسیر</h2>
        <div className="grid grid-cols-2 gap-2">
          <input
            aria-label="مبدأ جستجو"
            placeholder="مبدأ، مثلاً تهران"
            value={origin}
            onChange={(e) => {
              setOrigin(e.target.value);
              setFilter(false);
            }}
            className="min-w-0 rounded-xl bg-muted px-3 py-3 text-sm"
          />
          <input
            aria-label="مقصد جستجو"
            placeholder="مقصد، مثلاً رشت"
            value={destination}
            onChange={(e) => {
              setDestination(e.target.value);
              setFilter(false);
            }}
            className="min-w-0 rounded-xl bg-muted px-3 py-3 text-sm"
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="min-w-0 text-sm">
            تاریخ
            <input
              aria-label="تاریخ جستجو"
              type="date"
              value={date}
              onChange={(e) => {
                setDate(e.target.value);
                setFilter(false);
              }}
              className="mt-1 w-full min-w-0 rounded-xl bg-muted px-3 py-3"
            />
          </label>
          <label className="min-w-0 text-sm">
            ساعت (تهران)
            <input
              aria-label="ساعت جستجو"
              type="time"
              value={time}
              onChange={(e) => {
                setTime(e.target.value);
                setFilter(false);
              }}
              className="mt-1 w-full min-w-0 rounded-xl bg-muted px-3 py-3"
            />
          </label>
        </div>
        <p className="text-xs text-muted-foreground">
          مبدأ و مقصد مشابه، در همان روز و تا یک ساعت اختلاف حرکت.
        </p>
        <div className="flex gap-2">
          <Btn
            className="flex-1"
            disabled={!origin.trim() || !destination.trim() || !date || !time}
            onClick={() => setFilter(true)}
          >
            جستجوی هم‌مسیر
          </Btn>
          <Btn
            variant="ghost"
            onClick={() => {
              setFilter(false);
              setMine(false);
            }}
          >
            همه سفرها
          </Btn>
        </div>
      </section>
      {userId && (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={mine}
            onChange={(e) => setMine(e.target.checked)}
            className="size-4 accent-primary"
          />
          فقط سفرهای من
        </label>
      )}
      {ready && !userId && <SharedSignIn />}
      {userId && privateQuery.isPending && <p>در حال دریافت سفرهای شما…</p>}
      {privateQuery.isError && (
        <p role="alert" className="text-sm text-destructive">
          دریافت سفرهای شما انجام نشد؛ تازه‌سازی کنید.
        </p>
      )}
      {shown.length === 0 && (!userId || !privateQuery.isPending) && (
        <div className="py-8 text-center">
          <Users className="mx-auto mb-3 size-8 text-muted-foreground" />
          <p>{filter ? "سفر هم‌مسیر در این زمان پیدا نشد." : "هنوز سفری در این فهرست نیست."}</p>
          <Link to="/passenger" className="mt-3 inline-block text-primary">
            ثبت درخواست سفر
          </Link>
        </div>
      )}
      {shown.map((r) => (
        <Card
          key={r.id}
          className={`space-y-3 ${search.ride === r.id ? "ring-2 ring-primary" : ""}`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Badge tone="primary">
              {new Date(r.departureAt).getTime() <= Date.now()
                ? "زمان حرکت گذشته · انجام سفر تأیید نشده"
                : r.state === "confirmed"
                  ? "سهم کرایه تأیید شد · بدون راننده"
                  : r.state === "locked"
                    ? "ظرفیت بسته · قیمت قطعی"
                    : "در حال تکمیل"}
            </Badge>
            <span className="text-sm font-bold">{fa(r.occupied)} از ۳ مسافر</span>
          </div>
          <div className="flex items-start gap-2 font-bold">
            <MapPin className="mt-1 size-4 shrink-0 text-primary" />
            <span className="break-words">
              {r.origin} ← {r.destination}
            </span>
          </div>
          <p className="flex items-center gap-2 text-sm">
            <CalendarClock className="size-4 shrink-0 text-primary" />
            {departureLabel(r.departureAt)}
          </p>
          <div className="space-y-2 rounded-xl bg-muted p-3">
            <div className="flex flex-wrap justify-between gap-1 text-sm">
              <span>کرایه کل سرویس</span>
              <b>{toman(r.totalFare)}</b>
            </div>
            <div className="border-t border-border pt-2 text-sm">
              <b>
                {r.state === "open" ? "سهم فعلی هر نفر (موقت و قابل تغییر)" : "سهم قطعی هر نفر"}
              </b>
              {fareShares(r.totalFare, r.occupied).map((price, i) => (
                <div key={i} className="mt-1 flex justify-between gap-2">
                  <span>مسافر {fa(i + 1)}</span>
                  <span>{toman(price)}</span>
                </div>
              ))}
            </div>
            {r.myBooking && (
              <div className="border-t border-border pt-2 text-sm text-primary">
                <b>
                  رزرو شما: {fa(r.myBooking.seats)} صندلی · {toman(r.myBooking.amount)}
                </b>
                <p className="mt-1 text-xs">
                  {r.state === "open"
                    ? "این مبلغ موقت است؛ با پیوستن دیگران تغییر می‌کند."
                    : r.myBooking.confirmed
                      ? "مبلغ قطعی را تأیید کرده‌اید."
                      : "مبلغ قطعی است؛ تأیید شما هنوز لازم است."}
                </p>
              </div>
            )}
          </div>
          {r.state === "open" && (
            <p className="text-xs text-muted-foreground">
              با تکمیل ۳ مسافر، کرایه بین سه نفر تقسیم می‌شود؛ قیمت نهایی نیاز به تأیید جداگانه
              دارد.
            </p>
          )}
          {r.myBooking ? (
            <>
              {r.isOwner && r.state === "open" && (
                <Btn variant="ghost" className="w-full" onClick={() => open(r, "lock")}>
                  بستن ظرفیت و تعیین قیمت قطعی
                </Btn>
              )}
              {r.state === "locked" && !r.myBooking.confirmed && (
                <Btn className="w-full" onClick={() => open(r, "confirm")}>
                  بررسی و تأیید مبلغ قطعی
                </Btn>
              )}
              {r.myBooking.confirmed && (
                <p className="flex items-center gap-1 text-sm text-primary">
                  <Check className="size-4" />
                  {r.state === "confirmed"
                    ? "همه رزروها تأیید شده‌اند."
                    : "منتظر تأیید سایر رزروها"}
                </p>
              )}
            </>
          ) : r.state === "open" && userId ? (
            <Btn className="w-full" onClick={() => open(r, "join")}>
              بررسی و پیوستن به سفر
            </Btn>
          ) : r.state !== "open" ? (
            <p className="text-center text-sm text-muted-foreground">پذیرش مسافر جدید بسته است.</p>
          ) : null}
        </Card>
      ))}
      <Dialog
        open={!!action}
        onOpenChange={(value) => {
          if (!value && !busy) setAction(null);
        }}
      >
        <DialogContent
          dir="rtl"
          className="max-h-[85vh] w-[calc(100%-2rem)] overflow-y-auto rounded-xl pt-10"
        >
          <DialogTitle>
            {action?.kind === "join"
              ? "تأیید پیوستن به سفر"
              : action?.kind === "lock"
                ? "بستن ظرفیت سفر"
                : "تأیید قیمت نهایی سفر"}
          </DialogTitle>
          <DialogDescription>
            {selected?.origin} ← {selected?.destination}
            {selected && ` · ${departureLabel(selected.departureAt)}`}
          </DialogDescription>
          {selected && (
            <>
              <p className="text-sm">
                کرایه کل سرویس: <b>{toman(selected.totalFare)}</b>
              </p>
              {action?.kind === "join" ? (
                <>
                  <label className="space-y-1 text-sm">
                    صندلی موردنیاز
                    <select
                      aria-label="صندلی برای پیوستن"
                      value={seats}
                      onChange={(e) => {
                        setSeats(Number(e.target.value));
                        setConsent(false);
                      }}
                      className="mt-1 w-full rounded-xl bg-muted px-3 py-3"
                    >
                      {Array.from({ length: 3 - selected.occupied }, (_, i) => i + 1).map((n) => (
                        <option key={n} value={n}>
                          {fa(n)} صندلی
                        </option>
                      ))}
                    </select>
                  </label>
                  <p>
                    سهم رزرو شما پس از پیوستن: <b>{toman(joinAmount)}</b>
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {selected.occupied + seats < 3
                      ? "موقت و قابل تغییر؛ قیمت قطعی پیش از تأیید نهایی نشان داده می‌شود."
                      : "ظرفیت به ۳ مسافر می‌رسد؛ پس از پیوستن باید قیمت قطعی را جداگانه تأیید کنید."}
                  </p>
                </>
              ) : action?.kind === "lock" ? (
                <>
                  <p>
                    با {fa(selected.occupied)} مسافر ظرفیت بسته می‌شود و مسافر جدید پذیرفته نخواهد
                    شد.
                  </p>
                  <p>
                    سهم قطعی رزرو شما: <b>{toman(selected.myBooking?.amount ?? 0)}</b>
                  </p>
                  <p className="text-sm text-muted-foreground">
                    پس از بستن ظرفیت، همه رزروها باید مبلغ قطعی خود را تأیید کنند.
                  </p>
                </>
              ) : (
                <>
                  <p>مبلغ قطعی رزرو شما ({fa(selected.myBooking?.seats ?? 0)} صندلی):</p>
                  <p className="text-2xl font-black text-primary">
                    {toman(selected.myBooking?.amount ?? 0)}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    ظرفیت بسته شده؛ این مبلغ دیگر با پیوستن مسافر تغییر نمی‌کند.
                  </p>
                </>
              )}
              <label className="flex items-start gap-2 text-sm">
                <input
                  aria-label="تأیید شرایط سفر"
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                  className="mt-1 size-4 shrink-0 accent-primary"
                />
                {action?.kind === "join"
                  ? "با آگاهی از مبلغ و شرایط، پیوستن را تأیید می‌کنم."
                  : action?.kind === "lock"
                    ? "بستن ظرفیت با تعداد فعلی مسافران را تأیید می‌کنم."
                    : "مبلغ قطعی بالا را برای سفر تأیید می‌کنم."}
              </label>
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
              <Btn
                disabled={
                  !consent ||
                  busy ||
                  (action?.kind === "join" && !canJoin(selected.occupied, seats, consent))
                }
                onClick={apply}
              >
                {busy
                  ? "در حال ثبت…"
                  : action?.kind === "join"
                    ? "تأیید و پیوستن"
                    : action?.kind === "lock"
                      ? "تأیید بستن ظرفیت"
                      : "تأیید نهایی سفر و مبلغ"}
              </Btn>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
