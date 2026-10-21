import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Card, DemoNote } from "@/components/ui-kit";
import { ME_PASSENGER } from "@/lib/store";

export const Route = createFileRoute("/profile")({
  head: () => ({
    meta: [
      { title: "پروفایل و تنظیمات | راه‌یار" },
      { name: "description", content: "اطلاعات حساب، اعلان‌ها و تنظیمات حریم خصوصی." },
      { property: "og:title", content: "پروفایل و تنظیمات | راه‌یار" },
      { property: "og:description", content: "تنظیمات حساب کاربری راه‌یار." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Profile,
});

function Profile() {
  const [name, setName] = useState(ME_PASSENGER.name);
  const [s, setS] = useState({ notif: true, sms: false, share: true });
  const rows: [keyof typeof s, string][] = [["notif", "اعلان درخواست و وضعیت سفر"], ["sms", "پیامک رسید سفر"], ["share", "اشتراک مسیر با مخاطب اضطراری"]];
  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center gap-4 pt-2">
        <div className="grid size-16 place-items-center rounded-3xl bg-accent text-2xl font-black text-accent-foreground">{name[0]}</div>
        <div><h1 className="text-xl font-black">{name}</h1><p className="text-sm text-muted-foreground tabular-nums">{ME_PASSENGER.phone}</p></div>
      </div>
      <Card className="space-y-2"><label className="text-sm text-muted-foreground">نام نمایشی (برای راننده از ابتدا دیده می‌شود)</label>
        <input value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded-2xl bg-muted px-4 py-3 outline-none" /></Card>
      <Card className="space-y-3">
        {rows.map(([k, l]) => (
          <label key={k} className="flex items-center justify-between"><span>{l}</span>
            <button onClick={() => setS({ ...s, [k]: !s[k] })} className={`h-7 w-12 rounded-full p-1 transition ${s[k] ? "bg-primary" : "bg-muted"}`}><span className={`block size-5 rounded-full bg-card transition ${s[k] ? "-translate-x-5" : ""}`} /></button>
          </label>
        ))}
      </Card>
      <Card className="text-sm text-muted-foreground">زبان: فارسی · واحد پول: تومان</Card>
      <DemoNote>ورود با پیامک، کیف پول و پرداخت آنلاین نیاز به راه‌اندازی سرویس دارد.</DemoNote>
    </div>
  );
}
