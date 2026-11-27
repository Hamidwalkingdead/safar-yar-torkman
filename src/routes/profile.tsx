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
import { APP_TARGET } from "@/lib/app-target";
export const Route = createFileRoute("/profile")({
  head: () => ({ meta: [
    { title: "پروفایل و تنظیمات | سفر یار ترکمن" },
    { name: "description", content: "اطلاعات حساب و تنظیمات." },
    { name: "robots", content: "noindex" },
  ] }),
  component: Profile,
});
function Profile() {
  const { userId, isAnonymous } = useSharedAuth();
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
    {(!userId || isAnonymous) ? <SharedSignIn /> : account.data ? <>
      {APP_TARGET === "driver" && account.data.isDriver && <DriverCommissionPanel userId={userId} />}
      {billingFeatures.wallet && <WalletPanel userId={userId} />}
      <ProfileForm key={account.data.profile.id + JSON.stringify(account.data)} profile={account.data.profile} isDriver={APP_TARGET === "driver" && account.data.isDriver} allowDriverRegistration={APP_TARGET === "driver"} isAnonymous={isAnonymous} verificationStatus={verification.data?.status ?? null} verificationNote={verification.data?.note ?? null} />
      {!isAnonymous ? <Btn variant="ghost" onClick={async () => {
        await cache.cancelQueries(); cache.clear();
        const { error } = await supabase.auth.signOut();
        if (error) toast.error("خروج انجام نشد");
      }}>خروج از حساب</Btn> : <p className="rounded-xl bg-muted p-3 text-xs text-muted-foreground">این حساب بدون پیامک و مخصوص همین دستگاه است؛ برای از دست ندادن اطلاعات، از حساب خارج نشوید و داده‌های برنامه را پاک نکنید.</p>}
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
function ProfileForm({profile,isDriver,allowDriverRegistration,isAnonymous,verificationStatus,verificationNote}:{profile:Database["public"]["Tables"]["profiles"]["Row"];isDriver:boolean;allowDriverRegistration:boolean;isAnonymous:boolean;verificationStatus:string|null;verificationNote:string|null}) {
  const [firstName,setFirstName]=useState(profile.first_name);
  const [lastName,setLastName]=useState(profile.last_name);
  const [emergencyPhone,setEmergencyPhone]=useState(profile.emergency_phone);
  const [nationalId,setNationalId]=useState("");
  const [brand,setBrand]=useState(profile.car_brand);
  const [color,setColor]=useState(profile.car_color);
  const [model,setModel]=useState(profile.car_model);
  const [year,setYear]=useState(profile.car_year?.toString()??"");
  const [plate,setPlate]=useState(profile.plate);
  const [busy,setBusy]=useState(false);
  const [editing,setEditing]=useState(!(profile.first_name?.trim() && profile.last_name?.trim() && profile.emergency_phone?.trim()));
  const cache=useQueryClient();
  const docs=useDriverDocs(profile.id);
  const identity=useQuery({
    queryKey:["driver-private-identity",profile.id],
    enabled:allowDriverRegistration,
    queryFn:async()=>{const {data,error}=await supabase.rpc("has_my_driver_identity");if(error)throw error;return data===true;},
  });
  const identityDone=!!profile.first_name?.trim()&&!!profile.last_name?.trim()&&!!profile.emergency_phone?.trim()&&identity.data===true;
  const vehicleDone=!!profile.car_brand?.trim()&&!!profile.car_color?.trim()&&!!profile.car_model?.trim()&&!!profile.car_year&&!!profile.plate?.trim();
  const step=identityDone?(vehicleDone?3:2):1;
  async function saveIdentity(){
    setBusy(true);
    try{
      const emergency=normalizeIranianMobile(emergencyPhone);
      const id= nationalId.replace(/[۰-۹]/g,c=>String("۰۱۲۳۴۵۶۷۸۹".indexOf(c))).replace(/[٠-٩]/g,c=>String("٠١٢٣٤٥٦٧٨٩".indexOf(c))).replace(/\D/g,"");
      if(firstName.trim().length<2||lastName.trim().length<2)throw new Error("نام و نام خانوادگی را کامل کنید");
      if(!isIranianMobile(emergency))throw new Error("شماره تماس اضطراری معتبر نیست");
      if(id.length!==10)throw new Error("کد ملی باید ۱۰ رقم باشد");
      const {error}=await supabase.from("profiles").update({
        first_name:firstName.trim(),last_name:lastName.trim(),
        display_name:(firstName.trim()+" "+lastName.trim()).slice(0,160),
        emergency_phone:emergency
      }).eq("id",profile.id);
      if(error)throw error;
      const saved=await supabase.rpc("save_my_driver_identity",{p_national_id:id});
      if(saved.error)throw saved.error;
      setNationalId("");
      await cache.invalidateQueries({queryKey:["account"]});
      await cache.invalidateQueries({queryKey:["driver-private-identity",profile.id]});
      toast.success("اطلاعات هویتی ثبت شد؛ حالا مشخصات خودرو را وارد کنید.");
    }catch(e){toast.error(e instanceof Error?e.message:"ثبت اطلاعات هویتی انجام نشد");}
    finally{setBusy(false);}
  }
  async function saveVehicle(){
    setBusy(true);
    try{
      const normalizedYear=year.replace(/[۰-۹]/g,c=>String("۰۱۲۳۴۵۶۷۸۹".indexOf(c))).replace(/[٠-٩]/g,c=>String("٠١٢٣٤٥٦٧٨٩".indexOf(c)));
      const productionYear=Number(normalizedYear.replace(/[^0-9]/g,""));
      if(!brand.trim()||!color.trim()||!model.trim()||!plate.trim())throw new Error("برند، رنگ، مدل و پلاک خودرو را کامل کنید");
      if(!Number.isInteger(productionYear)||productionYear<1300||productionYear>1500)throw new Error("سال تولید را به‌صورت سال شمسی معتبر وارد کنید");
      const car=[brand.trim(),model.trim(),productionYear.toString(),color.trim()].join(" · ");
      const {error}=await supabase.from("profiles").update({
        car,car_brand:brand.trim(),car_color:color.trim(),car_model:model.trim(),car_year:productionYear,plate:plate.trim()
      }).eq("id",profile.id);
      if(error)throw error;
      await cache.invalidateQueries({queryKey:["account"]});
      toast.success("مشخصات خودرو ثبت شد؛ مرحله بارگذاری مدارک باز شد.");
    }catch(e){toast.error(e instanceof Error?e.message:"ثبت مشخصات خودرو انجام نشد");}
    finally{setBusy(false);}
  }
  async function submitDriver(){
    setBusy(true);
    try{
      if((docs.data?.size??0)!==DOC_KINDS.length)throw new Error("هر شش مدرک باید بارگذاری شود");
      const result=await supabase.rpc("register_driver");
      if(result.error)throw result.error;
      await Promise.all([
        cache.invalidateQueries({queryKey:["account"]}),
        cache.invalidateQueries({queryKey:["driver-verification"]}),
        cache.invalidateQueries({queryKey:["driver-verification-profile"]})
      ]);
      toast.success("پرونده راننده برای بررسی مدیر ارسال شد.");
    }catch(e){toast.error(e instanceof Error?e.message:"ارسال پرونده انجام نشد");}
    finally{setBusy(false);}
  }
  async function savePassengerProfile(){
    setBusy(true);
    try{
      const emergency=normalizeIranianMobile(emergencyPhone);
      if(firstName.trim().length<2||lastName.trim().length<2||!isIranianMobile(emergency))throw new Error("نام، نام خانوادگی و شماره اضطراری معتبر را وارد کنید");
      const {error}=await supabase.from("profiles").update({
        first_name:firstName.trim(),last_name:lastName.trim(),
        display_name:(firstName.trim()+" "+lastName.trim()).slice(0,160),emergency_phone:emergency
      }).eq("id",profile.id);
      if(error)throw error;
      await cache.invalidateQueries({queryKey:["account"]});
      setEditing(false);toast.success("پروفایل ذخیره شد");
    }catch(e){toast.error(e instanceof Error?e.message:"ذخیره پروفایل انجام نشد");}
    finally{setBusy(false);}
  }
  if(!allowDriverRegistration)return <Card className="space-y-4">
    <h2 className="font-bold">اطلاعات حساب</h2>
    {!editing?<><p>{firstName} {lastName}</p><p>شماره اصلی: {profile.phone}</p><p>شماره اضطراری: {emergencyPhone}</p><Btn variant="ghost" onClick={()=>setEditing(true)}>ویرایش اطلاعات</Btn></>:<>
      <label className="block">نام<input value={firstName} onChange={e=>setFirstName(e.target.value)} className="mt-1 w-full rounded-2xl bg-muted p-3"/></label>
      <label className="block">نام خانوادگی<input value={lastName} onChange={e=>setLastName(e.target.value)} className="mt-1 w-full rounded-2xl bg-muted p-3"/></label>
      <label className="block">شماره اصلی تأییدشده<input value={profile.phone} readOnly dir="ltr" className="mt-1 w-full rounded-2xl bg-muted p-3 opacity-75"/></label>
      <label className="block">شماره اضطراری<input inputMode="tel" value={emergencyPhone} onChange={e=>setEmergencyPhone(e.target.value)} className="mt-1 w-full rounded-2xl bg-muted p-3"/></label>
      <Btn disabled={busy} onClick={()=>void savePassengerProfile()}>ذخیره</Btn>
    </>}
  </Card>;
  return <Card className="space-y-4">
    <div className="flex items-center justify-between"><h2 className="font-bold">مراحل ثبت‌نام راننده</h2><span className="text-xs text-muted-foreground">مرحله {step} از ۳</span></div>
    <div className="grid grid-cols-3 gap-1 text-center text-xs">
      <div className={step>=1?"rounded-lg bg-primary/15 p-2 text-primary":"rounded-lg bg-muted p-2"}>۱. هویت</div>
      <div className={step>=2?"rounded-lg bg-primary/15 p-2 text-primary":"rounded-lg bg-muted p-2"}>۲. خودرو</div>
      <div className={step>=3?"rounded-lg bg-primary/15 p-2 text-primary":"rounded-lg bg-muted p-2"}>۳. مدارک</div>
    </div>
    <div className="rounded-xl bg-muted p-3 text-sm space-y-1">
      <p><b>شماره اصلی حساب:</b> <span dir="ltr">{profile.phone}</span></p>
      <p className="text-xs text-muted-foreground">این شماره همان شماره‌ای است که کد ورود به آن ارسال شده؛ شماره جداگانه‌ای لازم نیست.</p>
    </div>
    {step===1&&<>
      <h3 className="font-semibold">اطلاعات هویتی</h3>
      <label className="block">نام<input autoComplete="given-name" value={firstName} onChange={e=>setFirstName(e.target.value)} className="mt-1 w-full rounded-2xl bg-muted p-3"/></label>
      <label className="block">نام خانوادگی<input autoComplete="family-name" value={lastName} onChange={e=>setLastName(e.target.value)} className="mt-1 w-full rounded-2xl bg-muted p-3"/></label>
      <label className="block">کد ملی<input inputMode="numeric" maxLength={10} value={nationalId} onChange={e=>setNationalId(e.target.value)} placeholder="۱۰ رقم" className="mt-1 w-full rounded-2xl bg-muted p-3"/></label>
      <label className="block">شماره تماس اضطراری<input inputMode="tel" value={emergencyPhone} onChange={e=>setEmergencyPhone(e.target.value)} placeholder="09xxxxxxxxx" className="mt-1 w-full rounded-2xl bg-muted p-3"/></label>
      <p className="text-xs text-muted-foreground">کد ملی به‌صورت رمزنگاری‌شده نگهداری می‌شود و فقط مدیر مجاز امکان مشاهده آن را دارد.</p>
      <Btn disabled={busy||!nationalId.trim()||!firstName.trim()||!lastName.trim()||!emergencyPhone.trim()} onClick={()=>void saveIdentity()}>{busy?"در حال ثبت…":"تأیید و ادامه"}</Btn>
    </>}
    {step===2&&<>
      <h3 className="font-semibold">مشخصات خودرو</h3>
      <label className="block">برند خودرو<input value={brand} onChange={e=>setBrand(e.target.value)} placeholder="مثلاً ایران‌خودرو" className="mt-1 w-full rounded-2xl bg-muted p-3"/></label>
      <label className="block">رنگ خودرو<input value={color} onChange={e=>setColor(e.target.value)} placeholder="مثلاً سفید" className="mt-1 w-full rounded-2xl bg-muted p-3"/></label>
      <label className="block">مدل خودرو<input value={model} onChange={e=>setModel(e.target.value)} placeholder="مثلاً پژو پارس" className="mt-1 w-full rounded-2xl bg-muted p-3"/></label>
      <label className="block">سال تولید (شمسی)<input inputMode="numeric" maxLength={4} value={year} onChange={e=>setYear(e.target.value)} placeholder="۱۴۰۲" className="mt-1 w-full rounded-2xl bg-muted p-3"/></label>
      <label className="block">شماره پلاک<input value={plate} onChange={e=>setPlate(e.target.value)} placeholder="شماره پلاک" className="mt-1 w-full rounded-2xl bg-muted p-3"/></label>
      <Btn disabled={busy||!brand.trim()||!color.trim()||!model.trim()||!year.trim()||!plate.trim()} onClick={()=>void saveVehicle()}>{busy?"در حال ثبت…":"تأیید خودرو و ادامه"}</Btn>
    </>}
    {step===3&&<>
      <h3 className="font-semibold">مدارک خودرو و راننده</h3>
      {verificationStatus!=="approved"&&<DriverDocuments userId={profile.id}/>}
      {isDriver?<div className="rounded-xl bg-muted p-3 text-sm"><b>{verificationStatus==="approved"?"راننده تأیید شده است":verificationStatus==="rejected"?"مدارک راننده رد شده است":"پرونده در انتظار بررسی مدیر است"}</b>{verificationNote&&<p className="mt-1">{verificationNote}</p>}<p className="mt-1">تا تأیید مدیر، امکان پذیرش سفر فعال نمی‌شود.</p></div>:<>
        <p className="text-xs text-muted-foreground">پس از بارگذاری هر شش مدرک، پرونده برای بررسی مدیر ارسال می‌شود.</p>
        <Btn variant="accent" disabled={busy||(docs.data?.size??0)!==DOC_KINDS.length} onClick={()=>void submitDriver()}>{busy?"در حال ارسال…":"ارسال پرونده برای تأیید مدیر"}</Btn>
      </>}
    </>}
  </Card>;
}

type DriverCommissionStatus = {
  limit: number;
  outstanding: number;
  reserved: number;
  pendingSettlement: number;
  available: number;
  settlementCardNumber: string;
  settlementCardHolder: string;
};
function DriverCommissionPanel({userId}:{userId:string}) {
  const cache=useQueryClient();
  const [amount,setAmount]=useState("");
  const [reference,setReference]=useState("");
  const [receipt,setReceipt]=useState<File|null>(null);
  const [busy,setBusy]=useState(false);
  const [showSettlement,setShowSettlement]=useState(false);
  const status=useQuery({
    queryKey:["driver-commission-status",userId],
    queryFn:async()=>{
      const {data,error}=await supabase.rpc("get_driver_commission_status");
      if(error)throw error;
      return data as unknown as DriverCommissionStatus;
    },
    refetchInterval:15000,
  });
  const transactions=useQuery({
    queryKey:["driver-commission-transactions",userId],
    queryFn:async()=>{
      const {data,error}=await supabase.from("driver_commission_transactions")
        .select("id,amount,kind,description,created_at").eq("driver_id",userId)
        .order("created_at",{ascending:false}).limit(20);
      if(error)throw error;
      return data??[];
    },
  });
  const settlements=useQuery({
    queryKey:["driver-commission-settlements",userId],
    queryFn:async()=>{
      const {data,error}=await supabase.from("driver_commission_settlements")
        .select("id,amount,status,transfer_reference,receipt_path,created_at,review_note")
        .eq("driver_id",userId).order("created_at",{ascending:false}).limit(10);
      if(error)throw error;
      const rows=data??[];
      return await Promise.all(rows.map(async row=>{
        const {data:link}=await supabase.storage.from("commission-settlement-receipts").createSignedUrl(row.receipt_path,3600);
        return {...row,receiptUrl:link?.signedUrl??null};
      }));
    },
  });
  async function submitSettlement(){
    const n=Number(amount.replace(/[^0-9]/g,""));
    if(!Number.isSafeInteger(n)||n<=0){toast.error("مبلغ تسویه را درست وارد کنید.");return;}
    if(!reference.trim()||reference.trim().length<4){toast.error("شناسه پیگیری کارت‌به‌کارت را وارد کنید.");return;}
    if(!receipt||!receipt.type.startsWith("image/")||receipt.size>8*1024*1024){toast.error("تصویر رسید معتبر با حجم حداکثر ۸ مگابایت انتخاب کنید.");return;}
    setBusy(true);
    let path="";
    try{
      const ext=(receipt.name.split(".").pop()??"jpg").toLowerCase().replace(/[^a-z0-9]/g,"")||"jpg";
      path=userId+"/"+crypto.randomUUID()+"."+ext;
      const upload=await supabase.storage.from("commission-settlement-receipts").upload(path,receipt,{contentType:receipt.type,upsert:false});
      if(upload.error)throw upload.error;
      const {error}=await supabase.rpc("request_driver_commission_settlement",{
        p_amount:n,p_receipt_path:path,p_transfer_reference:reference.trim(),
      });
      if(error)throw error;
      toast.success("رسید ثبت شد؛ پس از بررسی مدیر، بدهی کمیسیون تسویه می‌شود.");
      setAmount("");setReference("");setReceipt(null);
      await Promise.all([
        cache.invalidateQueries({queryKey:["driver-commission-status",userId]}),
        cache.invalidateQueries({queryKey:["driver-commission-settlements",userId]}),
      ]);
    }catch(error){
      if(path)await supabase.storage.from("commission-settlement-receipts").remove([path]);
      toast.error(error instanceof Error?error.message:"ثبت رسید تسویه انجام نشد.");
    }finally{setBusy(false);}
  }
  const info=status.data;
  return <Card className="space-y-3">
    <h2 className="text-lg font-bold">کمیسیون سفرهای نقدی و تسویه</h2>
    {status.isLoading?<p className="text-sm text-muted-foreground">در حال دریافت وضعیت کمیسیون…</p>:status.error?<p role="alert" className="text-sm text-destructive">وضعیت کمیسیون دریافت نشد؛ دوباره تلاش کنید.</p>:<>
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-xl bg-muted p-3"><p className="text-xs text-muted-foreground">بدهی فعلی کمیسیون</p><b className="text-lg">{toman(info?.outstanding??0)}</b></div>
        <div className="rounded-xl bg-muted p-3"><p className="text-xs text-muted-foreground">سقف تعیین‌شده مدیر</p><b className="text-lg">{toman(info?.limit??0)}</b></div>
      </div>
       
      {(info?.reserved??0)>0&&<p className="text-xs text-muted-foreground">کمیسیون سفرهای در حال انجام/پذیرفته‌شده: {toman(info?.reserved??0)}</p>}
      {(info?.pendingSettlement??0)>0&&<p className="text-xs text-muted-foreground">درخواست تسویه در انتظار بررسی: {toman(info?.pendingSettlement??0)}</p>}
      <Btn variant="ghost" onClick={()=>setShowSettlement(value=>!value)}>{showSettlement?"بستن اطلاعات تسویه":"مشاهده کارت مقصد و ثبت تسویه"}</Btn>
      {showSettlement&&<>
      <div className="rounded-xl border p-3 space-y-1 text-sm">
        <b>کارت مقصد آژانس برای کارت‌به‌کارت</b>
        {info?.settlementCardNumber?<><p dir="ltr" className="text-lg font-bold tracking-wider">{info.settlementCardNumber.replace(/(\d{4})(?=\d)/g,"$1 - ")}</p><p>به نام: {info.settlementCardHolder||"—"}</p></>:<p className="text-destructive">اطلاعات کارت مقصد هنوز توسط مدیر ثبت نشده است.</p>}
      </div>
      {(info?.outstanding??0)>0&&!!info?.settlementCardNumber&&<div className="space-y-2 border-t pt-3">
        <b>ثبت رسید تسویه</b>
        <input inputMode="numeric" value={amount} onChange={e=>setAmount(e.target.value)} placeholder="مبلغ واریزشده به تومان" className="w-full rounded-xl bg-muted p-3"/>
        <input value={reference} onChange={e=>setReference(e.target.value)} placeholder="شماره پیگیری یا شناسه واریز" className="w-full rounded-xl bg-muted p-3"/>
        <label className="block rounded-xl border border-dashed p-3 text-sm">
          تصویر رسید کارت‌به‌کارت (حداکثر ۸ مگابایت)
          <input type="file" accept="image/*" className="mt-2 block w-full" onChange={e=>setReceipt(e.target.files?.[0]??null)}/>
        </label>
        <Btn disabled={busy||!receipt||!amount||!reference.trim()} onClick={()=>void submitSettlement()}>{busy?"در حال ثبت رسید…":"ارسال رسید برای بررسی مدیر"}</Btn>
        <p className="text-xs text-muted-foreground">بدهی فقط پس از تأیید رسید توسط مدیر کم می‌شود؛ ارسال تصویر به‌تنهایی تسویه محسوب نمی‌شود.</p>
      </div>}
      </>}
    </>}
    <div className="border-t pt-3 space-y-2">
      <b>وضعیت درخواست‌های تسویه</b>
      {(settlements.data??[]).map(item=><div key={item.id} className="rounded-lg bg-muted p-2 text-sm">
        <div className="flex justify-between gap-2"><b>{toman(item.amount)}</b><span>{item.status==="pending"?"در انتظار بررسی":item.status==="approved"?"تأیید و تسویه شد":"رد شد"}</span></div>
        <p className="text-xs text-muted-foreground">پیگیری: {item.transfer_reference}</p>
        {item.review_note&&<p className="text-xs">{item.review_note}</p>}
      </div>)}
      {!settlements.data?.length&&<p className="text-xs text-muted-foreground">درخواستی ثبت نشده است.</p>}
      {(settlements.data??[]).map(item=>item.receiptUrl&&<a key={item.id+"-receipt"} href={item.receiptUrl} target="_blank" rel="noreferrer" className="text-xs text-primary underline">مشاهده تصویر رسید · {new Date(item.created_at).toLocaleDateString("fa-IR")}</a>)}
    </div>
    <div className="border-t pt-3 space-y-2">
      <b>گردش کمیسیون</b>
      {(transactions.data??[]).slice(0,10).map(item=><div key={item.id} className="flex justify-between gap-2 border-b py-2 text-sm">
        <span>{item.description}</span><b className={item.amount>0?"text-destructive":"text-primary"}>{item.amount>0?"+":""}{toman(item.amount)}</b>
      </div>)}
      {!transactions.data?.length&&<p className="text-xs text-muted-foreground">هنوز کمیسیونی ثبت نشده است.</p>}
    </div>
  </Card>;
}
