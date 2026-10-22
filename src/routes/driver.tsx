import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Badge, Btn, Card, FareTable } from "@/components/ui-kit";
import { fa, toman } from "@/lib/fare";
import { useStore, statusLabel, type TripStatus } from "@/lib/store";
import { useSharedAuth, SharedSignIn } from "@/components/shared-auth";
import { useAccount } from "@/lib/account";
import { departureLabel } from "@/lib/shared-rides";
export const Route = createFileRoute("/driver")({
  head: () => ({
    meta: [
      { title: "پنل راننده | سفر یار ترکمن" },
      {
        name: "description",
        content: "درخواست‌های ورودی سفر، کرایه پیشنهادی مسافر و سهم خالص راننده.",
      },
      { property: "og:title", content: "پنل راننده | سفر یار ترکمن" },
      { property: "og:description", content: "درخواست‌های سفر را ببینید و بپذیرید." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Driver,
});

function Driver() {
  const { trips, accept, refresh, loading, error } = useStore();
  const { userId } = useSharedAuth();
  const account = useAccount();
  const nav = useNavigate();
  const [busy, setBusy] = useState<string | null>(null);
  async function take(id: string) {
    setBusy(id);
    try {
      await accept(id);
      await nav({ to: "/trip/$id", params: { id }, search: { as: "driver" } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "پذیرش انجام نشد");
    } finally {
      setBusy(null);
    }
  }
  const pending = trips.filter(
    (t) =>
      t.status === "pending" &&
      t.passenger_id !== userId &&
      new Date(t.departure_at).getTime() > Date.now(),
  );
  return (
    <div className="space-y-4 p-4">
      <h1 className="text-2xl font-black">پنل راننده</h1>
      {!userId ? (
        <SharedSignIn />
      ) : !account.data?.isDriver ? (
        <Card>
          <p>برای پذیرش سفر، مشخصات خودرو را در پروفایل کامل و ثبت‌نام راننده را انجام دهید.</p>
          <Link to="/profile" className="text-primary">
            تکمیل پروفایل راننده
          </Link>
        </Card>
      ) : (
        <>
          <p>
            {account.data.profile.display_name} · {account.data.profile.car}
          </p>
          <Btn variant="ghost" onClick={refresh}>
            تازه‌سازی
          </Btn>
          {loading && <p>در حال دریافت…</p>}
          {error && <p role="alert">{error}</p>}
          <h2 className="font-bold">درخواست‌های ورودی ({fa(pending.length)})</h2>
          {!pending.length && <p>درخواستی نیست.</p>}
          {pending.map((t) => (
            <Card key={t.id} className="space-y-3">
              <b>{t.passengerName}</b>
              <p>
                {t.from} ← {t.to} · {fa(t.km)} کیلومتر
              </p>
              <p className="text-sm">{departureLabel(t.departure_at)}</p>
              <div className="flex justify-between">
                <b>{toman(t.agreed_fare)}</b>
                <span>سهم راننده: {toman(t.driver_net)}</span>
              </div>
              <FareTable
                km={t.km}
                night={t.night}
                mountain={t.mountain}
                agreed={t.suggested ?? undefined}
              />
              <p className="text-xs text-muted-foreground">
                شماره مسافر فقط پس از پذیرش برای راننده همین سفر آشکار می‌شود.
              </p>
              <Btn disabled={!!busy} onClick={() => take(t.id)}>
                پذیرش سفر
              </Btn>
            </Card>
          ))}
          <h2 className="font-bold">سفرهای من</h2>
          {trips
            .filter((t) => t.driver_id === userId)
            .map((t) => (
              <Link
                key={t.id}
                to="/trip/$id"
                params={{ id: t.id }}
                search={{ as: "driver" }}
                className="block"
              >
                <Card className="flex justify-between">
                  <span>
                    {t.passengerName} · {t.to}
                  </span>
                  <Badge>{statusLabel[t.status as TripStatus]}</Badge>
                </Card>
              </Link>
            ))}
        </>
      )}
    </div>
  );
}
