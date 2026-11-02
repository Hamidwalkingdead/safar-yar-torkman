import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Mic, Square, Send, Play, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

type Message = { id: string; trip_id: string; sender_id: string; body: string | null; audio_path: string | null; created_at: string };
export function TripChat({ tripId, userId, enabled }: { tripId: string; userId: string; enabled: boolean }) {
  const [body, setBody] = useState("");
  const [recording, setRecording] = useState(false);
  const [sending, setSending] = useState(false);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const queryClient = useQueryClient();
  const queryKey = ["trip-messages", tripId];
  const messages = useQuery({
    queryKey,
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.from("trip_messages").select("*").eq("trip_id", tripId).order("created_at");
      if (error) throw error;
      return (data ?? []) as Message[];
    },
    refetchInterval: 3000,
  });
  useEffect(() => {
    if (!enabled) return;
    const channel = supabase.channel("trip-chat-" + tripId)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "trip_messages", filter: "trip_id=eq." + tripId }, () => {
        void queryClient.invalidateQueries({ queryKey });
      }).subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [enabled, tripId, queryClient]);
  async function sendText() {
    const value = body.trim();
    if (!value || sending) return;
    setSending(true);
    const { error } = await supabase.from("trip_messages").insert({ trip_id: tripId, sender_id: userId, body: value });
    setSending(false);
    if (error) return toast.error("ارسال پیام انجام نشد.");
    setBody("");
    await queryClient.invalidateQueries({ queryKey });
  }
  async function startRecording() {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") return toast.error("ضبط صدا در این مرورگر پشتیبانی نمی‌شود.");
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
        const path = tripId + "/" + userId + "/" + crypto.randomUUID() + "." + ext;
        const upload = await supabase.storage.from("trip-voice").upload(path, blob, { contentType: blob.type, upsert: false });
        if (upload.error) { setSending(false); return toast.error("بارگذاری پیام صوتی انجام نشد."); }
        const insert = await supabase.from("trip_messages").insert({ trip_id: tripId, sender_id: userId, audio_path: path });
        setSending(false);
        if (insert.error) { await supabase.storage.from("trip-voice").remove([path]); return toast.error("ثبت پیام صوتی انجام نشد."); }
        await queryClient.invalidateQueries({ queryKey });
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
    const { data, error } = await supabase.storage.from("trip-voice").createSignedUrl(path, 3600);
    if (error || !data?.signedUrl) return toast.error("دریافت پیام صوتی ممکن نشد.");
    const audio = new Audio(data.signedUrl);
    void audio.play().catch(() => toast.error("پخش صدا ممکن نشد."));
  }
  if (!enabled) return null;
  return <section className="space-y-3 rounded-2xl border border-border p-4">
    <h2 className="font-bold">گفت‌وگوی راننده و مسافر</h2>
    <div className="max-h-80 space-y-2 overflow-y-auto">
      {messages.data?.map((m) => <div key={m.id} className={m.sender_id === userId ? "mr-8 rounded-2xl bg-primary/10 p-3" : "ml-8 rounded-2xl bg-muted p-3"}>
        <p className="mb-1 text-xs text-muted-foreground">{m.sender_id === userId ? "شما" : "طرف مقابل"} · {new Date(m.created_at).toLocaleTimeString("fa-IR", { hour: "2-digit", minute: "2-digit" })}</p>
        {m.body && <p className="whitespace-pre-wrap break-words">{m.body}</p>}
        {m.audio_path && <button type="button" onClick={() => void playVoice(m.audio_path!)} className="flex items-center gap-2 text-primary"><Play className="size-5" /> پخش پیام صوتی</button>}
      </div>)}
      {!messages.data?.length && <p className="text-sm text-muted-foreground">هنوز پیامی ارسال نشده است.</p>}
      {messages.error && <p className="text-sm text-destructive">دریافت پیام‌ها ممکن نشد.</p>}
    </div>
    <div className="flex gap-2">
      <input value={body} onChange={(e) => setBody(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void sendText(); }} maxLength={4000} placeholder="پیام بنویسید…" className="min-w-0 flex-1 rounded-xl bg-muted px-3 py-3" />
      <button type="button" disabled={!body.trim() || sending} onClick={() => void sendText()} aria-label="ارسال پیام" className="rounded-xl bg-primary px-3 text-primary-foreground"><Send className="size-5" /></button>
      <button type="button" disabled={sending} onClick={() => recording ? stopRecording() : void startRecording()} aria-label={recording ? "پایان ضبط" : "ضبط پیام صوتی"} className={recording ? "rounded-xl bg-destructive px-3 text-white" : "rounded-xl bg-muted px-3"}>{sending ? <Loader2 className="size-5 animate-spin" /> : recording ? <Square className="size-5" /> : <Mic className="size-5" />}</button>
    </div>
    <p className="text-xs text-muted-foreground">{recording ? "در حال ضبط… برای ارسال، دکمه توقف را بزنید." : "برای پیام صوتی، میکروفون را بزنید و پس از ضبط، توقف کنید."}</p>
  </section>;
}
