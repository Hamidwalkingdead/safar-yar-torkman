import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Moon, Mountain, Lock } from "lucide-react";
import { Badge, Btn, Card, FareTable } from "@/components/ui-kit";
import { commission, fa, toman } from "@/lib/fare";
import { useStore, ME_DRIVER, statusLabel } from "@/lib/store";

export const Route = createFileRoute("/driver")({
  head: () => ({
    meta: [
      { title: "پنل راننده | راه‌یار" },
      { name: "description", content: "درخواست‌های ورودی سفر، کرایه پیشنهادی مسافر و سهم خالص راننده." },
      { property: "og:title", content: "پنل راننده | راه‌یار" },
      { property: "og:description", content: "درخواست‌های سفر را ببینید و بپذیرید." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Driver,
});

function Driver() {
  const { trips, accept } = useStore();
  const nav = useNavigate();
  const [online, setOnline] = useState(true);
  const [open, setOpen] = useState<string | null>(null);
  const pending = trips.filter((t) => t.status === "pending");
  const mine = trips.filter((t) => t.driver && t.status !== "pending");

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between pt-2">
        <div><h1 className="text-2xl font-black">{ME_DRIVER.name}</h1><p className="text-sm text-muted-foreground">{ME_DRIVER.car} · {ME_DRIVER.plate}</p></div>
        <button onClick={() => setOnline(!online)} className={`rounded-full px-4 py-2 text-sm font-bold ${online ? "bg-primary text-primary-foreground" : "bg-muted"}`}>{online ? "آنلاین" : "آفلاین"}</button>
      </div>
      <h2 className="font-bold">درخواست‌های ورودی ({fa(pending.length)})</h2>
      {!online && <Card className="text-center text-muted-foreground">برای دریافت درخواست آنلاین شوید.</Card>}
      {online && pending.length === 0 && <Card className="text-center text-muted-foreground">درخواستی نیست.</Card>}
      {online && pending.map((t) => {
        const fare = t.suggested ?? t.calculated;
        return (
          <Card key={t.id} className="space-y-3">
            <div className="flex items-center justify-between"><b className="text-lg">{t.passengerName}</b><Badge>{t.id}</Badge></div>
            <div className="text-sm">{t.from} ← {t.to} · {fa(t.km)} کیلومتر</div>
            <div className="flex flex-wrap gap-2">
              {t.night && <Badge tone="primary"><Moon className="inline size-3" /> شبانه</Badge>}
              {t.mountain && <Badge tone="primary"><Mountain className="inline size-3" /> کوهستانی</Badge>}
              {t.suggested && <Badge tone="accent">پیشنهاد مسافر</Badge>}
            </div>
            <div className="flex items-end justify-between rounded-2xl bg-muted p-3">
              <div><div className="text-xs text-muted-foreground">کرایه</div><div className="text-xl font-black">{toman(fare)}</div></div>
              <div className="text-left text-xs text-muted-foreground">سهم شما<br /><b className="text-sm text-foreground">{toman(commission(fare).driverNet)}</b></div>
            </div>
            <div className="flex items-center gap-1 text-xs text-muted-foreground"><Lock className="size-3" /> شماره مسافر پس از پذیرش نمایش داده می‌شود</div>
            {open === t.id && <FareTable km={t.km} night={t.night} mountain={t.mountain} agreed={t.suggested} />}
            <div className="flex gap-2">
              <Btn className="flex-1" onClick={() => { accept(t.id); nav({ to: "/trip/$id", params: { id: t.id }, search: { as: "driver" } }); }}>پذیرش سفر</Btn>
              <Btn variant="ghost" onClick={() => setOpen(open === t.id ? null : t.id)}>جزئیات</Btn>
            </div>
          </Card>
        );
      })}
      {mine.length > 0 && <h2 className="pt-2 font-bold">سفرهای من</h2>}
      {mine.map((t) => (
        <Link key={t.id} to="/trip/$id" params={{ id: t.id }} search={{ as: "driver" }}><Card className="mb-3 flex justify-between"><span>{t.passengerName} · {t.to}</span><Badge tone="primary">{statusLabel[t.status]}</Badge></Card></Link>
      ))}
    </div>
  );
}
