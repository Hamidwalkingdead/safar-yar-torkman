import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { ShieldAlert, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { SharedSignIn, useSharedAuth } from "@/components/shared-auth";
import { useAccount } from "@/lib/account";
import { Badge, Btn, Card } from "@/components/ui-kit";
import { fa, toman } from "@/lib/fare";
import { statusLabel, type TripStatus } from "@/lib/store";
import { departureLabel } from "@/lib/shared-rides";
import { billingFeatures } from "@/lib/billing-config";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "پنل مدیر | سفر یار ترکمن" },
      { name: "description", content: "آمار سفرها و مدیریت تیکت‌های پشتیبانی برای مدیران." },
      { name: "robots", content: "noindex" },
      { property: "og:title", content: "پنل مدیر | سفر یار ترکمن" },
      { property: "og:description", content: "پنل مدیریت سفر یار ترکمن." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Admin,
});

const ticketStatus = { open: "ثبت شد", review: "در حال بررسی", resolved: "حل شد" } as const;

function Admin() {
  const { userId, ready } = useSharedAuth();
  const account = useAccount();
  if (!ready || (userId && account.isPending)) return <p className="p-4">در حال بررسی دسترسی…</p>;
  if (!userId)
    return (
      <div className="space-y-4 p-4">
        <h1 className="text-2xl font-black">پنل مدیر</h1>
        <SharedSignIn />
      </div>
    );
  if (!account.data?.isAdmin)
    return (
      <div className="p-4">
        <Card className="flex items-center gap-3">
          <ShieldAlert className="size-8 text-destructive" />
          <div>
            <b>دسترسی محدود</b>
            <p className="text-sm text-muted-foreground">این بخش فقط برای مدیران است.</p>
          </div>
        </Card>
      </div>
    );
  return <Dashboard />;
}

