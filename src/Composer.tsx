import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useAnimate } from "motion/react";
import { aiSplit, useStore } from "./store";

export function Composer({ onCreate }: { onCreate: (titles: string[]) => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [scope, animateEl] = useAnimate<HTMLFormElement>();
  const shake = () => animateEl(scope.current, { x: [0, -9, 9, -5, 5, 0] }, { duration: 0.42 });
  const ref = useRef<HTMLTextAreaElement>(null);
  const authed = useStore((s) => s.auth.state === "user");
  const has = text.trim().length > 0;

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
      className={`composer glass ${busy ? "is-busy" : ""}`}
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
      <textarea
        ref={ref}
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
        {authed && has && (
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
      <motion.button
        type="submit"
        className="icon-btn send-btn"
        data-testid="send"
        aria-label="追加"
        disabled={!has || busy}
        animate={{ scale: has ? 1 : 0.82, opacity: has ? 1 : 0.35 }}
        whileTap={{ scale: 0.8 }}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 19V5M5.5 11.5L12 5l6.5 6.5" />
        </svg>
      </motion.button>
    </motion.form>
  );
}
