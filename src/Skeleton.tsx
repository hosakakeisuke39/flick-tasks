import { motion } from "motion/react";

const widths = [78, 62, 88, 54, 70, 46];

export function Skeleton() {
  return (
    <motion.div
      className="content skeleton"
      data-testid="skeleton"
      aria-busy="true"
      aria-label="読み込み中"
      exit={{ opacity: 0, filter: "blur(6px)", transition: { duration: 0.3 } }}
    >
      <header className="topbar">
        <div className="tabs glass">
          {[0, 1, 2].map((i) => (
            <span key={i} className="sk sk-tab" />
          ))}
        </div>
        <span className="sk sk-avatar glass" />
      </header>
      <ul className="list">
        {widths.map((w, i) => (
          <motion.li
            key={i}
            className="card-wrap"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05, type: "spring", stiffness: 300, damping: 30 }}
          >
            <div className="card glass">
              <span className="sk sk-dot" />
              <span className="sk sk-line" style={{ width: `${w}%` }} />
            </div>
          </motion.li>
        ))}
      </ul>
    </motion.div>
  );
}
