import { useCallback, useEffect, useRef, useState } from "react";

export const MAX_SECONDS = 60;

function pickMime() {
  const cands = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
  for (const m of cands) if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported?.(m)) return m;
  return "";
}

export function voiceSupported() {
  return typeof window !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined";
}

/** マイク録音。levels は波形アニメ用の 0..1 の音量 */
export function useRecorder(onDone: (blob: Blob) => void) {
  const [state, setState] = useState<"idle" | "recording">("idle");
  const [elapsed, setElapsed] = useState(0);
  const [levels, setLevels] = useState<number[]>(() => Array(24).fill(0));
  const rec = useRef<MediaRecorder | null>(null);
  const cleanup = useRef<() => void>(() => {});
  const cancelled = useRef(false);

  const stop = useCallback((cancel = false) => {
    cancelled.current = cancel;
    if (rec.current && rec.current.state !== "inactive") rec.current.stop();
  }, []);

  const start = useCallback(async () => {
    if (rec.current?.state === "recording") return;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
    });
    const mime = pickMime();
    const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    const chunks: BlobPart[] = [];
    mr.ondataavailable = (e) => e.data.size && chunks.push(e.data);

    // 音量メーター
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 64;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);
    let raf = 0;
    const t0 = performance.now();
    const tick = () => {
      analyser.getByteFrequencyData(data);
      const avg = data.reduce((a, b) => a + b, 0) / data.length / 255;
      setLevels((prev) => [...prev.slice(1), Math.min(1, avg * 2.2)]);
      const sec = (performance.now() - t0) / 1000;
      setElapsed(sec);
      if (sec >= MAX_SECONDS) stop();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    cleanup.current = () => {
      cancelAnimationFrame(raf);
      stream.getTracks().forEach((t) => t.stop());
      ctx.close().catch(() => {});
    };
    mr.onstop = () => {
      cleanup.current();
      rec.current = null;
      setState("idle");
      setElapsed(0);
      setLevels(Array(24).fill(0));
      if (!cancelled.current && chunks.length) onDone(new Blob(chunks, { type: mr.mimeType || mime || "audio/webm" }));
    };
    cancelled.current = false;
    rec.current = mr;
    mr.start(250);
    setState("recording");
  }, [onDone, stop]);

  useEffect(() => () => stop(true), [stop]);

  return { state, elapsed, levels, start, stop };
}

export async function sendVoice(blob: Blob): Promise<{ text: string; tasks: string[] }> {
  const type = (blob.type || "audio/webm").split(";")[0];
  const res = await fetch("/api/ai/voice", { method: "POST", headers: { "Content-Type": type }, body: blob });
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
}
