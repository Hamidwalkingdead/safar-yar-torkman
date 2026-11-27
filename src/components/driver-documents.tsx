import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Camera, Check, ImagePlus, Send, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Btn } from "@/components/ui-kit";

export const DOC_KINDS = [
  ["car_card", "کارت ماشین"],
  ["insurance", "بیمه‌نامه"],
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
  const [selected, setSelected] = useState<Partial<Record<DocKind, File>>>({});
  const [sending, setSending] = useState(false);
  const completed = docs.data ?? new Set<string>();
  const readyCount = DOC_KINDS.filter(([kind]) => selected[kind] || completed.has(kind)).length;
  const allReady = readyCount === DOC_KINDS.length;
  const selectedCount = Object.keys(selected).length;
  const orderedFiles = useMemo(
    () => DOC_KINDS.flatMap(([kind]) => selected[kind] ? [{ kind, file: selected[kind]! }] : []),
    [selected],
  );

  function choose(kind: DocKind, file?: File) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("فقط فایل تصویری مجاز است");
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      toast.error("حداکثر حجم هر عکس ۸ مگابایت است");
      return;
    }
    setSelected((current) => ({ ...current, [kind]: file }));
  }

  async function submitAll() {
    if (!allReady || sending || !orderedFiles.length) return;
    setSending(true);
    const uploadedPaths: string[] = [];
    try {
      const results = await Promise.allSettled(orderedFiles.map(async ({ kind, file }) => {
        const ext = (file.name.split(".").pop() ?? "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
        const path = `${userId}/${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const result = await supabase.storage.from("driver-documents").upload(path, file, {
          contentType: file.type,
          upsert: false,
        });
        if (result.error) throw result.error;
        uploadedPaths.push(path);
        return { user_id: userId, kind, path };
      }));
      const failed = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
      if (failed) throw failed.reason;
      const rows = results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
      const { error } = await supabase
        .from("driver_documents")
        .upsert(rows, { onConflict: "user_id,kind" });
      if (error) throw error;
      setSelected({});
      await cache.invalidateQueries({ queryKey: ["driver-docs", userId] });
      await cache.invalidateQueries({ queryKey: ["driver-verification", userId] });
      toast.success("همه مدارک انتخاب‌شده یکجا ارسال شد و برای بررسی مدیر ثبت شد");
    } catch (error) {
      if (uploadedPaths.length) {
        await supabase.storage.from("driver-documents").remove(uploadedPaths).catch(() => undefined);
      }
      toast.error(error instanceof Error ? error.message : "ارسال مدارک کامل نشد؛ دوباره تلاش کنید");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <h3 className="font-bold">مدارک راننده (۶ مورد الزامی)</h3>
        <p className="text-xs text-muted-foreground">
          برای هر مورد از دوربین عکس بگیرید یا از گالری انتخاب کنید. عکس‌ها تا زدن دکمه ارسال، فقط روی گوشی آماده می‌مانند.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {DOC_KINDS.map(([kind, label]) => {
          const file = selected[kind];
          const done = completed.has(kind);
          return (
            <div
              key={kind}
              className={`relative flex min-h-24 items-center gap-2 rounded-2xl border-2 p-3 text-sm ${file ? "border-primary bg-primary/10" : done ? "border-primary/50 bg-primary/5" : "border-dashed border-border"}`}
            >
              {file || done ? <Check className="size-4 shrink-0 text-primary" /> : <Camera className="size-4 shrink-0" />}
              <label className="min-w-0 flex-1 cursor-pointer">
                <span className="block font-semibold">{label}</span>
                <span className="mt-1 block truncate text-xs text-muted-foreground">
                  {file ? "آماده ارسال" : done ? "قبلاً ارسال شده" : "دوربین یا گالری"}
                </span>
                {file && <span className="block truncate text-[11px] text-muted-foreground">{file.name}</span>}
                <input
                  type="file"
                  accept="image/*"
                  aria-label={`انتخاب عکس ${label} از دوربین یا گالری`}
                  className="sr-only"
                  disabled={sending}
                  onChange={(event) => {
                    choose(kind, event.target.files?.[0]);
                    event.currentTarget.value = "";
                  }}
                />
              </label>
              <ImagePlus className="size-4 shrink-0 text-muted-foreground" />
              {file && (
                <button
                  type="button"
                  aria-label={`حذف عکس انتخاب‌شده ${label}`}
                  className="absolute left-1 top-1 rounded-full bg-background p-1"
                  disabled={sending}
                  onClick={() => setSelected((current) => {
                    const next = { ...current };
                    delete next[kind];
                    return next;
                  })}
                >
                  <X className="size-3" />
                </button>
              )}
            </div>
          );
        })}
      </div>
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>{readyCount.toLocaleString("fa-IR")} از ۶ مدرک آماده است · {selectedCount.toLocaleString("fa-IR")} عکس جدید برای ارسال</span>
        {docs.isFetching && <span>در حال بررسی مدارک قبلی…</span>}
      </div>
      <Btn
        type="button"
        className="w-full"
        disabled={!allReady || !selectedCount || sending || docs.isLoading}
        onClick={() => void submitAll()}
      >
        <Send className="size-4" />
        {sending ? "در حال ارسال همه مدارک…" : "ارسال یکجای مدارک برای تأیید مدیر"}
      </Btn>
      {allReady && !selectedCount && (
        <p className="text-xs text-primary">هر شش مدرک قبلاً ارسال شده‌اند. برای جایگزینی هرکدام، عکس جدید انتخاب کنید.</p>
      )}
    </div>
  );
}
