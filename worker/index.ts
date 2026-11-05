import { Hono, type Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { Google, generateState, generateCodeVerifier, decodeIdToken } from "arctic";

type Env = {
  DB: D1Database;
  AI?: Ai;
  ASSETS: Fetcher;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  DEV_LOGIN?: string;
};
type User = { id: string; email: string; name: string; picture: string | null };
type Vars = { user: User };
type C = Context<{ Bindings: Env; Variables: Vars }>;

const SESSION_DAYS = 30;
const STATUSES = ["todo", "doing", "done"] as const;
const AI_MODEL = "@cf/google/gemma-4-26b-a4b-it";
const WHISPER_MODEL = "@cf/openai/whisper-large-v3-turbo";

const app = new Hono<{ Bindings: Env; Variables: Vars }>();

/* ---------- helpers ---------- */

async function sha256(input: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function randomToken(bytes = 32) {
  const a = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...a)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function isSecure(c: C) {
  return new URL(c.req.url).protocol === "https:";
}

async function createSession(c: C, userId: string) {
  const token = randomToken();
  const expires = Date.now() + SESSION_DAYS * 86400_000;
  await c.env.DB.prepare("INSERT INTO sessions (id_hash, user_id, expires_at) VALUES (?, ?, ?)")
    .bind(await sha256(token), userId, expires)
    .run();
  setCookie(c, "sid", token, {
    httpOnly: true,
    secure: isSecure(c),
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_DAYS * 86400,
  });
}

async function upsertUser(c: C, sub: string, email: string, name: string, picture: string | null) {
  const existing = await c.env.DB.prepare("SELECT id FROM users WHERE google_sub = ?").bind(sub).first<{ id: string }>();
  if (existing) {
    await c.env.DB.prepare("UPDATE users SET email = ?, name = ?, picture = ? WHERE id = ?")
      .bind(email, name, picture, existing.id)
      .run();
    return existing.id;
  }
  const id = crypto.randomUUID();
  await c.env.DB.prepare("INSERT INTO users (id, google_sub, email, name, picture, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(id, sub, email, name, picture, Date.now())
    .run();
  return id;
}

async function currentUser(c: C): Promise<User | null> {
  const token = getCookie(c, "sid");
  if (!token) return null;
  const row = await c.env.DB.prepare(
    `SELECT u.id, u.email, u.name, u.picture, s.expires_at FROM sessions s
     JOIN users u ON u.id = s.user_id WHERE s.id_hash = ?`
  )
    .bind(await sha256(token))
    .first<User & { expires_at: number }>();
  if (!row || row.expires_at < Date.now()) return null;
  const { expires_at: _e, ...user } = row;
  return user;
}

function google(c: C) {
  const origin = new URL(c.req.url).origin;
  return new Google(c.env.GOOGLE_CLIENT_ID ?? "", c.env.GOOGLE_CLIENT_SECRET ?? "", `${origin}/auth/google/callback`);
}

/* ---------- auth ---------- */

app.get("/auth/google", (c) => {
  if (!c.env.GOOGLE_CLIENT_ID || !c.env.GOOGLE_CLIENT_SECRET) {
    return c.text("Google OAuth is not configured (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET)", 500);
  }
  const state = generateState();
  const verifier = generateCodeVerifier();
  const url = google(c).createAuthorizationURL(state, verifier, ["openid", "profile", "email"]);
  const opts = { httpOnly: true, secure: isSecure(c), sameSite: "Lax" as const, path: "/auth", maxAge: 600 };
  setCookie(c, "g_state", state, opts);
  setCookie(c, "g_verifier", verifier, opts);
  return c.redirect(url.toString());
});

app.get("/auth/google/callback", async (c) => {
  const code = c.req.query("code");
  const state = c.req.query("state");
  const savedState = getCookie(c, "g_state");
  const verifier = getCookie(c, "g_verifier");
  deleteCookie(c, "g_state", { path: "/auth" });
  deleteCookie(c, "g_verifier", { path: "/auth" });
  if (!code || !state || !savedState || !verifier || state !== savedState) {
    return c.redirect("/?auth=failed");
  }
  try {
    const tokens = await google(c).validateAuthorizationCode(code, verifier);
    const claims = decodeIdToken(tokens.idToken()) as {
      sub: string; email: string; name?: string; picture?: string; email_verified?: boolean;
    };
    if (!claims.email_verified) return c.redirect("/?auth=failed");
    const userId = await upsertUser(c, claims.sub, claims.email, claims.name ?? claims.email, claims.picture ?? null);
    await createSession(c, userId);
    return c.redirect("/");
  } catch {
    return c.redirect("/?auth=failed");
  }
});

// ローカル開発・E2E専用。本番は DEV_LOGIN="0" なので 404
app.get("/auth/dev", async (c) => {
  if (c.env.DEV_LOGIN !== "1") return c.notFound();
  const name = c.req.query("name") ?? "Tester";
  const userId = await upsertUser(c, `dev:${name}`, `${name.toLowerCase()}@example.test`, name, null);
  await createSession(c, userId);
  return c.redirect("/");
});

app.post("/auth/logout", async (c) => {
  const token = getCookie(c, "sid");
  if (token) await c.env.DB.prepare("DELETE FROM sessions WHERE id_hash = ?").bind(await sha256(token)).run();
  deleteCookie(c, "sid", { path: "/" });
  return c.json({ ok: true });
});

/* ---------- API ---------- */

app.use("/api/*", async (c, next) => {
  // CSRF: 変更系は同一オリジンのみ
  if (c.req.method !== "GET") {
    const origin = c.req.header("Origin");
    if (origin && origin !== new URL(c.req.url).origin) return c.json({ error: "bad origin" }, 403);
  }
  const user = await currentUser(c);
  if (!user) return c.json({ error: "unauthorized" }, 401);
  c.set("user", user);
  await next();
});

app.get("/api/me", (c) => c.json({ user: c.get("user"), ai: true }));

app.get("/api/tasks", async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT id, title, status, position, deleted, created_at, updated_at FROM tasks WHERE user_id = ? AND deleted = 0 ORDER BY position DESC"
  )
    .bind(c.get("user").id)
    .all();
  return c.json({ tasks: results });
});

type IncomingTask = { id: string; title: string; status: string; position: number; deleted?: boolean; created_at: number; updated_at: number };

function validTask(t: IncomingTask) {
  return (
    typeof t.id === "string" && /^[\w-]{8,64}$/.test(t.id) &&
    typeof t.title === "string" && t.title.trim().length > 0 && t.title.length <= 2000 &&
    (STATUSES as readonly string[]).includes(t.status) &&
    Number.isFinite(t.position) && Number.isFinite(t.created_at) && Number.isFinite(t.updated_at)
  );
}

// オフラインで溜まった変更をまとめて反映（updated_at が新しい方が勝つ）
app.post("/api/tasks/sync", async (c) => {
  const body = await c.req.json<{ tasks: IncomingTask[] }>().catch(() => null);
  if (!body || !Array.isArray(body.tasks) || body.tasks.length > 500) return c.json({ error: "bad request" }, 400);
  const uid = c.get("user").id;
  const stmts = body.tasks.filter(validTask).map((t) =>
    c.env.DB.prepare(
      `INSERT INTO tasks (id, user_id, title, status, position, deleted, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET title = excluded.title, status = excluded.status,
         position = excluded.position, deleted = excluded.deleted, updated_at = excluded.updated_at
       WHERE tasks.user_id = excluded.user_id AND excluded.updated_at >= tasks.updated_at`
    ).bind(t.id, uid, t.title.trim(), t.status, t.position, t.deleted ? 1 : 0, t.created_at, t.updated_at)
  );
  if (stmts.length) await c.env.DB.batch(stmts);
  return c.json({ ok: true, applied: stmts.length });
});

// AI: 走り書きのメモを実行可能なタスクに分解
async function splitText(env: Env, text: string): Promise<string[]> {
  if (!env.AI) {
    // ローカル（AIバインディングなし）時のフォールバック：区切り文字で分割
    return text.split(/\n|、|。|,|・|と(?=.{2,})/).map((s) => s.trim()).filter(Boolean).slice(0, 8);
  }

  const system =
    "あなたはタスク整理アシスタントです。ユーザーのメモを、すぐ着手できる具体的なタスクに分解します。" +
    "各タスクは動詞で終わる日本語の短い文（30文字以内）。最大8件。重複・前置き・説明は禁止。" +
    "音声の書き起こしの場合は、言い淀みやフィラー（えー、あの等）は無視します。" +
    '出力は JSON のみ: {"tasks": ["...", "..."]}';
  const messages = [
    { role: "system", content: system },
    { role: "user", content: text },
  ];

  let res: unknown;
  try {
    res = await env.AI.run(AI_MODEL as keyof AiModels, {
      messages,
      response_format: {
        type: "json_schema",
        json_schema: {
          type: "object",
          properties: { tasks: { type: "array", items: { type: "string" }, maxItems: 8 } },
          required: ["tasks"],
        },
      },
      max_tokens: 1024,
    } as never);
  } catch {
    // JSON モード非対応時は通常生成で再試行
    res = await env.AI.run(AI_MODEL as keyof AiModels, { messages, max_tokens: 1024 } as never);
  }

  const tasks = extractTasks(res);
  if (!tasks.length) console.log("ai/split: unparsed response", JSON.stringify(res).slice(0, 2000));
  return tasks
    .map((t) => t.replace(/^[-*・\d.)\s]+/, "").trim().slice(0, 200))
    .filter(Boolean)
    .slice(0, 8);
}

