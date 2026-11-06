import { useCallback, useEffect, useRef, useState } from "react";

export const MAX_SECONDS = 60;
const BARS = 24;

function pickMime() {
  // iPhone(Safari) は audio/mp4、Android/PC の Chrome は audio/webm
  const cands = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/aac", "audio/ogg;codecs=opus"];
  try {
    for (const m of cands) if (MediaRecorder.isTypeSupported?.(m)) return m;
  } catch {
    /* 古い Safari は isTypeSupported が無い */
  }
  return "";
}

export function voiceSupported() {
  return typeof window !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined";
}

/** 失敗理由を利用者に伝わる日本語にする */
export function voiceErrorMessage(e: unknown): string {
  const name = (e as { name?: string })?.name ?? "";
  const msg = (e as { message?: string })?.message ?? "";
  if (!window.isSecureContext) return "録音は https でのみ使えます";
  switch (name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
      return "マイクが許可されていません。ブラウザの設定でこのサイトのマイクを許可してください";
    case "NotFoundError":
    case "DevicesNotFoundError":
      return "マイクが見つかりません";
    case "NotReadableError":
    case "TrackStartError":
      return "マイクを他のアプリが使用中です";
    case "SecurityError":
      return "このブラウザでは録音が制限されています。Safari や Chrome で開いてください";
    case "NotSupportedError":
      return "このブラウザは録音に対応していません";
    case "VoiceServerError":
      return `書き起こしに失敗しました（${msg}）`;
    case "VoiceEmpty":
      return "声を聞き取れませんでした。もう一度話してください";
  }
  return `録音を開始できませんでした（${name || msg || "不明なエラー"}）`;
}

async function getMic(): Promise<MediaStream> {
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  } catch (e) {
    // 制約が合わない端末では最小構成で再試行（許可拒否はそのまま投げる）
    const n = (e as { name?: string })?.name;
    if (n === "NotAllowedError" || n === "PermissionDeniedError") throw e;
    return navigator.mediaDevices.getUserMedia({ audio: true });
  }
}

function makeRecorder(stream: MediaStream) {
  const mime = pickMime();
  if (mime) {
    try {
      return new MediaRecorder(stream, { mimeType: mime });
    } catch {
      /* fall through */
    }
  }
  return new MediaRecorder(stream);
}

/** マイク録音。levels は波形アニメ用の 0..1 の音量 */
export function useRecorder(onDone: (blob: Blob) => void, onError: (e: unknown) => void) {
  const [state, setState] = useState<"idle" | "starting" | "recording">("idle");
  const [elapsed, setElapsed] = useState(0);
  const [levels, setLevels] = useState<number[]>(() => Array(BARS).fill(0));
  const rec = useRef<MediaRecorder | null>(null);
  const cancelled = useRef(false);

  const stop = useCallback((cancel = false) => {
    cancelled.current = cancel;
    if (rec.current && rec.current.state !== "inactive") rec.current.stop();
  }, []);

  const start = useCallback(async () => {
    if (rec.current) return;
    setState("starting");
    let stream: MediaStream;
    let mr: MediaRecorder;
    try {
      stream = await getMic();
      mr = makeRecorder(stream);
    } catch (e) {
      setState("idle");
      throw e;
    }

    const chunks: BlobPart[] = [];
    mr.ondataavailable = (e) => e.data.size && chunks.push(e.data);

    // 音量メーター（失敗しても録音自体は続ける）
    let raf = 0;
    let ctx: AudioContext | null = null;
    const t0 = performance.now();
    let read: (() => number) | null = null;
    try {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      ctx = new Ctx();
      void ctx.resume?.();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 64;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      read = () => {
        analyser.getByteFrequencyData(data);
        return Math.min(1, (data.reduce((a, b) => a + b, 0) / data.length / 255) * 2.2);
      };
    } catch {
      read = null;
    }
    const tick = () => {
      const sec = (performance.now() - t0) / 1000;
      const level = read ? read() : 0.25 + 0.2 * Math.sin(sec * 9);
      setLevels((prev) => [...prev.slice(1), level]);
      setElapsed(sec);
      if (sec >= MAX_SECONDS) stop();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    const release = () => {
      cancelAnimationFrame(raf);
      stream.getTracks().forEach((t) => t.stop());
      ctx?.close().catch(() => {});
    };
    mr.onerror = (e) => {
      cancelled.current = true;
      onError((e as unknown as { error?: unknown }).error ?? e);
    };
    mr.onstop = () => {
      release();
      rec.current = null;
      setState("idle");
      setElapsed(0);
      setLevels(Array(BARS).fill(0));
      if (!cancelled.current && chunks.length) {
        const first = chunks[0];
        const type = mr.mimeType || (first instanceof Blob ? first.type : "");
        onDone(new Blob(chunks, type ? { type } : undefined));
      }
    };
    cancelled.current = false;
    rec.current = mr;
    try {
      // Safari は timeslice 付き start で失敗する版があるので素の start も試す
      try {
        mr.start(1000);
      } catch {
        mr.start();
      }
    } catch (e) {
      release();
      rec.current = null;
      setState("idle");
      throw e;
    }
    setState("recording");
  }, [onDone, onError, stop]);

  useEffect(() => () => stop(true), [stop]);

  return { state, elapsed, levels, start, stop };
}

/**
 * 端末ごとに録音形式がバラバラ（iPhone は mp4/aac、Chrome は webm/opus）なので、
 * 送る前に 16kHz モノラル WAV に変換して Whisper が確実に読める形に揃える
 */
async function toWav16k(blob: Blob): Promise<Blob> {
  const buf = await blob.arrayBuffer();
  const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new Ctx();
  let decoded: AudioBuffer;
  try {
    decoded = await new Promise<AudioBuffer>((res, rej) => {
      // 古い Safari はコールバック版のみ
      const p = ctx.decodeAudioData(buf, res, rej) as unknown as Promise<AudioBuffer> | undefined;
      p?.then?.(res, rej);
    });
  } finally {
    ctx.close().catch(() => {});
  }
  const rate = 16000;
  const len = Math.max(1, Math.ceil(decoded.duration * rate));
  const Off = window.OfflineAudioContext || (window as unknown as { webkitOfflineAudioContext: typeof OfflineAudioContext }).webkitOfflineAudioContext;
  const off = new Off(1, len, rate);
  const src = off.createBufferSource();
  src.buffer = decoded;
  src.connect(off.destination);
  src.start();
  const out = await off.startRendering();
  const pcm = out.getChannelData(0);

  const view = new DataView(new ArrayBuffer(44 + pcm.length * 2));
  const w = (o: number, s: string) => [...s].forEach((ch, i) => view.setUint8(o + i, ch.charCodeAt(0)));
  w(0, "RIFF");
  view.setUint32(4, 36 + pcm.length * 2, true);
  w(8, "WAVE");
  w(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  w(36, "data");
  view.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) {
    const s = Math.max(-1, Math.min(1, pcm[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([view.buffer], { type: "audio/wav" });
}

export async function sendVoice(blob: Blob): Promise<{ text: string; tasks: string[] }> {
  let body = blob;
  try {
    body = await toWav16k(blob);
  } catch {
    /* 変換できない端末は元の形式のまま送る */
  }
  const type = (body.type || "audio/mp4").split(";")[0];
  const res = await fetch("/api/ai/voice", { method: "POST", headers: { "Content-Type": type }, body });
  if (!res.ok) {
    const err = new Error(String(res.status));
    err.name = "VoiceServerError";
    throw err;
  }
  return res.json();
}
