import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useSharedAuth, SharedSignIn } from "./shared-auth";
import { useAccount } from "@/lib/account";
import { passengerProfileComplete } from "@/lib/passenger-panel";
import { Btn } from "./ui-kit";
import { JalaliDateInput } from "./jalali-date-input";
import { departureISO, departureLabel, normalizeIranPhone, parsePersianNumber } from "@/lib/shared-rides";
import type { Point } from "@/lib/geo";
import { FARE, toman, fa, calculateFare } from "@/lib/fare";

type Result = { id:string; totalFare:number; totalDistanceKm:number; myFare:number; myDistanceKm:number; grouped:boolean; passengerCount:number };

export function SharedRequest({
  origin,destination,originPoint,destinationPoint,fare,mountain,routeVerified,
}: {
  origin:string;destination:string;originPoint:Point|null;destinationPoint:Point|null;
  fare:number;mountain:boolean;routeVerified:boolean;
}) {
  const { userId,ready } = useSharedAuth();
  const account = useAccount();
  const profileComplete = passengerProfileComplete(account.data?.profile ?? null);
  const [date,setDate]=useState("");
  const [time,setTime]=useState("08:00");
  const [seats,setSeats]=useState(1);
  const [consent,setConsent]=useState(false);
  const [review,setReview]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [result,setResult]=useState<Result|null>(null);
  const [requestNote,setRequestNote]=useState("");
  const [womenOnly,setWomenOnly]=useState(false);
  const [femaleDriverRequested,setFemaleDriverRequested]=useState(false);
  const [forOtherPerson,setForOtherPerson]=useState(false);
  const [contactName,setContactName]=useState("");
  const [contactPhone,setContactPhone]=useState("");
  const departure=departureISO(date,time);
  const phone=normalizeIranPhone(contactPhone);
  const night=departure?(()=>{const hour=Number(new Intl.DateTimeFormat("en-US",{timeZone:"Asia/Tehran",hour:"2-digit",hourCycle:"h23"}).format(new Date(departure)));return hour>=22||hour<6;})():false;
  const estimatedFare=calculateFare({km:fare?fare/FARE.standardPerKm:0,night,mountain}).total;
  const valid=routeVerified&&!!originPoint&&!!destinationPoint&&origin.trim().length>=2&&destination.trim().length>=2
    &&origin.trim()!==destination.trim()&&Number.isInteger(seats)&&seats>=1&&seats<=3
    &&!!departure&&new Date(departure).getTime()>Date.now()
    &&requestNote.length<=500&&(!forOtherPerson||(contactName.trim().length>=2&&/^09\d{9}$/.test(phone)));
  const change=()=>{setReview(false);setConsent(false);setError("");};
  async function submit(){
    if(!valid||!consent||!userId)return;
    setBusy(true);setError("");
    try{
      const {data,error:failure}=await supabase.functions.invoke<Result>("create-shared-ride",{body:{
        origin:originPoint,destination:destinationPoint,originName:origin,destinationName:destination,
        departure,seats,mountain,requestNote,womenOnly,femaleDriverRequested,forOtherPerson,
        contactName:forOtherPerson?contactName.trim():null,contactPhone:forOtherPerson?phone:null
      }});
      if(failure){
        const response=(failure as {context?:Response}).context;
        if(response){try{const payload=await response.clone().json() as {error?:string};if(payload.error)throw new Error(payload.error);}catch(e){if(e instanceof Error&&e.message!=="Unexpected end of JSON input")throw e;}}
        throw new Error("ثبت درخواست اشتراکی انجام نشد؛ اتصال را بررسی کنید.");
      }
      if(!data?.id||!Number.isFinite(data.myFare))throw new Error("نتیجه ثبت درخواست از سرور دریافت نشد.");
      setResult(data);
    }catch(e){setError(e instanceof Error?e.message:"ثبت درخواست انجام نشد.");}
    finally{setBusy(false);}
  }
  if(result)return <div className="space-y-3 rounded-2xl border border-primary/30 bg-primary/5 p-4 text-sm">
    <b className="text-primary">درخواست سفر اشتراکی ثبت شد.</b>
    <div className="grid grid-cols-2 gap-2">
      <div className="rounded-xl bg-background p-3"><span className="text-xs text-muted-foreground">سهم محاسبه‌شده شما</span><b className="mt-1 block text-lg">{toman(result.myFare)}</b></div>
      <div className="rounded-xl bg-background p-3"><span className="text-xs text-muted-foreground">مسافت محاسباتی سهم شما</span><b className="mt-1 block text-lg">{fa(result.myDistanceKm)} کیلومتر</b></div>
    </div>
    <p>مسافت کل مسیر گروه: {fa(result.totalDistanceKm)} کیلومتر · کرایه کل گروه: {toman(result.totalFare)}</p>
    <p className="text-xs text-muted-foreground">{result.grouped?"درخواست شما با هم‌مسیرهای سازگار گروه‌بندی شد.":"فعلاً گروه هم‌مسیر مناسبی نبود؛ درخواست شما به‌عنوان گروه تازه ثبت شد."} سهم هر مسافر بر اساس مسیر و توقف‌های واقعی محاسبه می‌شود؛ مسیر خالی برای سوارکردن نفر بعد نیز در سهم‌ها لحاظ شده است.</p>
    <Link to="/shared" className="inline-block font-bold text-primary">مشاهده درخواست و وضعیت گروه ←</Link>
  </div>;
  return <section className="space-y-4 border-t border-border pt-4">
    <h2 className="text-lg font-bold">درخواست سفر اشتراکی</h2>
    {!routeVerified&&<p className="text-sm text-destructive">ابتدا مبدأ و مقصد را روی نقشه انتخاب کنید تا مسیر جاده‌ای تأیید شود.</p>}
    <div className="grid grid-cols-2 gap-3">
      <label className="min-w-0 space-y-1 text-sm">تاریخ حرکت (شمسی)
        <JalaliDateInput label="تاریخ حرکت" value={date} onChange={v=>{setDate(v);change();}}/>
      </label>
      <label className="min-w-0 space-y-1 text-sm">ساعت حرکت
        <input aria-label="ساعت حرکت" type="time" value={time} onChange={e=>{setTime(e.target.value);change();}} className="block w-full min-w-0 rounded-xl bg-muted px-3 py-3"/>
      </label>
    </div>
    <label className="block space-y-1 text-sm">تعداد صندلی
      <select aria-label="تعداد صندلی" value={seats} onChange={e=>{setSeats(Number(e.target.value));change();}} className="w-full rounded-xl bg-muted px-3 py-3">
        {[1,2,3].map(n=><option key={n} value={n}>{fa(n)} نفر</option>)}
      </select>
    </label>
    <div className="rounded-xl bg-muted p-3 text-sm">
      <span className="text-muted-foreground">کرایه تخمینی مسیر فعلی شما</span>
      <b className="mt-1 block text-lg">{toman(estimatedFare)}</b>
      <p className="mt-1 text-xs text-muted-foreground">سهم نهایی پس از محاسبه مسیر همه سوار و پیاده‌شدن‌ها تعیین می‌شود؛ کرایه کل گروه بین مسافران مساوی تقسیم نمی‌شود.</p>
    </div>
    <div className="space-y-3 rounded-xl border p-3">
      <b className="text-sm">شرایط و توضیحات (اختیاری)</b>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={womenOnly} onChange={e=>{setWomenOnly(e.target.checked);change();}} className="mt-1 size-4 accent-primary"/><span>ترجیح می‌دهم هم‌سفران گروه خانم باشند</span></label>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={femaleDriverRequested} onChange={e=>{setFemaleDriverRequested(e.target.checked);change();}} className="mt-1 size-4 accent-primary"/><span>درخواست راننده خانم دارم</span></label>
      <p className="text-xs text-muted-foreground">این موارد به‌عنوان ترجیح ثبت و به راننده نمایش داده می‌شوند؛ تا زمانی که هویت جنسیتی احراز نشده باشد، تضمین قطعی نیستند. گروه‌های دارای شرط هم‌سفر خانم با گروه‌های بدون این شرط ترکیب نمی‌شوند.</p>
      <label className="block space-y-1 text-sm">توضیح اضافه برای راننده
        <textarea value={requestNote} maxLength={500} onChange={e=>{setRequestNote(e.target.value);change();}} rows={3} placeholder="مثلاً بار همراه دارم، توقف کوتاه لازم دارم..." className="w-full rounded-xl bg-muted px-3 py-3"/>
        <span className="text-xs text-muted-foreground">{fa(requestNote.length)} از ۵۰۰ نویسه</span>
      </label>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={forOtherPerson} onChange={e=>{setForOtherPerson(e.target.checked);change();}} className="mt-1 size-4 accent-primary"/><span>این درخواست را برای شخص دیگری ثبت می‌کنم</span></label>
      {forOtherPerson&&<div className="space-y-2 rounded-xl bg-muted p-3">
        <label className="block space-y-1 text-sm">نام مسافر
          <input value={contactName} onChange={e=>{setContactName(e.target.value);change();}} maxLength={80} placeholder="نام و نام خانوادگی" className="w-full rounded-xl bg-background px-3 py-3"/>
        </label>
        <label className="block space-y-1 text-sm">شماره همراه مسافر
          <input value={contactPhone} onChange={e=>{setContactPhone(e.target.value);change();}} inputMode="tel" maxLength={13} placeholder="۰۹۱۲۳۴۵۶۷۸۹" className="w-full rounded-xl bg-background px-3 py-3"/>
        </label>
        <p className="text-xs text-muted-foreground">شماره به‌صورت رمزنگاری‌شده نگهداری می‌شود و فقط پس از پذیرش گروه، در اختیار راننده همان سفر قرار می‌گیرد.</p>
      </div>}
    </div>
    {!ready?<p className="text-sm text-muted-foreground">در حال بررسی حساب…</p>
    :!userId?<SharedSignIn/>
    :account.isLoading?<p className="text-sm text-muted-foreground">در حال بررسی کامل بودن پروفایل…</p>
    :account.isError?<p role="alert" className="text-sm text-destructive">بررسی پروفایل انجام نشد؛ دوباره تلاش کنید.</p>
    :!profileComplete?<div className="rounded-xl border border-amber-500/40 p-3 text-sm"><b>برای ثبت سفر اشتراکی، پروفایل را کامل کنید.</b><p className="mt-1 text-muted-foreground">نام، نام خانوادگی، نام نمایشی و شماره تماس اضطراری لازم است.</p><Link to="/profile" className="mt-2 inline-block font-bold text-primary">تکمیل پروفایل ←</Link></div>
    :!review?<Btn className="w-full" disabled={!valid} onClick={()=>{setReview(true);setConsent(false);}}>بررسی سهم و ثبت درخواست</Btn>
    :<div className="space-y-3 rounded-xl bg-secondary p-4">
      <b className="block">بازبینی درخواست اشتراکی</b>
      <p className="text-sm">{origin} ← {destination}</p>
      <p className="text-sm">{departure&&departureLabel(departure)} · {fa(seats)} صندلی</p>
      <p className="text-sm">کرایه تخمینی فعلی: <b>{toman(estimatedFare)}</b></p>
      <p className="text-xs text-muted-foreground">پس از پیدا شدن هم‌مسیرها، مسیر بهینه با رعایت ترتیب سوار و پیاده‌شدن محاسبه می‌شود. سهم هر نفر شامل مسافت حضور در خودرو و سهم منصفانه از جابه‌جایی لازم برای سوارکردن نفر بعد است. پیش از تأیید نهایی گروه، سهم قطعی به شما نمایش داده می‌شود.</p>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)} className="mt-1 size-4 accent-primary"/>ثبت درخواست با این شرایط را تأیید می‌کنم.</label>
      <Btn className="w-full" disabled={!valid||!consent||busy} onClick={submit}>{busy?"در حال محاسبه مسیر و ثبت…":"تأیید و ثبت سفر اشتراکی"}</Btn>
    </div>}
    {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
  </section>;
}
