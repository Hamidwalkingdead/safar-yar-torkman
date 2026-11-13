import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Card, Btn, DemoNote } from "@/components/ui-kit";
import { SharedSignIn, useSharedAuth } from "@/components/shared-auth";
import { useAccount } from "@/lib/account";
import { supabase } from "@/integrations/supabase/client";
import { DriverDocuments, useDriverDocs, DOC_KINDS } from "@/components/driver-documents";
import type { Database } from "@/integrations/supabase/types";
import { fa, toman } from "@/lib/fare";
import { isIranianMobile, normalizeIranianMobile } from "@/lib/passenger-panel";
import { billingFeatures } from "@/lib/billing-config";
export const Route = createFileRoute("/profile")({
  head: () => ({ meta: [
    { title: "پروفایل و تنظیمات | سفر یار ترکمن" },
    { name: "description", content: "اطلاعات حساب، کیف پول و تنظیمات." },
    { name: "robots", content: "noindex" },
  ] }),
  component: Profile,
});
function Profile() {
  const { userId } = useSharedAuth();
  const account = useAccount();
  const cache = useQueryClient();
  const verification = useQuery({
    queryKey: ["driver-verification-profile", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase.from("driver_verifications").select("status,note").eq("user_id", userId!).maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  return <div className="space-y-4 p-4">
    <h1 className="text-2xl font-black">پروفایل امن</h1>
    {!userId ? <SharedSignIn /> : account.data ? <>
      {billingFeatures.wallet && <WalletPanel userId={userId} />}
      <ProfileForm key={account.data.profile.id + JSON.stringify(account.data)} profile={account.data.profile} isDriver={account.data.isDriver} verificationStatus={verification.data?.status ?? null} verificationNote={verification.data?.note ?? null} />
      <Btn variant="ghost" onClick={async () => {
        await cache.cancelQueries(); cache.clear();
        const { error } = await supabase.auth.signOut();
        if (error) toast.error("خروج انجام نشد");
      }}>خروج از حساب</Btn>
    </> : <p>{account.error ? "دریافت پروفایل ممکن نشد" : "در حال دریافت…"}</p>}
    {billingFeatures.wallet && <DemoNote>موجودی کیف پول و درآمد سفرها ثبت می‌شود. شارژ آنلاین تا اتصال درگاه پرداخت فعال نیست؛ برداشت پس از بررسی مدیر انجام می‌شود.</DemoNote>}
  </div>;
}
function WalletPanel({userId}:{userId:string}) {
  const cache=useQueryClient();
  const [amount,setAmount]=useState("");
  const [card,setCard]=useState("");
  const [busy,setBusy]=useState(false);
  const wallet=useQuery({
    queryKey:["wallet",userId],
    queryFn:async()=>{
      const [w,t,requests]=await Promise.all([
        supabase.from("wallet_accounts").select("balance").eq("user_id",userId).maybeSingle(),
        supabase.from("wallet_transactions").select("id,amount,kind,description,created_at").eq("user_id",userId).order("created_at",{ascending:false}).limit(30),
        supabase.from("wallet_withdrawal_requests").select("id,amount,status,created_at,note").eq("user_id",userId).order("created_at",{ascending:false}).limit(10),
      ]);
      if(w.error) throw w.error; if(t.error) throw t.error; if(requests.error) throw requests.error;
      return {balance:w.data?.balance??0,transactions:t.data??[],requests:requests.data??[]};
    },refetchInterval:30000,
  });
  async function withdraw(){
    const n=Number(amount.replace(/[^0-9]/g,""));
    const c=card.replace(/\D/g,"");
    if(!Number.isSafeInteger(n)||n<50000||c.length!==16){toast.error("مبلغ حداقل ۵۰ هزار تومان و شماره کارت ۱۶ رقمی وارد کنید");return;}
    setBusy(true);
    try{
      const {error}=await supabase.rpc("request_wallet_withdrawal",{p_amount:n,p_card:c});
      if(error) throw error;
      toast.success("درخواست برداشت برای بررسی مدیر ثبت شد");
      setAmount("");setCard("");await cache.invalidateQueries({queryKey:["wallet",userId]});
    }catch(e){toast.error(e instanceof Error?e.message:"ثبت درخواست برداشت ناموفق بود");}
    finally{setBusy(false);}
  }
  const labels:Record<string,string>={trip_earning:"سهم راننده از سفر",topup:"شارژ",withdrawal:"برداشت",refund:"بازپرداخت",trip_refund:"بازپرداخت سفر",trip_payment:"پرداخت کرایه سفر",commission:"کمیسیون سفر نقدی",adjustment:"اصلاح موجودی"};
  return <Card className="space-y-3">
    <div className="flex items-center justify-between"><h2 className="font-bold text-lg">کیف پول حساب</h2><span className="text-xs text-muted-foreground">متصل به همین شماره حساب</span></div>
    {wallet.isLoading?<p>در حال دریافت موجودی و گردش حساب…</p>:wallet.error?<div role="alert" className="space-y-2 text-sm"><p>دریافت کیف پول ناموفق بود؛ موجودی و سوابق مالی فعلاً قابل تأیید نیست.</p><Btn variant="ghost" onClick={()=>void wallet.refetch()}>تلاش دوباره</Btn></div>:<div className="rounded-2xl bg-muted p-4">
      <p className="text-sm text-muted-foreground">{(wallet.data?.balance ?? 0) < 0 ? "بدهی کمیسیون راننده" : "موجودی کیف پول"}</p>
      <p className={`text-2xl font-black ${(wallet.data?.balance ?? 0) < 0 ? "text-destructive" : ""}`}>{toman(Math.abs(wallet.data?.balance ?? 0))}{(wallet.data?.balance ?? 0) < 0 ? " بدهکار" : ""}</p>
    </div>}
    <div className="space-y-2">
      <b>درخواست برداشت</b>
      <input aria-label="مبلغ برداشت به تومان" inputMode="numeric" placeholder="مبلغ به تومان (حداقل ۵۰٬۰۰۰)" value={amount} onChange={e=>setAmount(e.target.value)} className="w-full rounded-xl bg-muted p-3"/>
      <input aria-label="شماره کارت مقصد" inputMode="numeric" maxLength={19} placeholder="شماره کارت ۱۶ رقمی به نام خودتان" value={card} onChange={e=>setCard(e.target.value)} className="w-full rounded-xl bg-muted p-3"/>
      <Btn disabled={busy || (wallet.data?.balance ?? 0) <= 0} onClick={()=>void withdraw()}>{busy?"در حال ثبت…":"ثبت درخواست برداشت"}</Btn>
      <p className="text-xs text-muted-foreground">موجودی فقط پس از تأیید پرداخت به حساب بانکی کسر می‌شود؛ ثبت درخواست به معنی واریز وجه نیست.</p>
    </div>
    <div className="space-y-2"><b>گردش کیف پول</b>
      {wallet.isLoading?<p className="text-sm text-muted-foreground">در حال دریافت تراکنش‌ها…</p>:wallet.error?<p role="alert" className="text-sm text-destructive">سوابق تراکنش‌ها بارگذاری نشد.</p>:!wallet.data?.transactions.length?<p className="text-sm text-muted-foreground">تراکنشی ثبت نشده است.</p>:wallet.data.transactions.map(t=><div key={t.id} className="flex justify-between gap-2 border-b py-2 text-sm">
        <div><p>{labels[t.kind]??t.kind}</p><p className="text-xs text-muted-foreground">{t.description}</p></div>
        <b className={t.amount<0?"text-destructive":"text-primary"}>{t.amount>0?"+":""}{toman(t.amount)}</b>
      </div>)}
    </div>
    {!!wallet.data?.requests.length&&<div className="space-y-2"><b>درخواست‌های برداشت</b>{wallet.data.requests.map(r=><p key={r.id} className="text-sm">{toman(r.amount)} · {r.status==="pending"?"در انتظار بررسی":r.status==="paid"?"واریز شد":"رد شد"}</p>)}</div>}
  </Card>;
}
function ProfileForm({profile,isDriver,verificationStatus,verificationNote}:{profile:Database["public"]["Tables"]["profiles"]["Row"];isDriver:boolean;verificationStatus:string|null;verificationNote:string|null}) {
  const [firstName,setFirstName]=useState(profile.first_name);
  const [lastName,setLastName]=useState(profile.last_name);
  const [name,setName]=useState(profile.display_name);
  const [emergencyPhone,setEmergencyPhone]=useState(profile.emergency_phone);
  const [car,setCar]=useState(profile.car);
  const [plate,setPlate]=useState(profile.plate);
  const [busy,setBusy]=useState(false);
  const [showDriverRegistration,setShowDriverRegistration]=useState(isDriver);
  const cache=useQueryClient();
  const docs=useDriverDocs(profile.id);
  async function save(driver=false){
    setBusy(true);
    try{
      const normalizedEmergency=normalizeIranianMobile(emergencyPhone);
      if(firstName.trim().length<2||lastName.trim().length<2||name.trim().length<2)
        throw new Error("نام واقعی، نام خانوادگی و نام نمایشی را کامل کنید");
      if(!isIranianMobile(profile.phone)||!isIranianMobile(normalizedEmergency))
        throw new Error("شماره همراه احراز هویت‌شده یا شماره تماس اضطراری معتبر نیست");
      const {error}=await supabase.from("profiles").update({
        first_name:firstName.trim(),
        last_name:lastName.trim(),
        display_name:name.trim(),
        emergency_phone:normalizedEmergency,
        car:car.trim(),
        plate:plate.trim()
      }).eq("id",profile.id);
      if(error)throw error;
      if(driver){const result=await supabase.rpc("register_driver");if(result.error)throw result.error;}
      await cache.invalidateQueries({queryKey:["account"]});
      await cache.invalidateQueries({queryKey:["trips"]});
      await cache.invalidateQueries({queryKey:["driver-verification"]});
      await cache.invalidateQueries({queryKey:["driver-verification-profile"]});
      toast.success(driver?"ثبت‌نام راننده انجام شد":"پروفایل ذخیره شد");
    }catch(e){toast.error(e instanceof Error?e.message:"ذخیره انجام نشد");}
    finally{setBusy(false);}
  }
  return <Card className="space-y-4">
    <label className="block">نام واقعی<input aria-label="نام واقعی" value={firstName} onChange={e=>setFirstName(e.target.value)} className="mt-1 w-full rounded-2xl bg-muted p-3"/></label>
    <label className="block">نام خانوادگی<input aria-label="نام خانوادگی" value={lastName} onChange={e=>setLastName(e.target.value)} className="mt-1 w-full rounded-2xl bg-muted p-3"/></label>
    <label className="block">نام نمایشی یا نام مستعار<input aria-label="نام نمایشی" value={name} onChange={e=>setName(e.target.value)} className="mt-1 w-full rounded-2xl bg-muted p-3"/></label>
    <label className="block">شماره همراه احراز هویت‌شده<input aria-label="شماره همراه احراز هویت‌شده" inputMode="tel" value={profile.phone} readOnly className="mt-1 w-full rounded-2xl bg-muted p-3 opacity-75"/></label>
    <p className="text-xs text-muted-foreground">شماره همراه از ورود پیامکی حساب گرفته می‌شود و از فرم پروفایل قابل تغییر نیست.</p>
    <label className="block">شماره تماس اضطراری<input aria-label="شماره تماس اضطراری" inputMode="tel" value={emergencyPhone} onChange={e=>setEmergencyPhone(e.target.value)} className="mt-1 w-full rounded-2xl bg-muted p-3"/></label>
    <p className="text-xs text-muted-foreground">شماره اضطراری برای مواقع ضروری نگهداری می‌شود و در فهرست عمومی یا برای مسافران دیگر نمایش داده نمی‌شود.</p>
    <Btn disabled={busy} onClick={()=>void save()}>ذخیره پروفایل</Btn>
    {!isDriver && <Btn variant="ghost" onClick={()=>setShowDriverRegistration((value)=>!value)}>{showDriverRegistration ? "بستن بخش ثبت‌نام راننده" : "می‌خواهم راننده هم باشم"}</Btn>}
    {(isDriver || showDriverRegistration) && <>
      <label className="block">مدل و رنگ خودرو<input aria-label="مدل و رنگ خودرو" value={car} onChange={e=>setCar(e.target.value)} className="mt-1 w-full rounded-2xl bg-muted p-3"/></label>
      <label className="block">پلاک خودرو<input aria-label="پلاک خودرو" value={plate} onChange={e=>setPlate(e.target.value)} className="mt-1 w-full rounded-2xl bg-muted p-3"/></label>
      {verificationStatus !== "approved" && <DriverDocuments userId={profile.id}/>}
      {isDriver && <div className="rounded-xl bg-muted p-3 text-sm"><b>{verificationStatus === "approved" ? "راننده تأیید شده است" : verificationStatus === "rejected" ? "مدارک راننده رد شده است" : "مدارک در انتظار بررسی مدیر است"}</b>{verificationNote && <p className="mt-1">{verificationNote}</p>}<p className="mt-1">تا تأیید مدیر، دسترسی به درخواست‌های سفر بسته است.</p></div>}
      {!isDriver && <Btn variant="accent" disabled={busy||!car.trim()||!plate.trim()||(docs.data?.size??0)<DOC_KINDS.length} onClick={()=>void save(true)}>ثبت‌نام راننده</Btn>}
      {isDriver && <p className="text-primary">حساب راننده فعال است · مشخصات خوداظهاری</p>}
    </>}
  </Card>;
}
