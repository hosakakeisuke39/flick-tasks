import { useSyncExternalStore } from "react";

export type Status = "todo" | "doing" | "done";
export const STATUSES: Status[] = ["todo", "doing", "done"];
export const STATUS_LABEL: Record<Status, string> = { todo: "未着手", doing: "進行中", done: "完了" };

export type Task = {
  id: string;
  title: string;
  status: Status;
  position: number;
  deleted: boolean;
  created_at: number;
  updated_at: number;
  dirty?: boolean;
};
export type User = { id: string; email: string; name: string; picture: string | null };
export type Auth = { state: "loading" } | { state: "guest" } | { state: "user"; user: User };

const KEY = "flick.tasks.v1";

function load(): Task[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Task[]) : [];
  } catch {
    return [];
  }
}

type State = { tasks: Task[]; auth: Auth; booting: boolean; syncing: boolean };

let state: State = { tasks: load(), auth: { state: "loading" }, booting: true, syncing: false };
const listeners = new Set<() => void>();

function set(patch: Partial<State>) {
  state = { ...state, ...patch };
  if (patch.tasks) {
    try {
      localStorage.setItem(KEY, JSON.stringify(state.tasks));
    } catch {
      /* storage full / private mode */
    }
  }
  listeners.forEach((l) => l());
}

export function useStore<T>(sel: (s: State) => T): T {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => sel(state)
  );
}

/* ---------- mutations (local first) ---------- */

let clock = 0;
function now() {
  // 同一ミリ秒でも順序が崩れないよう単調増加
  clock = Math.max(Date.now(), clock + 1);
  return clock;
}

function mutate(id: string, fn: (t: Task) => Partial<Task>) {
  set({
    tasks: state.tasks.map((t) => (t.id === id ? { ...t, ...fn(t), updated_at: now(), dirty: true } : t)),
  });
  scheduleSync();
}

export const actions = {
  add(titles: string[], status: Status = "todo") {
    const created: Task[] = titles
      .map((s) => s.trim())
      .filter(Boolean)
      .reverse()
      .map((title) => {
        const t = now();
        return { id: crypto.randomUUID(), title, status, position: t, deleted: false, created_at: t, updated_at: t, dirty: true };
      });
    if (!created.length) return;
    set({ tasks: [...created, ...state.tasks] });
    scheduleSync();
  },
  setStatus(id: string, status: Status) {
    mutate(id, () => ({ status, position: now() }));
  },
  rename(id: string, title: string) {
    const v = title.trim();
    if (!v) return;
    mutate(id, () => ({ title: v }));
  },
  remove(id: string) {
    mutate(id, () => ({ deleted: true }));
  },
  restore(snapshot: Task) {
    // 削除後に同期が走るとローカルからも消えているので、その場合は復元して戻す
    if (!state.tasks.some((t) => t.id === snapshot.id)) {
      set({ tasks: [{ ...snapshot, deleted: false, updated_at: now(), dirty: true }, ...state.tasks] });
      scheduleSync();
      return;
    }
    mutate(snapshot.id, () => ({ status: snapshot.status, position: snapshot.position, deleted: false, title: snapshot.title }));
  },
  async logout() {
    await fetch("/auth/logout", { method: "POST" }).catch(() => {});
    set({ auth: { state: "guest" }, tasks: [] });
  },
};

export function visibleTasks(tasks: Task[], status: Status) {
  return tasks.filter((t) => !t.deleted && t.status === status).sort((a, b) => b.position - a.position);
}

/* ---------- sync ---------- */

let timer: ReturnType<typeof setTimeout> | undefined;
function scheduleSync() {
  if (state.auth.state !== "user") return;
  clearTimeout(timer);
  timer = setTimeout(sync, 350);
}

let inflight: Promise<void> | null = null;
export function sync(): Promise<void> {
  if (state.auth.state !== "user") return Promise.resolve();
  if (inflight) return inflight.then(() => sync());
  inflight = (async () => {
    set({ syncing: true });
    try {
      const pushed = state.tasks.filter((t) => t.dirty);
      if (pushed.length) {
        const res = await fetch("/api/tasks/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tasks: pushed }),
        });
        if (!res.ok) throw new Error(String(res.status));
        const sent = new Map(pushed.map((t) => [t.id, t.updated_at]));
        // 送信後に更に変更されたものは dirty のまま
        set({ tasks: state.tasks.map((t) => (sent.get(t.id) === t.updated_at ? { ...t, dirty: false } : t)) });
      }
      const res = await fetch("/api/tasks");
      if (res.status === 401) {
        set({ auth: { state: "guest" } });
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      const { tasks } = (await res.json()) as { tasks: (Omit<Task, "deleted"> & { deleted: number })[] };
      const local = new Map(state.tasks.map((t) => [t.id, t]));
      const merged: Task[] = tasks.map((s) => {
        const l = local.get(s.id);
        return l?.dirty ? l : { ...s, deleted: !!s.deleted, dirty: false };
      });
      const serverIds = new Set(tasks.map((t) => t.id));
      for (const l of state.tasks) if (l.dirty && !serverIds.has(l.id)) merged.push(l);
      set({ tasks: merged });
    } catch {
      /* オフライン: 次回に再送 */
    } finally {
      set({ syncing: false });
      inflight = null;
    }
  })();
  return inflight;
}

let booted = false;
export async function boot() {
  if (booted) return;
  booted = true;
  const started = performance.now();
  try {
    const res = await fetch("/api/me");
    if (res.ok) {
      const { user } = (await res.json()) as { user: User };
      set({ auth: { state: "user", user } });
      await sync();
    } else {
      set({ auth: { state: "guest" } });
    }
  } catch {
    set({ auth: { state: "guest" } });
  }
  // スケルトンが一瞬だけ点滅しないよう最低表示時間を確保
  const wait = Math.max(0, 420 - (performance.now() - started));
  setTimeout(() => set({ booting: false }), wait);
}

window.addEventListener("online", () => sync());
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") sync();
});

export async function aiSplit(text: string): Promise<string[]> {
  const res = await fetch("/api/ai/split", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) throw new Error(String(res.status));
  const { tasks } = (await res.json()) as { tasks: string[] };
  return tasks;
}
