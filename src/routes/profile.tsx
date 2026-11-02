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
  return <div className="space-y-4 p-4">
    <h1 className="text-2xl font-black">پروفایل امن</h1>
    {!userId ? <SharedSignIn /> : account.data ? <>
      <WalletPanel userId={userId} />
      <ProfileForm key={account.data.profile.id + JSON.stringify(account.data)} profile={account.data.profile} isDriver={account.data.isDriver} />
      <Btn variant="ghost" onClick={async () => {
        await cache.cancelQueries(); cache.clear();
        const { error } = await supabase.auth.signOut();
        if (error) toast.error("خروج انجام نشد");
      }}>خروج از حساب</Btn>
    </> : <p>{account.error ? "دریافت پروفایل ممکن نشد" : "در حال دریافت…"}</p>}
    <DemoNote>موجودی کیف پول و درآمد سفرها ثبت می‌شود. شارژ آنلاین تا اتصال درگاه پرداخت فعال نیست؛ برداشت پس از بررسی مدیر انجام می‌شود.</DemoNote>
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
  const labels:Record<string,string>={trip_earning:"درآمد سفر",topup:"شارژ",withdrawal:"برداشت",refund:"بازپرداخت",adjustment:"اصلاح موجودی"};
  return <Card className="space-y-3">
    <div className="flex items-center justify-between"><h2 className="font-bold text-lg">کیف پول حساب</h2><span className="text-xs text-muted-foreground">متصل به همین شماره حساب</span></div>
    {wallet.isLoading?<p>در حال دریافت موجودی…</p>:wallet.error?<p role="alert">دریافت کیف پول ناموفق بود.</p>:<div className="rounded-2xl bg-muted p-4">
      <p className="text-sm text-muted-foreground">موجودی قابل برداشت</p>
      <p className="text-2xl font-black">{toman(wallet.data?.balance??0)}</p>
    </div>}
    <div className="space-y-2">
      <b>درخواست برداشت</b>
      <input aria-label="مبلغ برداشت به تومان" inputMode="numeric" placeholder="مبلغ به تومان (حداقل ۵۰٬۰۰۰)" value={amount} onChange={e=>setAmount(e.target.value)} className="w-full rounded-xl bg-muted p-3"/>
      <input aria-label="شماره کارت مقصد" inputMode="numeric" maxLength={19} placeholder="شماره کارت ۱۶ رقمی به نام خودتان" value={card} onChange={e=>setCard(e.target.value)} className="w-full rounded-xl bg-muted p-3"/>
      <Btn disabled={busy} onClick={()=>void withdraw()}>{busy?"در حال ثبت…":"ثبت درخواست برداشت"}</Btn>
      <p className="text-xs text-muted-foreground">موجودی فقط پس از تأیید پرداخت به حساب بانکی کسر می‌شود؛ ثبت درخواست به معنی واریز وجه نیست.</p>
    </div>
    <div className="space-y-2"><b>گردش کیف پول</b>
      {!wallet.data?.transactions.length?<p className="text-sm text-muted-foreground">تراکنشی ثبت نشده است.</p>:wallet.data.transactions.map(t=><div key={t.id} className="flex justify-between gap-2 border-b py-2 text-sm">
        <div><p>{labels[t.kind]??t.kind}</p><p className="text-xs text-muted-foreground">{t.description}</p></div>
        <b className={t.amount<0?"text-destructive":"text-primary"}>{t.amount>0?"+":""}{toman(t.amount)}</b>
      </div>)}
    </div>
    {!!wallet.data?.requests.length&&<div className="space-y-2"><b>درخواست‌های برداشت</b>{wallet.data.requests.map(r=><p key={r.id} className="text-sm">{toman(r.amount)} · {r.status==="pending"?"در انتظار بررسی":r.status==="paid"?"واریز شد":"رد شد"}</p>)}</div>}
  </Card>;
}
function ProfileForm({profile,isDriver}:{profile:Database["public"]["Tables"]["profiles"]["Row"];isDriver:boolean}) {
  const [name,setName]=useState(profile.display_name),[phone,setPhone]=useState(profile.phone),[car,setCar]=useState(profile.car),[plate,setPlate]=useState(profile.plate),[busy,setBusy]=useState(false);
  const cache=useQueryClient();const docs=useDriverDocs(profile.id);
  async function save(driver=false){
    setBusy(true);
    try{
      const normalized=phone.replace(/[۰-۹]/g,c=>String("۰۱۲۳۴۵۶۷۸۹".indexOf(c))).replace(/\s/g,"");
      if(name.trim().length<2||!/^09[0-9]{9}$/.test(normalized))throw new Error("نام و شماره همراه معتبر ایران را وارد کنید");
      const {error}=await supabase.from("profiles").update({display_name:name.trim(),phone:normalized,car:car.trim(),plate:plate.trim()}).eq("id",profile.id);
      if(error)throw error;
      if(driver){const result=await supabase.rpc("register_driver");if(result.error)throw result.error;}
      await cache.invalidateQueries({queryKey:["account"]});await cache.invalidateQueries({queryKey:["trips"]});
      toast.success(driver?"ثبت‌نام راننده انجام شد":"پروفایل ذخیره شد");
    }catch(e){toast.error(e instanceof Error?e.message:"ذخیره انجام نشد");}
    finally{setBusy(false);}
  }
  return <Card className="space-y-4">
    <label className="block">نام نمایشی<input aria-label="نام نمایشی" value={name} onChange={e=>setName(e.target.value)} className="mt-1 w-full rounded-2xl bg-muted p-3"/></label>
    <label className="block">شماره همراه<input aria-label="شماره همراه" inputMode="tel" value={phone} onChange={e=>setPhone(e.target.value)} className="mt-1 w-full rounded-2xl bg-muted p-3"/></label>
    <p className="text-xs text-muted-foreground">شماره فقط برای خودتان و طرف مجاز سفر پذیرفته‌شده قابل دریافت است.</p>
    <label className="block">مدل و رنگ خودرو<input aria-label="مدل و رنگ خودرو" value={car} onChange={e=>setCar(e.target.value)} className="mt-1 w-full rounded-2xl bg-muted p-3"/></label>
    <label className="block">پلاک خودرو<input aria-label="پلاک خودرو" value={plate} onChange={e=>setPlate(e.target.value)} className="mt-1 w-full rounded-2xl bg-muted p-3"/></label>
    {!isDriver&&<DriverDocuments userId={profile.id}/>}
    <Btn disabled={busy} onClick={()=>void save()}>ذخیره پروفایل</Btn>
    {!isDriver?<Btn variant="accent" disabled={busy||!car.trim()||!plate.trim()||(docs.data?.size??0)<DOC_KINDS.length} onClick={()=>void save(true)}>ثبت‌نام راننده</Btn>:<p className="text-primary">حساب راننده فعال است · مشخصات خوداظهاری</p>}
  </Card>;
}
