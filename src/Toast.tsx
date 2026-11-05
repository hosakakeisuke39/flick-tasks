import { useEffect } from "react";
import { AnimatePresence, motion } from "motion/react";

export type ToastData = { id: number; text: string; undo?: () => void };

export function Toast({ data, onDone }: { data: ToastData | null; onDone: () => void }) {
  useEffect(() => {
    if (!data) return;
    const t = setTimeout(onDone, 3200);
    return () => clearTimeout(t);
  }, [data, onDone]);

  return (
    <div className="toast-layer" aria-live="polite">
      <AnimatePresence mode="popLayout">
        {data && (
          <motion.div
            key={data.id}
            className="toast glass"
            data-testid="toast"
            initial={{ y: 30, opacity: 0, scale: 0.9 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 20, opacity: 0, scale: 0.92, transition: { duration: 0.2 } }}
          >
            <span>{data.text}</span>
            {data.undo && (
              <motion.button
                className="toast-undo"
                data-testid="undo"
                whileTap={{ scale: 0.9 }}
                onClick={() => {
                  data.undo?.();
                  onDone();
                }}
              >
                元に戻す
              </motion.button>
            )}
            <motion.span
              className="toast-bar"
              initial={{ scaleX: 1 }}
              animate={{ scaleX: 0 }}
              transition={{ duration: 3.2, ease: "linear" }}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
