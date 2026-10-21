import { createFileRoute, Link } from "@tanstack/react-router";
import { Phone, MessageSquare, Lock, Car } from "lucide-react";
import { toast } from "sonner";
import { Badge, Btn, Card, DemoNote, FareTable } from "@/components/ui-kit";
import { fa } from "@/lib/fare";
import { useStore, ME_DRIVER, statusLabel } from "@/lib/store";

export const Route = createFileRoute("/trip/$id")({
  validateSearch: (s: Record<string, unknown>) => ({ as: s["as"] === "driver" ? ("driver" as const) : ("passenger" as const) }),
  head: () => ({
    meta: [
      { title: "جزئیات سفر | راه‌یار" },
      { name: "description", content: "وضعیت سفر، اطلاعات طرفین و جزئیات کرایه و کمیسیون." },
      { property: "og:title", content: "جزئیات سفر | راه‌یار" },
      { property: "og:description", content: "وضعیت و جزئیات سفر در راه‌یار." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Trip,
});

function Trip() {
  const { id } = Route.useParams();
  const { as } = Route.useSearch();
  const { trips, accept, setStatus } = useStore();
  const t = trips.find((x) => x.id === id);
  if (!t) return <div className="p-6">سفر پیدا نشد. <Link to="/" className="text-primary">خانه</Link></div>;
  const revealed = !!t.driver && t.status !== "pending" && t.status !== "cancelled";
  const steps = ["pending", "accepted", "ongoing", "done"] as const;
  const idx = steps.indexOf(t.status as any);
  const demoCall = () => toast("تماس در نسخه نمایشی برقرار نمی‌شود — اتصال سرویس تلفن نیاز به راه‌اندازی دارد.");

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between pt-2"><h1 className="text-2xl font-black">سفر {t.id}</h1><Badge tone="primary">{statusLabel[t.status]}</Badge></div>
      <div className="flex gap-1">{steps.map((s, i) => <div key={s} className={`h-1.5 flex-1 rounded-full ${i <= idx ? "bg-primary" : "bg-muted"}`} />)}</div>
      <Card className="space-y-1"><div className="text-sm text-muted-foreground">مسیر</div><div className="font-bold">{t.from} ← {t.to}</div><div className="text-sm">{fa(t.km)} کیلومتر</div></Card>

      <Card className="space-y-3">
        <Party title="مسافر" name={t.passengerName} phone={t.passengerPhone} revealed={revealed} onCall={demoCall} />
        <div className="border-t border-border" />
        {t.driver ? (
          <Party title="راننده" name={`${t.driver.name} · ${t.driver.car}`} sub={t.driver.plate} phone={t.driver.phone} revealed={revealed} onCall={demoCall} />
        ) : (
          <div className="flex items-center gap-3 text-muted-foreground"><Car className="size-5 animate-pulse" /> در انتظار پذیرش راننده…</div>
        )}
      </Card>

      <Card><h2 className="mb-2 font-bold">کرایه و کمیسیون</h2><FareTable km={t.km} night={t.night} mountain={t.mountain} agreed={t.suggested} /></Card>
      <DemoNote>پرداخت آنلاین و اعزام زنده در این نمونه شبیه‌سازی شده و نیاز به اتصال سرویس دارد.</DemoNote>

      <div className="grid gap-2">
        {t.status === "pending" && as === "passenger" && <Btn variant="accent" onClick={() => accept(t.id)}>شبیه‌سازی پذیرش توسط راننده ({ME_DRIVER.name})</Btn>}
        {t.status === "accepted" && <Btn onClick={() => setStatus(t.id, "ongoing")}>شروع سفر</Btn>}
        {t.status === "ongoing" && <Btn onClick={() => setStatus(t.id, "done")}>پایان سفر</Btn>}
        {(t.status === "pending" || t.status === "accepted") && <Btn variant="ghost" onClick={() => setStatus(t.id, "cancelled")}>لغو سفر</Btn>}
        <Link to="/support" className="text-center text-sm text-primary">گزارش مشکل این سفر</Link>
      </div>
    </div>
  );
}

function Party({ title, name, sub, phone, revealed, onCall }: { title: string; name: string; sub?: string; phone: string; revealed: boolean; onCall: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div>
        <div className="text-xs text-muted-foreground">{title}</div>
        <div className="font-bold">{name}</div>
        {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
        <div className="mt-1 text-sm tabular-nums">{revealed ? phone : <span className="flex items-center gap-1 text-muted-foreground"><Lock className="size-3" /> ۰۹•• ••• ••••</span>}</div>
      </div>
      {revealed && (
        <div className="flex gap-2">
          <button onClick={onCall} aria-label="تماس" className="grid size-11 place-items-center rounded-2xl bg-primary text-primary-foreground"><Phone className="size-5" /></button>
          <button onClick={onCall} aria-label="پیام" className="grid size-11 place-items-center rounded-2xl bg-secondary text-secondary-foreground"><MessageSquare className="size-5" /></button>
        </div>
      )}
    </div>
  );
}
