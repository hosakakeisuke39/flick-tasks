import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useAnimate } from "motion/react";
import { aiSplit, useStore } from "./store";
import { MAX_SECONDS, sendVoice, useRecorder, voiceSupported } from "./voice";

export function Composer({ onCreate }: { onCreate: (titles: string[]) => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [scope, animateEl] = useAnimate<HTMLFormElement>();
  const shake = () => animateEl(scope.current, { x: [0, -9, 9, -5, 5, 0] }, { duration: 0.42 });
  const ref = useRef<HTMLTextAreaElement>(null);
  const authed = useStore((s) => s.auth.state === "user");
  const has = text.trim().length > 0;
  const canVoice = authed && voiceSupported();

  const onAudio = useCallback(
    async (blob: Blob) => {
      setBusy(true);
      try {
        const { tasks } = await sendVoice(blob);
        if (tasks.length) {
          onCreate(tasks);
          navigator.vibrate?.(14);
        } else shake();
      } catch {
        shake();
      } finally {
        setBusy(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onCreate]
  );
  const recorder = useRecorder(onAudio);
  const recording = recorder.state === "recording";

  const startVoice = async () => {
    try {
      await recorder.start();
      navigator.vibrate?.(10);
    } catch {
      shake(); // マイク拒否など
    }
  };

  // 開いた瞬間・アプリに戻った瞬間に入力できる状態へ
  useEffect(() => {
    const focus = () => {
      if (document.visibilityState === "visible" && !document.querySelector("textarea.edit")) ref.current?.focus({ preventScroll: true });
    };
    focus();
    document.addEventListener("visibilitychange", focus);
    window.addEventListener("pageshow", focus);
    return () => {
      document.removeEventListener("visibilitychange", focus);
      window.removeEventListener("pageshow", focus);
    };
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  }, [text]);

  const submit = () => {
    if (!has) return;
    onCreate([text]);
    setText("");
    ref.current?.focus();
  };

  const runAI = async () => {
    if (!has || busy) return;
    setBusy(true);
    try {
      const titles = await aiSplit(text);
      if (titles.length) {
        onCreate(titles);
        setText("");
      } else shake();
    } catch {
      shake();
    } finally {
      setBusy(false);
      ref.current?.focus();
    }
  };

  return (
    <motion.form
      className={`composer glass ${busy ? "is-busy" : ""} ${recording ? "is-recording" : ""}`}
      data-testid="composer"
      initial={{ y: 40, opacity: 0, scale: 0.96 }}
      ref={scope}
      animate={{ y: 0, opacity: 1, scale: 1 }}
      transition={{ type: "spring", stiffness: 380, damping: 30 }}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <AnimatePresence initial={false}>
        {recording && (
          <motion.div
            key="rec"
            className="rec"
            data-testid="recording"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.15 } }}
          >
            <motion.button
              type="button"
              className="icon-btn rec-cancel"
              data-testid="voice-cancel"
              aria-label="録音をやめる"
              whileTap={{ scale: 0.85 }}
              onClick={() => recorder.stop(true)}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </motion.button>
            <div className="wave" aria-hidden>
              {recorder.levels.map((l, i) => (
                <motion.span key={i} className="wave-bar" animate={{ scaleY: 0.12 + l * 0.88 }} transition={{ type: "spring", stiffness: 700, damping: 30 }} />
              ))}
            </div>
            <span className="rec-time" data-testid="rec-time">
              {Math.floor(recorder.elapsed / 60)}:{String(Math.floor(recorder.elapsed % 60)).padStart(2, "0")}
            </span>
            <motion.span
              className="rec-progress"
              style={{ scaleX: recorder.elapsed / MAX_SECONDS }}
              aria-hidden
            />
          </motion.div>
        )}
      </AnimatePresence>
      <textarea
        ref={ref}
        hidden={recording}
        className="composer-input"
        data-testid="memo"
        aria-label="メモ"
        rows={1}
        autoFocus
        enterKeyHint="send"
        value={text}
        disabled={busy}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          }
        }}
      />
      <AnimatePresence initial={false}>
        {authed && has && !recording && (
          <motion.button
            type="button"
            key="ai"
            className="icon-btn ai-btn"
            data-testid="ai"
            aria-label="AIでタスクに分解"
            onClick={runAI}
            initial={{ scale: 0, opacity: 0, rotate: -90 }}
            animate={{ scale: 1, opacity: 1, rotate: 0 }}
            exit={{ scale: 0, opacity: 0, rotate: 90 }}
            whileTap={{ scale: 0.85 }}
          >
            <motion.svg
              width="20" height="20" viewBox="0 0 24 24" fill="currentColor"
              animate={busy ? { rotate: 360 } : { rotate: 0 }}
              transition={busy ? { repeat: Infinity, duration: 1.1, ease: "linear" } : {}}
            >
              <path d="M12 2l1.8 5.4L19 9l-5.2 1.6L12 16l-1.8-5.4L5 9l5.2-1.6z" />
              <path d="M19 14l.9 2.3 2.1.7-2.1.7L19 20l-.9-2.3-2.1-.7 2.1-.7z" opacity=".7" />
            </motion.svg>
          </motion.button>
        )}
      </AnimatePresence>
      <AnimatePresence initial={false} mode="popLayout">
        {recording ? (
          <motion.button
            type="button"
            key="stop"
            className="icon-btn stop-btn"
            data-testid="voice-stop"
            aria-label="録音を終えてタスクにする"
            onClick={() => recorder.stop()}
            initial={{ scale: 0.4, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.4, opacity: 0 }}
            whileTap={{ scale: 0.82 }}
          >
            <span className="stop-ring" aria-hidden />
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="5" width="14" height="14" rx="3.5" /></svg>
          </motion.button>
        ) : canVoice && !has ? (
          <motion.button
            type="button"
            key="mic"
            className="icon-btn mic-btn"
            data-testid="voice"
            aria-label="音声でタスクを追加"
            disabled={busy}
            onClick={startVoice}
            initial={{ scale: 0.4, opacity: 0, rotate: -30 }}
            animate={{ scale: 1, opacity: 1, rotate: 0 }}
            exit={{ scale: 0.4, opacity: 0, rotate: 30 }}
            whileTap={{ scale: 0.82 }}
          >
            {busy ? (
              <motion.svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 0.9, ease: "linear" }}>
                <path d="M12 3a9 9 0 1 1-9 9" />
              </motion.svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor" />
                <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
              </svg>
            )}
          </motion.button>
        ) : (
          <motion.button
            type="submit"
            key="send"
            className="icon-btn send-btn"
            data-testid="send"
            aria-label="追加"
            disabled={!has || busy}
            initial={{ scale: 0.4, opacity: 0 }}
            animate={{ scale: has ? 1 : 0.82, opacity: has ? 1 : 0.35 }}
            exit={{ scale: 0.4, opacity: 0 }}
            whileTap={{ scale: 0.8 }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 19V5M5.5 11.5L12 5l6.5 6.5" />
            </svg>
          </motion.button>
        )}
      </AnimatePresence>
    </motion.form>
  );
}
