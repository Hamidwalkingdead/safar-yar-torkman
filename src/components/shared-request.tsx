import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useSharedAuth, SharedSignIn } from "./shared-auth";
import { Btn } from "./ui-kit";
import { departureISO, departureLabel, fareShares, parsePersianNumber } from "@/lib/shared-rides";
import { FARE, toman, fa } from "@/lib/fare";

export function SharedRequest({ origin, destination, fare }: { origin: string; destination: string; fare: number }) {
  const { userId, ready } = useSharedAuth();
  const nav = useNavigate();
  const [date, setDate] = useState("");
  const [time, setTime] = useState("08:00");
  const [seats, setSeats] = useState(1);
  const [amount, setAmount] = useState("");
  const [consent, setConsent] = useState(false);
  const [review, setReview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const total = amount ? parsePersianNumber(amount) : fare;
  const departure = departureISO(date, time);
  const valid = origin.trim().length >= 2 && destination.trim().length >= 2 && origin.trim() !== destination.trim() && Number.isInteger(total) && total >= FARE.minimum && departure && new Date(departure).getTime() > Date.now();
  const change = () => { setReview(false); setConsent(false); setError(""); };
  async function submit() {
    if (!valid || !consent || !userId) return;
    setBusy(true); setError("");
    try {
      const { data, error: failure } = await supabase.rpc("create_shared_ride", { p_origin: origin, p_destination: destination, p_departure: departure, p_fare: total, p_seats: seats, p_type: "intercity", p_consent: consent });
      if (failure) { setError("ثبت سفر انجام نشد؛ زمان حرکت، مبلغ و ورود به حساب را بررسی کنید."); return; }
      await nav({ to: "/shared", search: { ride: data, origin: "", destination: "", departure: "" } });
    } catch { setError("ثبت سفر انجام نشد؛ دوباره تلاش کنید."); }
    finally { setBusy(false); }
  }
  return <section className="space-y-4 border-t border-border pt-4">
    <h2 className="text-lg font-bold">زمان و ظرفیت سفر اشتراکی</h2>
    <div className="grid grid-cols-2 gap-3">
      <label className="min-w-0 space-y-1 text-sm">تاریخ حرکت<input aria-label="تاریخ حرکت" type="date" value={date} onChange={(e) => { setDate(e.target.value); change(); }} className="block w-full min-w-0 rounded-xl bg-muted px-3 py-3" /></label>
      <label className="min-w-0 space-y-1 text-sm">ساعت حرکت (تهران)<input aria-label="ساعت حرکت" type="time" value={time} onChange={(e) => { setTime(e.target.value); change(); }} className="block w-full min-w-0 rounded-xl bg-muted px-3 py-3" /></label>
    </div>
    <label className="block space-y-1 text-sm">تعداد صندلی موردنیاز<select aria-label="تعداد صندلی موردنیاز" value={seats} onChange={(e) => { setSeats(Number(e.target.value)); change(); }} className="w-full rounded-xl bg-muted px-3 py-3">{[1, 2, 3].map((n) => <option key={n} value={n}>{fa(n)} صندلی</option>)}</select></label>
    <label className="block space-y-1 text-sm">کرایه کل سرویس (تومان)<input aria-label="کرایه کل سرویس" inputMode="numeric" placeholder={fa(fare)} value={amount} onChange={(e) => { setAmount(e.target.value); change(); }} className="w-full rounded-xl bg-muted px-3 py-3" /></label>
    {(!Number.isInteger(total) || total < FARE.minimum) && <p role="alert" className="text-sm text-destructive">کرایه کل باید حداقل {toman(FARE.minimum)} باشد.</p>}
    <p className="text-sm text-muted-foreground">حداکثر ۳ مسافر؛ هر صندلی برای یک مسافر. تا تکمیل ظرفیت یا بستن آن، سهم کرایه موقت است.</p>
    {date && <Link to="/shared" search={{ origin, destination, departure, ride: "" }} className="block text-sm font-bold text-primary">دیدن سفرهای هم‌مسیر و نزدیک به این ساعت ←</Link>}
    {!ready ? <p className="text-sm text-muted-foreground">در حال بررسی حساب…</p> : !userId ? <SharedSignIn /> : <>
      {!review ? <Btn className="w-full" disabled={!valid} onClick={() => { setReview(true); setConsent(false); }}>بررسی درخواست اشتراکی</Btn> : <div className="space-y-3 rounded-xl bg-secondary p-4">
        <b className="block">تأیید ثبت درخواست</b>
        <p className="text-sm">{origin} ← {destination}</p><p className="text-sm">{departure && departureLabel(departure)} · {fa(seats)} صندلی</p>
        <p className="text-sm">کرایه کل: <b>{toman(total)}</b></p>
        <p className="text-sm">سهم فعلی رزرو شما: <b>{toman(total)}</b> {seats < 3 ? "(موقت و قابل تغییر)" : "(ظرفیت تکمیل)"}</p>
        <p className="text-sm">با ۳ مسافر، سهم هر نفر: <b>{toman(fareShares(total, 3)[0] ?? 0)}</b>{total % 3 !== 0 && "؛ اختلاف گرد کردن حداکثر ۱ تومان است."}</p>
        <p className="text-xs text-muted-foreground">این تأیید فقط ثبت درخواست است؛ پیش از تأیید نهایی سفر، مبلغ قطعی را جداگانه تأیید می‌کنید.</p>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1 size-4 shrink-0 accent-primary" />ثبت این درخواست و سهم موقت را تأیید می‌کنم.</label>
        <Btn className="w-full" disabled={!valid || !consent || busy} onClick={submit}>{busy ? "در حال ثبت…" : "تأیید و ثبت سفر اشتراکی"}</Btn>
      </div>}
    </>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </section>;
}