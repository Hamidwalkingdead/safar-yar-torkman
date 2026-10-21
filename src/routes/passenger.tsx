import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { MapPin, Flag, Moon, Mountain, Users, type LucideIcon } from "lucide-react";
import { SharedRequest } from "@/components/shared-request";
import { sharedEligible, type RideType } from "@/lib/shared-rides";
import { Btn, Card, DemoNote, FareTable } from "@/components/ui-kit";
import { calculateFare, FARE, toman, fa } from "@/lib/fare";
import { useStore, ME_PASSENGER } from "@/lib/store";

export const Route = createFileRoute("/passenger")({
  head: () => ({
    meta: [
      { title: "درخواست سفر | راه‌یار" },
      { name: "description", content: "مبدأ و مقصد را وارد کنید، کرایه را ببینید و کرایه پیشنهادی خود را ثبت کنید." },
      { property: "og:title", content: "درخواست سفر | راه‌یار" },
      { property: "og:description", content: "درخواست سفر با محاسبه شفاف کرایه و پیشنهاد قیمت." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Passenger,
});

function Passenger() {
  const { addTrip } = useStore();
  const nav = useNavigate();
  const [from, setFrom] = useState("ونک");
  const [to, setTo] = useState("میدان انقلاب");
  const [km, setKm] = useState(12);
  const [night, setNight] = useState(false);
  const [mountain, setMountain] = useState(false);
  const [suggest, setSuggest] = useState("");
  const [rideType, setRideType] = useState<RideType>("urban");
  const [shared, setShared] = useState(false);
  const calc = calculateFare({ km, night, mountain }).total;
  const s = suggest ? Number(suggest.replace(/[^\d]/g, "")) : undefined;
  const tooLow = s !== undefined && s < FARE.minimum;

  const submit = () => {
    const id = addTrip({ from, to, km, night, mountain, calculated: calc, suggested: s && s !== calc ? s : undefined });
    nav({ to: "/trip/$id", params: { id }, search: { as: "passenger" } });
  };

  return (
    <div className="space-y-4 p-4">
      <h1 className="pt-2 text-2xl font-black">سلام {ME_PASSENGER.name} 👋</h1>
      <div className="map-grid relative h-40 overflow-hidden rounded-3xl">
        <div className="absolute right-10 top-8 size-4 rounded-full bg-primary ring-8 ring-primary/20" />
        <div className="absolute bottom-8 left-12 size-4 rounded-full bg-accent ring-8 ring-accent/30" />
        <svg className="absolute inset-0 size-full"><path d="M 85% 25% Q 50% 90% 18% 78%" stroke="var(--primary)" strokeWidth="3" strokeDasharray="6 6" fill="none" /></svg>
        <span className="absolute bottom-2 right-3 rounded-full bg-card px-2 py-0.5 text-[10px]">نقشه نمایشی — اتصال نقشه/GPS نیاز به راه‌اندازی دارد</span>
      </div>
      <Link to="/shared" search={{ origin: "", destination: "", departure: "", ride: "" }} className="flex items-center gap-2 text-sm font-bold text-primary"><Users className="size-5" />فهرست سفرهای اشتراکی بین‌شهری ←</Link>
      <Card className="space-y-3">
        <label className="block space-y-1 text-sm">نوع مسیر<select aria-label="نوع مسیر" value={rideType} onChange={(e) => { const type = e.target.value as RideType; setRideType(type); if (!sharedEligible(type)) setShared(false); }} className="w-full rounded-2xl bg-muted px-3 py-3"><option value="urban">درون‌شهری</option><option value="intercity">برون‌شهری / بین‌شهری</option></select></label>
        <label className="flex items-center gap-2 rounded-2xl bg-muted px-3"><MapPin className="size-4 text-primary" /><input aria-label="مبدأ سفر" className="w-full bg-transparent py-3 outline-none" value={from} onChange={(e) => setFrom(e.target.value)} placeholder="مبدأ" /></label>
        <label className="flex items-center gap-2 rounded-2xl bg-muted px-3"><Flag className="size-4 text-accent-foreground" /><input aria-label="مقصد سفر" className="w-full bg-transparent py-3 outline-none" value={to} onChange={(e) => setTo(e.target.value)} placeholder="مقصد" /></label>
        <div>
          <div className="flex justify-between text-sm"><span>مسافت تخمینی</span><b>{fa(km)} کیلومتر</b></div>
          <input type="range" min={1} max={600} value={km} onChange={(e) => setKm(+e.target.value)} className="w-full accent-[var(--primary)]" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Toggle on={night} set={setNight} I={Moon} l="سفر شبانه" />
          <Toggle on={mountain} set={setMountain} I={Mountain} l="جاده کوهستانی" />
        </div>
        <div className="border-t border-border pt-3"><label className={`flex items-center gap-2 font-bold ${!sharedEligible(rideType) ? "text-muted-foreground" : "text-primary"}`}><input type="checkbox" checked={shared} disabled={!sharedEligible(rideType)} onChange={(e) => setShared(e.target.checked)} className="size-5 accent-primary" /><Users className="size-5" />سفر اشتراکی</label>{!sharedEligible(rideType) && <p className="mt-2 text-xs text-muted-foreground">سفر اشتراکی فقط برای مسیرهای برون‌شهری / بین‌شهری فعال است؛ برای سفر درون‌شهری در دسترس نیست.</p>}</div>
        {shared && <SharedRequest key={`${from}|${to}|${calc}`} origin={from} destination={to} fare={calc} />}
      </Card>
      <Card><h2 className="mb-2 font-bold">جزئیات کرایه</h2><FareTable km={km} night={night} mountain={mountain} /></Card>
      {!shared && <><Card className="space-y-2">
        <h2 className="font-bold">کرایه پیشنهادی شما (اختیاری)</h2>
        <p className="text-sm text-muted-foreground">کرایه محاسبه‌شده {toman(calc)} است. می‌توانید مبلغ دیگری پیشنهاد دهید؛ راننده تصمیم می‌گیرد.</p>
        <input inputMode="numeric" value={suggest} onChange={(e) => setSuggest(e.target.value)} placeholder="مثلاً ۱۵۰۰۰۰" className="w-full rounded-2xl bg-muted px-4 py-3 outline-none" />
        {s !== undefined && !tooLow && <p className="text-sm text-primary">پیشنهاد شما: {toman(s)}</p>}
        {tooLow && <p className="text-sm text-destructive">پیشنهاد نمی‌تواند کمتر از حداقل کرایه ({toman(FARE.minimum)}) باشد.</p>}
      </Card>
      <DemoNote>شماره تماس شما فقط پس از پذیرش سفر به راننده نمایش داده می‌شود. نام شما از ابتدا دیده می‌شود.</DemoNote>
      <Btn className="w-full py-4 text-lg" disabled={tooLow || !from || !to} onClick={submit}>ثبت درخواست سفر</Btn>
      </>}
    </div>
  );
}

function Toggle({ on, set, I, l }: { on: boolean; set: (v: boolean) => void; I: LucideIcon; l: string }) {
  return (
    <Btn variant="ghost" aria-pressed={on} onClick={() => set(!on)} className={`flex items-center justify-center gap-2 rounded-2xl border-2 py-3 text-sm font-bold transition ${on ? "border-primary bg-primary text-primary-foreground" : "border-border"}`}>
      <I className="size-4" />{l}
    </Btn>
  );
}
