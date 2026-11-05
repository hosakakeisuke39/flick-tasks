import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, LayoutGroup, motion, MotionConfig } from "motion/react";
import { actions, boot, STATUSES, STATUS_LABEL, useStore, visibleTasks, type Status, type Task } from "./store";
import { TaskCard } from "./TaskCard";
import { Composer } from "./Composer";
import { Skeleton } from "./Skeleton";
import { Toast, type ToastData } from "./Toast";
import { Backdrop } from "./Backdrop";
import { Account } from "./Account";

const spring = { type: "spring", stiffness: 520, damping: 40, mass: 0.8 } as const;

export function App() {
  const tasks = useStore((s) => s.tasks);
  const booting = useStore((s) => s.booting);
  const [tab, setTab] = useState<Status>("todo");
  const [toast, setToast] = useState<ToastData | null>(null);
  const [bump, setBump] = useState<Status | null>(null);
  const prevTab = useRef<Status>("todo");

  useEffect(() => {
    boot();
  }, []);

  const counts = useMemo(() => {
    const c: Record<Status, number> = { todo: 0, doing: 0, done: 0 };
    for (const t of tasks) if (!t.deleted) c[t.status]++;
    return c;
  }, [tasks]);
  const list = useMemo(() => visibleTasks(tasks, tab), [tasks, tab]);

  const direction = STATUSES.indexOf(tab) - STATUSES.indexOf(prevTab.current);
  const switchTab = (s: Status) => {
    prevTab.current = tab;
    setTab(s);
  };

  const move = (task: Task, to: Status) => {
    actions.setStatus(task.id, to);
    setBump(to);
    setTimeout(() => setBump(null), 450);
    navigator.vibrate?.(12);
    setToast({ id: Date.now(), text: `${STATUS_LABEL[to]}へ`, undo: () => actions.restore(task) });
  };
  const remove = (task: Task) => {
    actions.remove(task.id);
    navigator.vibrate?.([8, 40, 8]);
    setToast({ id: Date.now(), text: "削除", undo: () => actions.restore(task) });
  };
  const onCreate = (titles: string[]) => {
    actions.add(titles);
    if (tab !== "todo") switchTab("todo");
  };

  return (
    <MotionConfig reducedMotion="user" transition={spring}>
      <Backdrop />
      <div className="app">
        <AnimatePresence mode="popLayout" initial={false}>
          {booting ? (
            <Skeleton key="skeleton" />
          ) : (
            <motion.div
              key="content"
              className="content"
              initial={{ opacity: 0, filter: "blur(8px)" }}
              animate={{ opacity: 1, filter: "blur(0px)" }}
              transition={{ duration: 0.45, ease: [0.2, 0.8, 0.2, 1] }}
            >
              <header className="topbar">
                <LayoutGroup id="tabs">
                  <nav className="tabs glass" role="tablist" aria-label="ステータス">
                    {STATUSES.map((s) => (
                      <button
                        key={s}
                        role="tab"
                        aria-selected={tab === s}
                        data-status={s}
                        className={`tab ${tab === s ? "is-active" : ""}`}
                        onClick={() => switchTab(s)}
                      >
                        {tab === s && <motion.span layoutId="tab-pill" className="tab-pill" />}
                        <span className="tab-label">{STATUS_LABEL[s]}</span>
                        <motion.span
                          key={`${s}-${counts[s]}`}
                          className={`tab-count ${bump === s ? "is-bump" : ""}`}
                          data-testid={`count-${s}`}
                          initial={{ y: -8, opacity: 0, scale: 0.6 }}
                          animate={{ y: 0, opacity: 1, scale: bump === s ? [1, 1.45, 1] : 1 }}
                        >
                          {counts[s]}
                        </motion.span>
                      </button>
                    ))}
                  </nav>
                </LayoutGroup>
                <Account />
              </header>

              <AnimatePresence mode="popLayout" initial={false} custom={direction}>
                <motion.ul
                  key={tab}
                  className="list"
                  data-testid="list"
                  data-tab={tab}
                  custom={direction}
                  variants={{
                    enter: (d: number) => ({ x: d * 60, opacity: 0 }),
                    center: { x: 0, opacity: 1 },
                    exit: (d: number) => ({ x: d * -60, opacity: 0 }),
                  }}
                  initial="enter"
                  animate="center"
                  exit="exit"
                >
                  <AnimatePresence mode="popLayout" initial={false}>
                    {list.map((t, i) => (
                      <TaskCard key={t.id} task={t} index={i} onMove={move} onRemove={remove} />
                    ))}
                  </AnimatePresence>
                  <AnimatePresence>
                    {list.length === 0 && (
                      <motion.li
                        key="empty"
                        className="empty"
                        data-testid="empty"
                        aria-hidden
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.8, transition: { duration: 0.15 } }}
                      >
                        <span className="empty-orb glass" />
                      </motion.li>
                    )}
                  </AnimatePresence>
                </motion.ul>
              </AnimatePresence>
            </motion.div>
          )}
        </AnimatePresence>

        <Composer onCreate={onCreate} />
        <Toast data={toast} onDone={() => setToast(null)} />
      </div>
    </MotionConfig>
  );
}
