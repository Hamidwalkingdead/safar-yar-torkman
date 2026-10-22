import { createFileRoute } from "@tanstack/react-router";
import { SharedSignIn, useSharedAuth } from "@/components/shared-auth";
import { useState } from "react";
import { Headset } from "lucide-react";
import { toast } from "sonner";
import { Badge, Btn, Card, DemoNote } from "@/components/ui-kit";
import { useStore, type Ticket } from "@/lib/store";

export const Route = createFileRoute("/support")({
  head: () => ({
    meta: [
      { title: "مرکز پشتیبانی | سفر یار ترکمن" },
      { name: "description", content: "گزارش آنلاین مشکل، ثبت شکایت و پیگیری وضعیت تیکت‌ها." },
      { property: "og:title", content: "مرکز پشتیبانی | سفر یار ترکمن" },
      { property: "og:description", content: "ثبت و پیگیری شکایت‌ها در سفر یار ترکمن." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Support,
});

const cats = ["کرایه", "رفتار راننده", "رفتار مسافر", "اشیای گمشده", "ایمنی", "سایر"];
const st: Record<"open" | "review" | "resolved", [string, "muted" | "accent" | "primary"]> = {
  open: ["ثبت شد", "muted"],
  review: ["در حال بررسی", "accent"],
  resolved: ["حل شد", "primary"],
};

function Support() {
  const { tickets, addTicket } = useStore();
  const { userId } = useSharedAuth();
  const [busy, setBusy] = useState(false);
  const [category, setCat] = useState<string>(cats[0] ?? "کرایه");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  return (
    <div className="space-y-4 p-4">
      <div className="bg-hero flex items-center gap-4 rounded-3xl p-5 text-primary-foreground">
        <Headset className="size-10" />
        <div>
          <h1 className="text-xl font-black">مرکز پشتیبانی سفر یار ترکمن</h1>
          <p className="text-sm opacity-80">ثبت گزارش · تیم پاسخ‌گویی هنوز راه‌اندازی نشده</p>
        </div>
      </div>
      {!userId && <SharedSignIn />}
      <Card className="space-y-3">
        <h2 className="font-bold">گزارش مشکل</h2>
        <div className="flex flex-wrap gap-2">
          {cats.map((c) => (
            <button
              key={c}
              onClick={() => setCat(c)}
              className={`rounded-full px-3 py-1.5 text-sm ${c === category ? "bg-primary text-primary-foreground" : "bg-muted"}`}
            >
              {c}
            </button>
          ))}
        </div>
        <input
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="موضوع"
          className="w-full rounded-2xl bg-muted px-4 py-3 outline-none"
        />
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={4}
          placeholder="توضیحات…"
          className="w-full rounded-2xl bg-muted px-4 py-3 outline-none"
        />
        <Btn
          className="w-full"
          disabled={busy || !userId || subject.trim().length < 2 || body.trim().length < 2}
          onClick={async () => {
            setBusy(true);
            try {
              await addTicket({ category, subject, body });
              setSubject("");
              setBody("");
              toast.success("تیکت شما ثبت شد");
            } catch {
              toast.error("ثبت گزارش انجام نشد");
            } finally {
              setBusy(false);
            }
          }}
        >
          ارسال تیکت
        </Btn>
      </Card>
      <h2 className="font-bold">تیکت‌های من</h2>
      {tickets.map((t) => (
        <Card key={t.id} className="space-y-1">
          <div className="flex justify-between">
            <b>{t.subject}</b>
            <Badge tone={st[t.status as "open" | "review" | "resolved"][1]}>
              {st[t.status as "open" | "review" | "resolved"][0]}
            </Badge>
          </div>
          <div className="text-xs text-muted-foreground">
            {t.id} · {t.category} · {new Date(t.created_at).toLocaleDateString("fa-IR")}
          </div>
          <p className="text-sm">{t.body}</p>
        </Card>
      ))}
      <DemoNote>
        گزارش‌ها در حساب شما ذخیره می‌شوند. پاسخ‌گویی و پنل کارشناس هنوز راه‌اندازی نشده‌اند.
      </DemoNote>
    </div>
  );
}
