import { forwardRef, useRef, useState } from "react";
import { animate, motion, useMotionValue, useMotionValueEvent, useTransform } from "motion/react";
import { actions, STATUS_LABEL, useStore, type Status, type Task } from "./store";

const THRESHOLD = 92;
const FLING = 500;

const NEXT: Record<Status, Status | null> = { todo: "doing", doing: "done", done: null };
const PREV: Record<Status, Status | "delete"> = { todo: "delete", doing: "todo", done: "doing" };

// 退場方向をカードごとに保持（AnimatePresence の exit で参照）
const exitDir = new Map<string, number>();

type Props = {
  task: Task;
  index: number;
  onMove: (t: Task, to: Status) => void;
  onRemove: (t: Task) => void;
};

export const TaskCard = forwardRef<HTMLLIElement, Props>(function TaskCard({ task, index, onMove, onRemove }, ref) {
  const x = useMotionValue(0);
  const authed = useStore((s) => s.auth.state === "user");
  const [editing, setEditing] = useState(false);
  const [armed, setArmed] = useState<0 | 1 | -1>(0);
  const dragging = useRef(false);
  const next = NEXT[task.status];
  const prev = PREV[task.status];

  useMotionValueEvent(x, "change", (v) => {
    const a = v > THRESHOLD && next ? 1 : v < -THRESHOLD ? -1 : 0;
    if (a !== armed) {
      if (a !== 0) navigator.vibrate?.(6);
      setArmed(a);
    }
  });

  const rightOpacity = useTransform(x, [0, 24, THRESHOLD], [0, 0.5, 1]);
  const leftOpacity = useTransform(x, [-THRESHOLD, -24, 0], [1, 0.5, 0]);
  const rotate = useTransform(x, [-240, 0, 240], [-3, 0, 3]);
  const iconScaleR = useTransform(x, [0, THRESHOLD, THRESHOLD + 40], [0.6, 1, 1.15]);
  const iconScaleL = useTransform(x, [-THRESHOLD - 40, -THRESHOLD, 0], [1.15, 1, 0.6]);

  const commit = (dir: 1 | -1) => {
    exitDir.set(task.id, dir);
    if (dir === 1 && next) onMove(task, next);
    else if (dir === -1) prev === "delete" ? onRemove(task) : onMove(task, prev);
  };

  const prevKind = prev === "delete" ? "delete" : prev;

  return (
    <motion.li
      ref={ref}
      layout
      className="card-wrap"
      data-testid="task"
      data-id={task.id}
      custom={task.id}
      initial={{ opacity: 0, y: -24, scale: 0.92, filter: "blur(6px)" }}
      animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)", transition: { type: "spring", stiffness: 420, damping: 32, delay: Math.min(index, 8) * 0.025 } }}
      exit="exit"
      variants={{
        exit: (id: string) => {
          const d = exitDir.get(id) ?? 0;
          return d
            ? { x: d * (window.innerWidth + 80), opacity: 0, rotate: d * 8, transition: { duration: 0.32, ease: [0.4, 0, 0.6, 1] } }
            : { opacity: 0, scale: 0.9, transition: { duration: 0.18 } };
        },
      }}
    >
      {/* スワイプで現れる下地 */}
      <motion.div className={`reveal reveal-right to-${next ?? "none"}`} style={{ opacity: rightOpacity }} aria-hidden>
        <motion.span className="reveal-icon" style={{ scale: iconScaleR }}>
          {next === "done" ? <IconCheck /> : <IconPlay />}
        </motion.span>
        <span className="reveal-label">{next ? STATUS_LABEL[next] : ""}</span>
      </motion.div>
      <motion.div className={`reveal reveal-left to-${prevKind}`} style={{ opacity: leftOpacity }} aria-hidden>
        <span className="reveal-label">{prev === "delete" ? "削除" : STATUS_LABEL[prev]}</span>
        <motion.span className="reveal-icon" style={{ scale: iconScaleL }}>
          {prev === "delete" ? <IconTrash /> : <IconBack />}
        </motion.span>
      </motion.div>

      <motion.div
        className={`card glass ${armed ? "is-armed" : ""} status-${task.status}`}
        style={{ x, rotate }}
        drag={editing ? false : "x"}
        dragDirectionLock
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={{ left: 0.85, right: next ? 0.85 : 0.12 }}
        dragTransition={{ bounceStiffness: 600, bounceDamping: 32 }}
        onDragStart={() => (dragging.current = true)}
        onDragEnd={(_, info) => {
          setTimeout(() => (dragging.current = false), 0);
          const dx = info.offset.x;
          const vx = info.velocity.x;
          if ((dx > THRESHOLD || (vx > FLING && dx > 24)) && next) commit(1);
          else if (dx < -THRESHOLD || (vx < -FLING && dx < -24)) commit(-1);
          else animate(x, 0, { type: "spring", stiffness: 600, damping: 34 });
        }}
        whileTap={editing ? undefined : { scale: 0.985 }}
        onTap={() => {
          if (!dragging.current && !editing) setEditing(true);
        }}
      >
        <span className={`dot dot-${task.status}`} aria-hidden />
        {editing ? (
          <EditField
            initial={task.title}
            onDone={(v) => {
              if (v !== null && v.trim() && v.trim() !== task.title) actions.rename(task.id, v);
              setEditing(false);
            }}
          />
        ) : (
          <span className="card-title" data-testid="task-title">
            {task.title}
          </span>
        )}
        {authed && task.dirty && <span className="pending" aria-label="未同期" data-testid="pending" />}
      </motion.div>
    </motion.li>
  );
});

function EditField({ initial, onDone }: { initial: string; onDone: (v: string | null) => void }) {
  const [v, setV] = useState(initial);
  return (
    <textarea
      className="edit"
      data-testid="edit"
      autoFocus
      rows={1}
      value={v}
      enterKeyHint="done"
      onFocus={(e) => {
        const el = e.currentTarget;
        el.setSelectionRange(el.value.length, el.value.length);
        el.style.height = el.scrollHeight + "px";
      }}
      onChange={(e) => {
        setV(e.target.value);
        e.target.style.height = "auto";
        e.target.style.height = e.target.scrollHeight + "px";
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
          e.preventDefault();
          onDone(v);
        } else if (e.key === "Escape") onDone(null);
      }}
      onBlur={() => onDone(v)}
    />
  );
}

const svg = { width: 22, height: 22, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2.4, strokeLinecap: "round", strokeLinejoin: "round" } as const;
const IconCheck = () => (<svg {...svg}><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>);
const IconPlay = () => (<svg {...svg}><path d="M8 5.5v13l10-6.5z" fill="currentColor" /></svg>);
const IconBack = () => (<svg {...svg}><path d="M10 6l-6 6 6 6M4 12h16" /></svg>);
const IconTrash = () => (<svg {...svg}><path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13" /></svg>);
