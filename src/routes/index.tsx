import { createFileRoute, Link } from "@tanstack/react-router";
import { Car, UserRound, ShieldCheck, Mountain, Moon, Route as RouteIcon } from "lucide-react";
import { Card } from "@/components/ui-kit";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "سفر یار ترکمن — سفر همراه، کرایه شفاف" },
      {
        name: "description",
        content: "درخواست سفر بین‌شهری فارسی با کرایه شفاف، پیشنهاد کرایه و پشتیبانی آنلاین.",
      },
      { property: "og:title", content: "سفر یار ترکمن — سفر همراه، کرایه شفاف" },
      {
        property: "og:description",
        content: "درخواست سفر، پیشنهاد کرایه و پشتیبانی آنلاین بین‌شهری.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  return (
    <div>
      <header className="bg-hero rounded-b-[2.5rem] px-6 pb-14 pt-10 text-primary-foreground">
        <div className="flex items-center gap-2 text-sm opacity-80">
          <span className="grid size-9 place-items-center rounded-xl bg-accent text-lg font-black text-accent-foreground">
            ر
          </span>
          سفر یار ترکمن
        </div>
        <h1 className="mt-8 text-4xl font-black leading-tight">سفر یار ترکمن</h1>
        <p className="mt-3 opacity-80">
          قیمت شفاف، پیشنهاد کرایه از طرف مسافر و تماس امن پس از پذیرش سفر.
        </p>
      </header>
      <div className="-mt-8 grid grid-cols-2 gap-3 px-4">
        <Link to="/passenger">
          <Card className="h-full">
            <UserRound className="size-8 text-primary" />
            <div className="mt-3 text-lg font-bold">من مسافرم</div>
            <p className="text-sm text-muted-foreground">درخواست سفر و پیشنهاد کرایه</p>
          </Card>
        </Link>
        <Link to="/driver">
          <Card className="h-full bg-accent">
            <Car className="size-8" />
            <div className="mt-3 text-lg font-bold">من راننده‌ام</div>
            <p className="text-sm opacity-80">دیدن و پذیرش درخواست‌ها</p>
          </Card>
        </Link>
      </div>
      <div className="mt-6 space-y-3 px-4">
        <h2 className="font-bold">نرخ‌نامه</h2>
        {(
          [
            [RouteIcon, "نرخ پایه", "هر کیلومتر ۱۴٬۰۰۰ تومان — حداقل کرایه ۸۰٬۰۰۰"],
            [Mountain, "جاده کوهستانی", "هر کیلومتر ۱۶٬۰۰۰ تومان به‌جای نرخ پایه"],
            [Moon, "سفر شبانه", "۱٬۵۰۰ تومان اضافه برای هر کیلومتر"],
            [RouteIcon, "سفر طولانی", "۱٬۰۰۰ تومان اضافه فقط برای کیلومترهای بالای ۳۰۰"],
            [ShieldCheck, "کمیسیون", "۱۰٪ کرایه، جدا محاسبه و نمایش داده می‌شود"],
          ] as const
        ).map(([I, t, d]) => (
          <div key={t} className="flex items-center gap-3 rounded-2xl bg-card p-3">
            <span className="grid size-10 place-items-center rounded-xl bg-secondary text-primary">
              <I className="size-5" />
            </span>
            <div>
              <div className="font-bold">{t}</div>
              <div className="text-sm text-muted-foreground">{d}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
