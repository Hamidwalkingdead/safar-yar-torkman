import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Card, Btn, DemoNote } from "@/components/ui-kit";
import { SharedSignIn, useSharedAuth } from "@/components/shared-auth";
import { useAccount } from "@/lib/account";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
export const Route = createFileRoute("/profile")({
  head: () => ({
    meta: [
      { title: "پروفایل و تنظیمات | سفر یار ترکمن" },
      { name: "description", content: "اطلاعات حساب، اعلان‌ها و تنظیمات حریم خصوصی." },
      { property: "og:title", content: "پروفایل و تنظیمات | سفر یار ترکمن" },
      { property: "og:description", content: "تنظیمات حساب کاربری سفر یار ترکمن." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Profile,
});

function Profile() {
  const { userId } = useSharedAuth();
  const account = useAccount();
  const cache = useQueryClient();
  return (
    <div className="space-y-4 p-4">
      <h1 className="text-2xl font-black">پروفایل امن</h1>
      {!userId ? (
        <SharedSignIn />
      ) : account.data ? (
        <>
          <ProfileForm
            key={account.data.profile.id + JSON.stringify(account.data)}
            profile={account.data.profile}
            isDriver={account.data.isDriver}
          />
          <Btn
            variant="ghost"
            onClick={async () => {
              await cache.cancelQueries();
              cache.clear();
              const { error } = await supabase.auth.signOut();
              if (error) toast.error("خروج انجام نشد");
            }}
          >
            خروج از حساب
          </Btn>
        </>
      ) : (
        <p>{account.error ? "دریافت پروفایل ممکن نشد" : "در حال دریافت…"}</p>
      )}
      <DemoNote>
        پرداخت آنلاین و کیف پول فعال نیستند؛ اتصال درگاه ایرانی و تأیید تراکنش واقعی لازم است. شماره
        تماس و مشخصات خودرو خوداظهاری‌اند و هنوز احراز نشده‌اند.
      </DemoNote>
    </div>
  );
}
function ProfileForm({
  profile,
  isDriver,
}: {
  profile: Database["public"]["Tables"]["profiles"]["Row"];
  isDriver: boolean;
}) {
  const [name, setName] = useState(profile.display_name),
    [phone, setPhone] = useState(profile.phone),
    [car, setCar] = useState(profile.car),
    [plate, setPlate] = useState(profile.plate),
    [busy, setBusy] = useState(false);
  const cache = useQueryClient();
  async function save(driver = false) {
    setBusy(true);
    try {
      const normalized = phone
        .replace(/[۰-۹]/g, (c) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(c)))
        .replace(/\s/g, "");
      if (name.trim().length < 2 || !/^09[0-9]{9}$/.test(normalized))
        throw new Error("نام و شماره همراه معتبر ایران را وارد کنید");
      const { error } = await supabase
        .from("profiles")
        .update({
          display_name: name.trim(),
          phone: normalized,
          car: car.trim(),
          plate: plate.trim(),
        })
        .eq("id", profile.id);
      if (error) throw error;
      if (driver) {
        const result = await supabase.rpc("register_driver");
        if (result.error) throw result.error;
      }
      await cache.invalidateQueries({ queryKey: ["account"] });
      await cache.invalidateQueries({ queryKey: ["trips"] });
      toast.success(driver ? "ثبت‌نام راننده انجام شد" : "پروفایل ذخیره شد");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "ذخیره انجام نشد");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card className="space-y-4">
      <label className="block">
        نام نمایشی
        <input
          aria-label="نام نمایشی"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mt-1 w-full rounded-2xl bg-muted p-3"
        />
      </label>
      <label className="block">
        شماره همراه
        <input
          aria-label="شماره همراه"
          inputMode="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          className="mt-1 w-full rounded-2xl bg-muted p-3"
        />
      </label>
      <p className="text-xs text-muted-foreground">
        شماره فقط برای خودتان و طرف مجاز سفر پذیرفته‌شده قابل دریافت است.
      </p>
      <label className="block">
        مدل و رنگ خودرو
        <input
          aria-label="مدل و رنگ خودرو"
          value={car}
          onChange={(e) => setCar(e.target.value)}
          className="mt-1 w-full rounded-2xl bg-muted p-3"
        />
      </label>
      <label className="block">
        پلاک خودرو
        <input
          aria-label="پلاک خودرو"
          value={plate}
          onChange={(e) => setPlate(e.target.value)}
          className="mt-1 w-full rounded-2xl bg-muted p-3"
        />
      </label>
      <Btn disabled={busy} onClick={() => save()}>
        ذخیره پروفایل
      </Btn>
      {!isDriver ? (
        <Btn
          variant="accent"
          disabled={busy || !car.trim() || !plate.trim()}
          onClick={() => save(true)}
        >
          ثبت‌نام راننده
        </Btn>
      ) : (
        <p className="text-primary">حساب راننده فعال است · مشخصات خوداظهاری</p>
      )}
    </Card>
  );
}
