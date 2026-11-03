import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Camera, Check } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export const DOC_KINDS = [
  ["car_card", "کارت ماشین"],
  ["insurance", "بیمه‌نامه"],
  ["insurance_certificate", "گواهی بیمه"],
  ["license", "گواهینامه"],
  ["car_inside", "عکس داخل خودرو"],
  ["car_outside", "عکس بیرون خودرو"],
  ["selfie", "عکس سلفی"],
] as const;
export type DocKind = (typeof DOC_KINDS)[number][0];

export function useDriverDocs(userId: string) {
  return useQuery({
    queryKey: ["driver-docs", userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("driver_documents")
        .select("kind")
        .eq("user_id", userId);
      if (error) throw error;
      return new Set((data ?? []).map((d) => d.kind));
    },
  });
}

export function DriverDocuments({ userId }: { userId: string }) {
  const docs = useDriverDocs(userId);
  const cache = useQueryClient();
  const [busy, setBusy] = useState<DocKind | null>(null);
  async function upload(kind: DocKind, file: File) {
    if (!file.type.startsWith("image/")) return void toast.error("فقط فایل تصویری مجاز است");
    if (file.size > 8 * 1024 * 1024) return void toast.error("حداکثر حجم عکس ۸ مگابایت است");
    setBusy(kind);
    try {
      const ext = (file.name.split(".").pop() ?? "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
      const path = `${userId}/${kind}-${Date.now()}.${ext || "jpg"}`;
      const up = await supabase.storage.from("driver-documents").upload(path, file, {
        contentType: file.type,
      });
      if (up.error) throw up.error;
      const row = await supabase
        .from("driver_documents")
        .upsert({ user_id: userId, kind, path }, { onConflict: "user_id,kind" });
      if (row.error) throw row.error;
      await cache.invalidateQueries({ queryKey: ["driver-docs", userId] });
      toast.success("عکس بارگذاری شد");
    } catch {
      toast.error("بارگذاری انجام نشد؛ دوباره تلاش کنید");
    } finally {
      setBusy(null);
    }
  }
  return (
    <div className="space-y-2">
      <h3 className="font-bold">مدارک راننده (الزامی)</h3>
      <p className="text-xs text-muted-foreground">
        عکس‌ها خصوصی‌اند و فقط برای خودتان و مدیر قابل مشاهده‌اند.
      </p>
      <div className="grid grid-cols-2 gap-2">
        {DOC_KINDS.map(([kind, label]) => {
          const done = docs.data?.has(kind);
          return (
            <label
              key={kind}
              className={`flex cursor-pointer items-center gap-2 rounded-2xl border-2 p-3 text-sm ${done ? "border-primary bg-primary/10" : "border-dashed border-border"}`}
            >
              {done ? <Check className="size-4 text-primary" /> : <Camera className="size-4" />}
              <span>
                {label}
                <span className="block text-xs text-muted-foreground">
                  {busy === kind ? "در حال ارسال…" : done ? "ثبت شد (تعویض)" : "انتخاب عکس"}
                </span>
              </span>
              <input
                type="file"
                accept="image/*"
                capture={kind === "selfie" ? "user" : "environment"}
                aria-label={label}
                className="sr-only"
                disabled={!!busy}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void upload(kind, f);
                  e.target.value = "";
                }}
              />
            </label>
          );
        })}
      </div>
    </div>
  );
}
