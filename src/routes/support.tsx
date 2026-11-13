import { createFileRoute } from "@tanstack/react-router";
import { SharedSignIn, useSharedAuth } from "@/components/shared-auth";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
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
  const { userId } = useSharedAuth();
  const { tickets, addTicket } = useStore();
  const cache = useQueryClient();
  const [replies, setReplies] = useState<Record<string, string>>({});
  const [replyBusy, setReplyBusy] = useState<string | null>(null);
  const messages = useQuery({
    queryKey: ["support-replies", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase.from("support_ticket_replies").select("*").order("created_at");
      if (error) throw error;
      return data ?? [];
    },
    refetchInterval: 10000,
  });
  async function sendReply(ticketId: string) {
    const body = (replies[ticketId] ?? "").trim();
    if (!body || replyBusy) return;
    setReplyBusy(ticketId);
    const { error } = await supabase.rpc("reply_support_ticket", { p_ticket: ticketId, p_body: body });
    setReplyBusy(null);
    if (error) { toast.error(error.message || "ارسال پاسخ انجام نشد"); return; }
    setReplies((current) => ({ ...current, [ticketId]: "" }));
    await cache.invalidateQueries({ queryKey: ["support-replies", userId] });
    toast.success("پاسخ شما ثبت شد");
  }
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
          <p className="text-sm opacity-80">ثبت گزارش و گفت‌وگوی مستقیم با پشتیبانی</p>
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
          <div className="space-y-2 border-t border-border pt-3">
            <b className="text-sm">گفت‌وگو با پشتیبانی</b>
            {(messages.data ?? []).filter((m) => m.ticket_id === t.id).map((m) => (
              <div key={m.id} className={m.sender_id === userId ? "mr-4 rounded-xl bg-primary/10 p-3" : "ml-4 rounded-xl bg-muted p-3"}>
                <p className="mb-1 text-xs text-muted-foreground">{m.sender_id === userId ? "شما" : "کارشناس پشتیبانی"} · {new Date(m.created_at).toLocaleString("fa-IR")}</p>
                <p className="whitespace-pre-wrap">{m.body}</p>
              </div>
            ))}
            {messages.isError && <p role="alert" className="text-xs text-destructive">دریافت پاسخ‌ها ممکن نشد.</p>}
            {t.status !== "resolved" && <>
              <textarea rows={2} maxLength={4000} value={replies[t.id] ?? ""} onChange={(e) => setReplies((current) => ({ ...current, [t.id]: e.target.value }))} placeholder="پیام تکمیلی برای پشتیبانی…" className="w-full rounded-xl bg-muted p-3" />
              <Btn className="w-full" disabled={!replies[t.id]?.trim() || replyBusy === t.id} onClick={() => void sendReply(t.id)}>{replyBusy === t.id ? "در حال ارسال…" : "ارسال پیام"}</Btn>
            </>}
          </div>
        </Card>
      ))}
      <DemoNote>پیام‌ها فقط برای صاحب تیکت و مدیران مجاز قابل مشاهده‌اند. پس از حل شدن تیکت، گفت‌وگو بسته می‌شود.</DemoNote>
    </div>
  );
}