app.post("/api/ai/split", async (c) => {
  const body = await c.req.json<{ text: string }>().catch(() => null);
  const text = body?.text?.trim();
  if (!text || text.length > 2000) return c.json({ error: "bad request" }, 400);
  const tasks = await splitText(c.env, text);
  return c.json({ tasks, source: c.env.AI ? "workers-ai" : "local" });
});

// AI: 録音した音声 → Whisper で書き起こし → タスクに分解
const MAX_AUDIO = 8 * 1024 * 1024;
app.post("/api/ai/voice", async (c) => {
  const type = c.req.header("Content-Type") ?? "";
  if (!/^(audio|video)\//.test(type)) return c.json({ error: "audio required" }, 415);
  const buf = await c.req.arrayBuffer();
  if (buf.byteLength < 200) return c.json({ error: "too short" }, 400);
  if (buf.byteLength > MAX_AUDIO) return c.json({ error: "too large" }, 413);

  let text: string;
  if (!c.env.AI) {
    // ローカル開発・E2E 用の固定書き起こし
    text = "牛乳を買う、レポートを提出する";
  } else {
    const out = (await c.env.AI.run(WHISPER_MODEL as keyof AiModels, {
      audio: toBase64(buf),
      language: "ja",
      vad_filter: true,
    } as never)) as { text?: string };
    text = (out?.text ?? "").trim();
  }
  if (!text) return c.json({ text: "", tasks: [] });
  const tasks = await splitText(c.env, text.slice(0, 2000));
  return c.json({ text, tasks: tasks.length ? tasks : [text.slice(0, 200)] });
});

function toBase64(buf: ArrayBuffer) {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

// モデルごとに返り値の形が異なる（response が文字列/オブジェクト、OpenAI互換の choices など）ので幅広く読む
function extractTasks(res: unknown): string[] {
  const candidates: unknown[] = [];
  const r = res as Record<string, any> | null;
  if (r && typeof r === "object") {
    candidates.push(r.response, r.result?.response, r.choices?.[0]?.message?.content, r.choices?.[0]?.text, r.output_text, r);
  } else candidates.push(res);

  for (const c of candidates) {
    const t = fromValue(c);
    if (t.length) return t;
  }
  return [];
}

function fromValue(v: unknown): string[] {
  if (v == null) return [];
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string");
  if (typeof v === "object") {
    const t = (v as { tasks?: unknown }).tasks;
    return Array.isArray(t) ? t.filter((x): x is string => typeof x === "string") : [];
  }
  if (typeof v !== "string") return [];
  const s = v.replace(/```(?:json)?/g, "").trim();
  // 本文中の最初の JSON オブジェクト／配列を拾う
  for (const m of [s, s.match(/\{[\s\S]*\}/)?.[0], s.match(/\[[\s\S]*\]/)?.[0]]) {
    if (!m) continue;
    try {
      const t = fromValue(JSON.parse(m));
      if (t.length) return t;
    } catch {
      /* next */
    }
  }
  // 最後の手段：箇条書きの行
  const lines = s.split("\n").map((l) => l.trim()).filter((l) => /^([-*・]|\d+[.)])\s*/.test(l));
  return lines;
}

export function describe(v: unknown, depth = 0): unknown {
  if (depth > 3) return typeof v;
  if (Array.isArray(v)) return [v.length ? describe(v[0], depth + 1) : "empty"];
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).slice(0, 12).map(([k, x]) => [k, describe(x, depth + 1)]));
  if (typeof v === "string") return `string(${v.length}):${v.slice(0, 80)}`;
  return typeof v;
}

app.all("/api/*", (c) => c.json({ error: "not found" }, 404));

export default app;