function Dashboard() {
  const cache = useQueryClient();
  const [filter, setFilter] = useState<TripStatus | "all">("all");
  const [ticketReplies, setTicketReplies] = useState<Record<string, string>>({});
  const [ticketReplyBusy, setTicketReplyBusy] = useState<string | null>(null);
  const [driverReviewNotes, setDriverReviewNotes] = useState<Record<string, string>>({});
  const [driverReviewBusy, setDriverReviewBusy] = useState<string | null>(null);
  const [ticketStatusBusy, setTicketStatusBusy] = useState<string | null>(null);
  const [withdrawalBusy, setWithdrawalBusy] = useState<string | null>(null);
  const trips = useQuery({
    queryKey: ["admin-trips"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("trips")
        .select(
          "id,passenger_name,origin,destination,departure_at,status,agreed_fare,commission,driver_id",
        )
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return data;
    },
  });
  const withdrawals = useQuery({
    queryKey: ["admin-wallet-withdrawals"],
    enabled: billingFeatures.wallet,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("wallet_withdrawal_requests")
        .select("id,user_id,amount,card_number,status,created_at,note")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data;
    },
  });
  const revenue = useQuery({
    queryKey: ["admin-platform-revenue"],
    enabled: billingFeatures.wallet,
    queryFn: async () => {
      const { data, error } = await supabase.from("platform_revenue").select("balance").eq("id", true).maybeSingle();
      if (error) throw error;
      return data?.balance ?? 0;
    },
  });
  async function reviewWithdrawal(id: string, status: "paid" | "rejected") {
    if (withdrawalBusy) return;
    setWithdrawalBusy(id);
    try {
      const { error } = await supabase.rpc("admin_review_wallet_withdrawal", {
        p_request: id,
        p_status: status,
        p_note: status === "paid" ? "واریز توسط مدیر تأیید شد" : "درخواست برداشت توسط مدیر رد شد",
      });
      if (error) throw error;
      await cache.invalidateQueries({ queryKey: ["admin-wallet-withdrawals"] });
      await cache.invalidateQueries({ queryKey: ["admin-platform-revenue"] });
      toast.success(status === "paid" ? "برداشت تأیید و از کیف پول کسر شد" : "درخواست برداشت رد شد");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "بررسی درخواست برداشت انجام نشد");
    } finally {
      setWithdrawalBusy(null);
    }
  }

  const tickets = useQuery({
    queryKey: ["admin-tickets"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("support_tickets")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data;
    },
    refetchInterval: 10000,
  });
  const ticketMessages = useQuery({
    queryKey: ["admin-ticket-replies"],
    queryFn: async () => {
      const { data, error } = await supabase.from("support_ticket_replies").select("*").order("created_at");
      if (error) throw error;
      return data ?? [];
    },
    refetchInterval: 10000,
  });
  async function replyToTicket(id: string) {
    const body = (ticketReplies[id] ?? "").trim();
    if (!body || ticketReplyBusy) return;
    setTicketReplyBusy(id);
    try {
      const { error } = await supabase.rpc("reply_support_ticket", { p_ticket: id, p_body: body });
      if (error) throw error;
      setTicketReplies((current) => ({ ...current, [id]: "" }));
      await cache.invalidateQueries({ queryKey: ["admin-ticket-replies"] });
      await cache.invalidateQueries({ queryKey: ["admin-tickets"] });
      toast.success("پاسخ برای مسافر ارسال شد");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "ارسال پاسخ انجام نشد");
    } finally {
      setTicketReplyBusy(null);
    }
  }
  async function setTicket(id: string, status: string) {
    if (ticketStatusBusy) return;
    setTicketStatusBusy(id);
    try {
      const { error } = await supabase.rpc("admin_set_ticket_status", {
        p_ticket: id,
        p_status: status,
      });
      if (error) throw error;
      await cache.invalidateQueries({ queryKey: ["admin-tickets"] });
      toast.success("وضعیت تیکت به‌روز شد");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "تغییر وضعیت انجام نشد");
    } finally {
      setTicketStatusBusy(null);
    }
  }

  const driverDocs = useQuery({
    queryKey: ["admin-driver-docs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("driver_documents")
        .select("user_id,kind,path,created_at")
        .order("created_at", { ascending: false });
      if (error) throw error;
      const ids = [...new Set((data ?? []).map((d) => d.user_id))];
      const [profiles, verifications] = await Promise.all([
        supabase.from("profiles").select("id,first_name,last_name,display_name,phone,car,plate").in("id", ids),
        supabase.from("driver_verifications").select("user_id,status,note,reviewed_at").in("user_id", ids),
      ]);
      if (profiles.error) throw profiles.error;
      if (verifications.error) throw verifications.error;
      return Promise.all((data ?? []).map(async (doc) => {
        const profile = profiles.data.find((p) => p.id === doc.user_id);
        const verification = verifications.data.find((v) => v.user_id === doc.user_id);
        const signed = await supabase.storage.from("driver-documents").createSignedUrl(doc.path, 300);
        return { ...doc, profile, status: verification?.status ?? "pending", note: verification?.note ?? "", url: signed.data?.signedUrl ?? null };
      }));
    },
  });
  async function reviewDriver(userId: string, status: "approved" | "rejected") {
    const note = (driverReviewNotes[userId] ?? "").trim();
    if (driverReviewBusy) return;
    if (status === "rejected" && !note) {
      toast.error("برای رد مدارک، علت را بنویسید تا راننده بتواند اصلاح کند.");
      return;
    }
    setDriverReviewBusy(userId);
    try {
      const { error } = await supabase.rpc("admin_review_driver", {
        p_user: userId,
        p_status: status,
        p_note: note || "مدارک و مشخصات بررسی شد",
      });
      if (error) throw error;
      setDriverReviewNotes((current) => ({ ...current, [userId]: "" }));
      await cache.invalidateQueries({ queryKey: ["admin-driver-docs"] });
      await cache.invalidateQueries({ queryKey: ["driver-verification", userId] });
      toast.success(status === "approved" ? "راننده تأیید شد" : "مدارک رد شد و علت برای راننده ثبت شد");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "ثبت نتیجه بررسی انجام نشد");
    } finally {
      setDriverReviewBusy(null);
    }
  }
  const list = trips.data ?? [];
  const count = (s: TripStatus) => list.filter((t) => t.status === s).length;
  const done = list.filter((t) => t.status === "done");
  const shown = filter === "all" ? list : list.filter((t) => t.status === filter);
  return (
    <div className="space-y-4 p-4">
      <h1 className="text-2xl font-black">پنل مدیر</h1>
      {trips.error && <p role="alert">دریافت سفرها ممکن نشد.</p>}
      <div className="grid grid-cols-3 gap-2 text-center">
        {(["pending", "accepted", "ongoing", "done", "cancelled"] as const).map((s) => (
          <Card key={s} className="p-3">
            <b className="block text-xl">{fa(count(s))}</b>
            <span className="text-xs">{statusLabel[s]}</span>
          </Card>
        ))}
        <Card className="p-3">
          <b className="block text-sm">{toman(done.reduce((a, t) => a + t.commission, 0))}</b>
          <span className="text-xs">کمیسیون سفرهای پایان‌یافته</span>
        </Card>
      </div>
      <div className="flex flex-wrap gap-2">
        {(["all", "pending", "accepted", "ongoing", "done", "cancelled"] as const).map((s) => (
          <Btn key={s} variant={filter === s ? "primary" : "ghost"} onClick={() => setFilter(s)}>
            {s === "all" ? "همه" : statusLabel[s]}
          </Btn>
        ))}
      </div>
      {shown.slice(0, 50).map((t) => (
        <Card key={t.id} className="space-y-1 text-sm">
          <div className="flex justify-between">
            <b>
              {t.origin} ← {t.destination}
            </b>
            <Badge>{statusLabel[t.status as TripStatus]}</Badge>
          </div>
          <p>
            {t.passenger_name} · {departureLabel(t.departure_at)} · {toman(t.agreed_fare)}
          </p>
        </Card>
      ))}
      <h2 className="pt-4 text-lg font-bold">بررسی هویت رانندگان ({fa(new Set((driverDocs.data ?? []).map(d => d.user_id)).size)})</h2>
      <p className="text-xs text-muted-foreground">تا بررسی مدارک و تأیید مدیر، راننده امکان پذیرش سفر ندارد. با تغییر مشخصات یا مدارک، تأیید قبلی باطل می‌شود.</p>
      {driverDocs.isError && <p role="alert">دریافت مدارک رانندگان انجام نشد.</p>}
      {[...new Set((driverDocs.data ?? []).map(d => d.user_id))].map((uid) => {
        const docs = (driverDocs.data ?? []).filter(d => d.user_id === uid);
        const p = docs[0]?.profile;
        const status = docs[0]?.status;
        return <Card key={uid} className="space-y-2 text-sm">
          <b>{[p?.first_name,p?.last_name].filter(Boolean).join(" ") || "نام واقعی ثبت نشده"}</b>
          <p>نام نمایشی: {p?.display_name ?? "—"}</p>
          <p>موبایل: {p?.phone ?? "—"} · خودرو: {p?.car ?? "—"} · پلاک: {p?.plate ?? "—"}</p>
          <p>وضعیت: {status === "approved" ? "تأییدشده" : status === "rejected" ? "ردشده" : "در انتظار بررسی"}</p>
          <div className="grid grid-cols-2 gap-2">
            {docs.map(d => <a key={d.kind} href={d.url ?? undefined} target="_blank" rel="noreferrer" className="text-primary underline">{({car_card:"کارت خودرو",insurance:"بیمه‌نامه",insurance_certificate:"گواهی بیمه",license:"گواهینامه",car_inside:"داخل خودرو",car_outside:"بیرون خودرو",selfie:"سلفی"} as Record<string,string>)[d.kind] ?? d.kind} · مشاهده</a>)}
          </div>
          <div className="flex gap-2">
            <Btn disabled={docs.length !== 7 || status === "approved"} onClick={() => void reviewDriver(uid, "approved")}>تأیید راننده</Btn>
            <Btn variant="ghost" disabled={status === "rejected"} onClick={() => void reviewDriver(uid, "rejected")}>رد مدارک</Btn>
          </div>
        </Card>;
      })}
      {billingFeatures.wallet && <>
      <h2 className="pt-4 text-lg font-bold">مالی و برداشت‌ها</h2>
      <Card className="space-y-1">
        <p className="text-sm text-muted-foreground">درآمد ثبت‌شده سامانه از کمیسیون‌ها</p>
        <b className="text-xl">{revenue.isLoading ? "…" : revenue.error ? "نامشخص" : toman(revenue.data ?? 0)}</b>
      </Card>
      <h3 className="font-bold">درخواست‌های برداشت کیف پول ({fa(withdrawals.data?.filter(w => w.status === "pending").length ?? 0)} در انتظار)</h3>
      {withdrawals.error && <p role="alert">دریافت درخواست‌های برداشت ممکن نشد.</p>}
      {(withdrawals.data ?? []).map(w => (
        <Card key={w.id} className="space-y-2 text-sm">
          <div className="flex justify-between gap-2">
            <b>{toman(w.amount)}</b>
            <Badge>{w.status === "pending" ? "در انتظار بررسی" : w.status === "paid" ? "پرداخت‌شده" : "ردشده"}</Badge>
          </div>
          <p>شناسه کاربر: {w.user_id}</p>
          <p>کارت مقصد: {w.card_number.replace(/^(\d{4})\d{8}(\d{4})$/, "$1 •••• •••• $2")}</p>
          <p className="text-xs text-muted-foreground">{departureLabel(w.created_at)}{w.note ? " · " + w.note : ""}</p>
          {w.status === "pending" && <div className="flex gap-2">
            <Btn onClick={() => void reviewWithdrawal(w.id, "paid")}>ثبت واریز انجام‌شده</Btn>
            <Btn variant="ghost" onClick={() => void reviewWithdrawal(w.id, "rejected")}>رد درخواست</Btn>
          </div>}
          {w.status === "pending" && <p className="text-xs text-muted-foreground">تأیید فقط موجودی کیف پول و دفتر تراکنش را به‌روزرسانی می‌کند؛ انتقال بانکی واقعی باید جداگانه توسط مدیر انجام شود.</p>}
        </Card>
      ))}
      </>}
      <h2 className="pt-2 text-lg font-bold">
        تیکت‌های پشتیبانی ({fa(tickets.data?.length ?? 0)})
      </h2>
      {tickets.error && <p role="alert">دریافت تیکت‌ها ممکن نشد.</p>}
      {(tickets.data ?? []).map((t) => (
        <Card key={t.id} className="space-y-2 text-sm">
          <div className="flex justify-between">
            <b>{t.subject}</b>
            <Badge>{ticketStatus[t.status as keyof typeof ticketStatus] ?? t.status}</Badge>
          </div>
          <p className="text-muted-foreground">
            {t.category} · {departureLabel(t.created_at)}
          </p>
          <p>{t.body}</p>
          <div className="space-y-2 rounded-xl bg-muted p-3">
            <b>گفت‌وگو</b>
            {(ticketMessages.data ?? []).filter((m) => m.ticket_id === t.id).map((m) => (
              <div key={m.id} className="rounded-lg bg-background p-2">
                <p className="mb-1 text-xs text-muted-foreground">{m.sender_id === t.user_id ? "مسافر" : "پشتیبانی"} · {departureLabel(m.created_at)}</p>
                <p className="whitespace-pre-wrap">{m.body}</p>
              </div>
            ))}
            {ticketMessages.isError && <p role="alert" className="text-xs text-destructive">دریافت پیام‌ها ناموفق بود.</p>}
            <textarea rows={2} maxLength={4000} value={ticketReplies[t.id] ?? ""} onChange={(e) => setTicketReplies((current) => ({ ...current, [t.id]: e.target.value }))} placeholder="پاسخ کارشناس به مسافر…" className="w-full rounded-xl bg-background p-3" />
            <Btn disabled={!ticketReplies[t.id]?.trim() || ticketReplyBusy === t.id} onClick={() => void replyToTicket(t.id)}>{ticketReplyBusy === t.id ? "در حال ارسال…" : "ارسال پاسخ به مسافر"}</Btn>
          </div>
          <div className="flex gap-2">
            {(Object.keys(ticketStatus) as (keyof typeof ticketStatus)[])
              .filter((s) => s !== t.status)
              .map((s) => (
                <Btn key={s} variant="ghost" onClick={() => void setTicket(t.id, s)}>
                  {ticketStatus[s]}
                </Btn>
              ))}
          </div>
        </Card>
      ))}
    </div>
  );
}
