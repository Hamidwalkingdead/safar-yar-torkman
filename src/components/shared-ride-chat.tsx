import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Mic, Square, Send, Play, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

type Message = { id: string; ride_id: string; sender_id: string; body: string | null; audio_path: string | null; created_at: string };

export function SharedRideChat({ rideId, userId, enabled, canSend = true }: {
  rideId: string; userId: string; enabled: boolean; canSend?: boolean;
}) {
  const [body, setBody] = useState("");
  const [recording, setRecording] = useState(false);
  const [sending, setSending] = useState(false);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const cache = useQueryClient();
  const queryKey = ["shared-ride-messages", rideId];
  const messages = useQuery({
    queryKey,
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.from("shared_ride_messages").select("*").eq("ride_id", rideId).order("created_at");
      if (error) throw error;
      return (data ?? []) as Message[];
    },
    refetchInterval: 3000,
  });
  useEffect(() => {
    if (!enabled) return;
    const channel = supabase.channel("shared-ride-chat-" + rideId)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "shared_ride_messages", filter: "ride_id=eq." + rideId }, () => {
        void cache.invalidateQueries({ queryKey });
      }).subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [enabled, rideId, cache]);
  async function sendText() {
    const value = body.trim();
    if (!value || sending || !canSend) return;
    setSending(true);
    const { error } = await supabase.rpc("send_shared_ride_message", { p_ride: rideId, p_body: value });
    setSending(false);
    if (error) return void toast.error(error.message || "ارسال پیام انجام نشد.");
    setBody("");
    await cache.invalidateQueries({ queryKey });
  }
  async function startRecording() {
    if (!canSend) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") return void toast.error("ضبط صدا در این مرورگر پشتیبانی نمی‌شود.");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"].find((x) => MediaRecorder.isTypeSupported(x));
      const media = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunks.current = [];
      media.ondataavailable = (event) => { if (event.data.size) chunks.current.push(event.data); };
      media.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        const blob = new Blob(chunks.current, { type: media.mimeType || "audio/webm" });
        if (!blob.size) return;
        setSending(true);
        const ext = blob.type.includes("mp4") ? "mp4" : blob.type.includes("ogg") ? "ogg" : "webm";
        const path = rideId + "/" + userId + "/" + crypto.randomUUID() + "." + ext;
        const upload = await supabase.storage.from("shared-ride-voice").upload(path, blob, { contentType: blob.type, upsert: false });
        if (upload.error) { setSending(false); return void toast.error("بارگذاری پیام صوتی انجام نشد."); }
        const insert = await supabase.rpc("send_shared_ride_voice", { p_ride: rideId, p_audio_path: path });
        setSending(false);
        if (insert.error) { await supabase.storage.from("shared-ride-voice").remove([path]); return void toast.error(insert.error.message || "ثبت پیام صوتی انجام نشد."); }
        await cache.invalidateQueries({ queryKey });
      };
      recorder.current = media;
      media.start();
      setRecording(true);
    } catch { toast.error("دسترسی میکروفون داده نشد."); }
  }
  function stopRecording() {
    if (recorder.current?.state === "recording") recorder.current.stop();
    setRecording(false);
  }
  async function playVoice(path: string) {
    const { data, error } = await supabase.storage.from("shared-ride-voice").createSignedUrl(path, 3600);
    if (error || !data?.signedUrl) return void toast.error("دریافت پیام صوتی ممکن نشد.");
    const audio = new Audio(data.signedUrl);
    void audio.play().catch(() => toast.error("پخش صدا ممکن نشد."));
  }
  if (!enabled) return null;
  return <section className="space-y-3 rounded-2xl border border-border p-4">
    <h3 className="font-bold">گفت‌وگوی گروه سفر اشتراکی</h3>
    <div className="max-h-72 space-y-2 overflow-y-auto">
      {messages.data?.map((message) => <div key={message.id} className={message.sender_id === userId ? "mr-8 rounded-2xl bg-primary/10 p-3" : "ml-8 rounded-2xl bg-muted p-3"}>
        <p className="mb-1 text-xs text-muted-foreground">{message.sender_id === userId ? "شما" : "عضو گروه"} · {new Date(message.created_at).toLocaleTimeString("fa-IR", { hour: "2-digit", minute: "2-digit" })}</p>
        {message.body && <p className="whitespace-pre-wrap break-words">{message.body}</p>}
        {message.audio_path && <button type="button" onClick={() => void playVoice(message.audio_path!)} className="flex items-center gap-2 text-primary"><Play className="size-5" /> پخش پیام صوتی</button>}
      </div>)}
      {!messages.data?.length && <p className="text-sm text-muted-foreground">هنوز پیامی در گروه ثبت نشده است.</p>}
      {messages.error && <p className="text-sm text-destructive">دریافت پیام‌ها ممکن نشد.</p>}
    </div>
    <div className="flex gap-2">
      <input disabled={!canSend || sending} value={body} onChange={(e) => setBody(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void sendText(); }} maxLength={4000} placeholder="پیام برای اعضای گروه…" className="min-w-0 flex-1 rounded-xl bg-muted px-3 py-3" />
      <button type="button" disabled={!canSend || !body.trim() || sending} onClick={() => void sendText()} aria-label="ارسال پیام" className="rounded-xl bg-primary px-3 text-primary-foreground"><Send className="size-5" /></button>
      <button type="button" disabled={!canSend || sending} onClick={() => recording ? stopRecording() : void startRecording()} aria-label={recording ? "پایان ضبط" : "ضبط پیام صوتی"} className={recording ? "rounded-xl bg-destructive px-3 text-white" : "rounded-xl bg-muted px-3"}>{sending ? <Loader2 className="size-5 animate-spin" /> : recording ? <Square className="size-5" /> : <Mic className="size-5" />}</button>
    </div>
    <p className="text-xs text-muted-foreground">{!canSend ? "این گروه بسته شده؛ فقط تاریخچه گفتگو قابل مشاهده است." : recording ? "در حال ضبط… برای ارسال، دکمه توقف را بزنید." : "پیام متنی و صوتی برای همه اعضای گروه قابل مشاهده است."}</p>
  </section>;
}
