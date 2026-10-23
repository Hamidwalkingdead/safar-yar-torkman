import type { ReactNode } from "react";
import { calculateFare, commission, toman, fa, FARE } from "@/lib/fare";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-3xl border border-border bg-card p-5 shadow-soft ${className}`}>
      {children}
    </div>
  );
}
export function Btn({
  children,
  variant = "primary",
  className = "",
  ...p
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "accent" }) {
  const v = {
    primary: "bg-primary text-primary-foreground",
    accent: "bg-accent text-accent-foreground",
    ghost: "bg-secondary text-secondary-foreground",
  }[variant];
  return (
    <button
      {...p}
      className={`inline-flex items-center justify-center gap-2 rounded-2xl px-5 py-3 font-bold transition active:scale-[.98] disabled:opacity-40 ${v} ${className}`}
    >
      {children}
    </button>
  );
}
export function Badge({
  children,
  tone = "muted",
}: {
  children: ReactNode;
  tone?: "muted" | "accent" | "primary";
}) {
  const v = {
    muted: "bg-muted text-muted-foreground",
    accent: "bg-accent/20 text-accent-foreground",
    primary: "bg-primary/10 text-primary",
  }[tone];
  return <span className={`rounded-full px-3 py-1 text-xs font-bold ${v}`}>{children}</span>;
}
export function DemoNote({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-accent bg-accent/10 px-4 py-2 text-xs text-foreground">
      🔌 {children}
    </div>
  );
}

export function FareTable({
  km,
  night,
  mountain,
  agreed,
}: {
  km: number;
  night: boolean;
  mountain: boolean;
  agreed?: number | undefined;
}) {
  const b = calculateFare({ km, night, mountain });
  const fare = agreed ?? b.total;
  const c = commission(fare);
  const Row = ({ l, v, s }: { l: string; v: string; s?: boolean }) => (
    <div className={`flex justify-between py-1.5 ${s ? "text-muted-foreground text-sm" : ""}`}>
      <span>{l}</span>
      <span className="tabular-nums">{v}</span>
    </div>
  );
  return (
    <div className="divide-y divide-border">
      <div className="pb-2">
        <Row
          l={`${mountain ? "نرخ جاده کوهستانی" : "نرخ پایه"} (${fa(km)} کیلومتر × ${fa(b.baseRate)})`}
          v={toman(b.base)}
        />
        {night && (
          <Row l={`اضافه شبانه (${fa(km)} × ${fa(FARE.nightSurchargePerKm)})`} v={toman(b.night)} />
        )}
        {b.longKm > 0 && (
          <Row
            l={`مسافت بالای ۳۰۰ کیلومتر (${fa(b.longKm)} × ${fa(FARE.longDistancePerKm)})`}
            v={toman(b.long)}
          />
        )}
        {b.minimumApplied && <Row s l="حداقل کرایه اعمال شد" v={toman(FARE.minimum)} />}
      </div>
      <div className="py-2 font-bold">
        <Row l="کرایه محاسبه‌شده" v={toman(b.total)} />
      </div>
      {agreed !== undefined && agreed !== b.total && (
        <div className="py-2 font-bold text-primary">
          <Row l="کرایه پیشنهادی مسافر" v={toman(agreed)} />
        </div>
      )}
      <div className="pt-2">
        <Row s l="کمیسیون پلتفرم (۱۰٪)" v={toman(c.commission)} />
        <Row s l="سهم خالص راننده" v={toman(c.driverNet)} />
      </div>
    </div>
  );
}
