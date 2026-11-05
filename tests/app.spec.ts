import { test, expect, type Page, type Locator } from "@playwright/test";

const uid = () => `u${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

async function login(page: Page, name = uid()) {
  await page.goto(`/auth/dev?name=${name}`);
  await expect(page.getByTestId("avatar")).toBeVisible();
  return name;
}

async function addMemo(page: Page, text: string) {
  const memo = page.getByTestId("memo");
  await memo.fill(text);
  await memo.press("Enter");
  await expect(page.getByTestId("task-title").filter({ hasText: text }).first()).toBeVisible();
}

/** 指でカードをフリックする（pointer イベントで実際にドラッグ） */
async function flick(page: Page, card: Locator, dx: number, { slow = false } = {}) {
  const box = (await card.locator(".card").boundingBox())!;
  const y = box.y + box.height / 2;
  const x0 = box.x + box.width / 2;
  await page.mouse.move(x0, y);
  await page.mouse.down();
  if (slow) {
    // ゆっくり動かして止める（慣性が乗らない操作）
    for (let i = 1; i <= 10; i++) {
      await page.mouse.move(x0 + (dx * i) / 10, y);
      await page.waitForTimeout(30);
    }
    await page.waitForTimeout(150);
  } else {
    await page.mouse.move(x0 + dx, y, { steps: 12 });
  }
  await page.mouse.up();
}

// タブ切替中は退場中の古いリストも一瞬残るので、常に最新（最後）のリストを見る
const activeList = (page: Page) => page.getByTestId("list").last();
const task = (page: Page, text: string) => activeList(page).getByTestId("task").filter({ hasText: text });

async function openTab(page: Page, label: string, status: string) {
  await page.getByRole("tab", { name: new RegExp(label) }).click();
  await expect(activeList(page)).toHaveAttribute("data-tab", status);
  await expect(page.getByTestId("list")).toHaveCount(1);
}

async function waitSynced(page: Page) {
  await expect(page.getByTestId("pending")).toHaveCount(0, { timeout: 5000 });
}

test.describe("起動", () => {
  test("開いた瞬間にメモ欄へフォーカスされ、そのまま入力できる", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("memo")).toBeFocused();
    await page.keyboard.type("思いついたこと");
    await page.keyboard.press("Enter");
    await expect(task(page, "思いついたこと")).toBeVisible();
    await expect(page.getByTestId("memo")).toHaveValue("");
    await expect(page.getByTestId("memo")).toBeFocused();
  });

  test("読み込み中は全画面スケルトンが出て、その間もメモできる", async ({ page }) => {
    await page.route("**/api/me", async (r) => {
      await new Promise((res) => setTimeout(res, 1200));
      await r.continue();
    });
    await page.goto("/");
    const sk = page.getByTestId("skeleton");
    await expect(sk).toBeVisible();
    await expect(sk.locator(".sk-tab")).toHaveCount(3);
    await expect(sk.locator(".card")).toHaveCount(6);
    // スケルトン中でも入力欄は生きている
    await expect(page.getByTestId("memo")).toBeFocused();
    await page.getByTestId("memo").fill("待たずに書く");
    await expect(sk).toBeHidden({ timeout: 5000 });
    await expect(page.getByRole("tablist")).toBeVisible();
    await expect(page.getByTestId("memo")).toHaveValue("待たずに書く");
  });

  test("余計なキャッチコピーやプレースホルダが無い", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("tablist")).toBeVisible();
    await expect(page.getByTestId("memo")).not.toHaveAttribute("placeholder");
    await expect(page.getByTestId("empty")).toHaveText("");
    const text = (await page.locator("body").innerText()).replace(/\s+/g, "");
    expect(text).toBe("未着手0進行中0完了0");
  });

  test("モバイル幅で横スクロールが発生せず、エラーも出ない", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await login(page);
    await addMemo(page, "とても長いタスク名".repeat(12));
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    expect(errors).toEqual([]);
  });

  test("Liquid Glass（backdrop-filter）が効いている", async ({ page }) => {
    await page.goto("/");
    const bf = await page.getByTestId("composer").evaluate((el) => getComputedStyle(el).backdropFilter);
    expect(bf).toContain("blur");
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(bg).toBe("rgb(255, 255, 255)");
  });
});

test.describe("フリックでステータス管理", () => {
  test("右フリックで 未着手 → 進行中 → 完了", async ({ page }) => {
    await login(page);
    await addMemo(page, "企画書を書く");
    await expect(page.getByTestId("count-todo")).toHaveText("1");

    await flick(page, task(page, "企画書を書く"), 170);
    await expect(task(page, "企画書を書く")).toHaveCount(0);
    await expect(page.getByTestId("count-todo")).toHaveText("0");
    await expect(page.getByTestId("count-doing")).toHaveText("1");
    await expect(page.getByTestId("toast")).toContainText("進行中");

    await openTab(page, "進行中", "doing");
    await flick(page, task(page, "企画書を書く"), 170);
    await expect(page.getByTestId("count-done")).toHaveText("1");
    await expect(page.getByTestId("count-doing")).toHaveText("0");

    await openTab(page, "完了", "done");
    await expect(task(page, "企画書を書く")).toBeVisible();
    await expect(task(page, "企画書を書く").locator(".card")).toHaveClass(/status-done/);
  });

  test("左フリックで一つ戻る、未着手で左フリックすると削除、元に戻せる", async ({ page }) => {
    await login(page);
    await addMemo(page, "戻すタスク");
    await flick(page, task(page, "戻すタスク"), 170);
    await openTab(page, "進行中", "doing");
    await flick(page, task(page, "戻すタスク"), -170);
    await expect(page.getByTestId("count-todo")).toHaveText("1");
    await expect(page.getByTestId("count-doing")).toHaveText("0");

    await openTab(page, "未着手", "todo");
    await flick(page, task(page, "戻すタスク"), -170);
    await expect(task(page, "戻すタスク")).toHaveCount(0);
    await expect(page.getByTestId("toast")).toContainText("削除");
    await page.getByTestId("undo").click();
    await expect(task(page, "戻すタスク")).toBeVisible();
    await expect(page.getByTestId("count-todo")).toHaveText("1");
  });

  test("ゆっくり少しだけ動かして離すとキャンセルされ元の位置に戻る", async ({ page }) => {
    await login(page);
    await addMemo(page, "動かさない");
    await flick(page, task(page, "動かさない"), 60, { slow: true });
    await page.waitForTimeout(400);
    await expect(task(page, "動かさない")).toBeVisible();
    await expect(page.getByTestId("count-todo")).toHaveText("1");
    const tx = await task(page, "動かさない").locator(".card").evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).m41);
    expect(Math.abs(tx)).toBeLessThan(1);
  });

  test("完了で右フリックしても何も起きない", async ({ page }) => {
    await login(page);
    await addMemo(page, "終わったもの");
    await flick(page, task(page, "終わったもの"), 170);
    await openTab(page, "進行中", "doing");
    await flick(page, task(page, "終わったもの"), 170);
    await openTab(page, "完了", "done");
    await flick(page, task(page, "終わったもの"), 200);
    await page.waitForTimeout(400);
    await expect(task(page, "終わったもの")).toBeVisible();
    await expect(page.getByTestId("count-done")).toHaveText("1");
  });
});

test.describe("編集・AI", () => {
  test("タップで編集でき、確定すると保存される", async ({ page }) => {
    await login(page);
    await addMemo(page, "誤字のあるタスl");
    await task(page, "誤字のあるタスl").locator(".card").click();
    const edit = page.getByTestId("edit");
    await expect(edit).toBeFocused();
    await edit.fill("誤字を直したタスク");
    await edit.press("Enter");
    await expect(task(page, "誤字を直したタスク")).toBeVisible();
    await waitSynced(page);
    await page.reload();
    await expect(task(page, "誤字を直したタスク")).toBeVisible();
  });

  test("AIボタンでメモを複数タスクに分解できる（ログイン時のみ表示）", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("memo").fill("あれとこれ");
    await expect(page.getByTestId("ai")).toHaveCount(0);

    await login(page);
    await page.getByTestId("memo").fill("洗濯する、メールを返す、ゼミの発表準備");
    await expect(page.getByTestId("ai")).toBeVisible();
    await page.getByTestId("ai").click();
    await expect(page.getByTestId("count-todo")).toHaveText("3");
    for (const t of ["洗濯する", "メールを返す", "ゼミの発表準備"]) await expect(task(page, t)).toBeVisible();
    // 先頭のタスクが一番上
    await expect(page.getByTestId("task-title").first()).toHaveText("洗濯する");
    await expect(page.getByTestId("memo")).toHaveValue("");
  });
});

test.describe("認証と同期", () => {
  test("ログイン前のメモはローカルに残り、ログインするとサーバへ同期される", async ({ page, browser }) => {
    await page.goto("/");
    await addMemo(page, "ログイン前のメモ");
    await page.reload();
    await expect(task(page, "ログイン前のメモ")).toBeVisible();

    const name = await login(page);
    await waitSynced(page);
    const res = await page.request.get("/api/tasks");
    const body = await res.json();
    expect(body.tasks.map((t: { title: string }) => t.title)).toContain("ログイン前のメモ");

    // 別端末（新しいブラウザ）で同じアカウントに入ると見える
    const other = await browser.newContext();
    const p2 = await other.newPage();
    await p2.goto(`/auth/dev?name=${name}`);
    await expect(task(p2, "ログイン前のメモ")).toBeVisible();
    await other.close();
  });

  test("ステータス変更がサーバに保存される", async ({ page }) => {
    await login(page);
    await addMemo(page, "同期確認");
    await flick(page, task(page, "同期確認"), 170);
    await waitSynced(page);
    await expect
      .poll(async () => (await (await page.request.get("/api/tasks")).json()).tasks.find((t: { title: string }) => t.title === "同期確認")?.status)
      .toBe("doing");
  });

  test("ログアウトでセッションとローカルデータが消える", async ({ page }) => {
    await login(page);
    await addMemo(page, "秘密のタスク");
    await waitSynced(page);
    await page.getByTestId("avatar").click();
    await expect(page.getByTestId("menu")).toBeVisible();
    await page.getByTestId("logout").click();
    await expect(page.getByTestId("login")).toBeVisible();
    await expect(task(page, "秘密のタスク")).toHaveCount(0);
    expect((await page.request.get("/api/tasks")).status()).toBe(401);
  });

  test("Googleログインは accounts.google.com へ PKCE 付きでリダイレクトする", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("login")).toHaveAttribute("href", "/auth/google");
    const res = await page.request.get("/auth/google", { maxRedirects: 0 });
    expect(res.status()).toBe(302);
    const loc = new URL(res.headers()["location"]);
    expect(loc.origin).toBe("https://accounts.google.com");
    expect(loc.searchParams.get("code_challenge_method")).toBe("S256");
    expect(loc.searchParams.get("scope")).toBe("openid profile email");
    expect(loc.searchParams.get("redirect_uri")).toMatch(/\/auth\/google\/callback$/);
    expect(res.headers()["set-cookie"]).toMatch(/g_state=.*HttpOnly/);
  });

  test("不正な state のコールバックは拒否される", async ({ page }) => {
    await page.goto("/auth/google/callback?code=x&state=forged");
    await expect(page).toHaveURL(/auth=failed/);
    await expect(page.getByTestId("login")).toBeVisible();
  });

  test("API は未ログインで401、他オリジンからの書き込みは403", async ({ page, playwright }) => {
    const anon = await playwright.request.newContext({ baseURL: "http://localhost:5173" });
    expect((await anon.get("/api/tasks")).status()).toBe(401);
    await anon.dispose();

    await login(page);
    const res = await page.request.post("/api/tasks/sync", {
      headers: { Origin: "https://evil.example" },
      data: { tasks: [] },
    });
    expect(res.status()).toBe(403);
  });

  test("他ユーザーのタスクは上書きできない", async ({ page, browser }) => {
    await login(page);
    await addMemo(page, "Aのタスク");
    await waitSynced(page);
    const { tasks } = await (await page.request.get("/api/tasks")).json();
    const victim = tasks[0];

    const ctx = await browser.newContext();
    const p2 = await ctx.newPage();
    await login(p2);
    const now = Date.now() + 10_000;
    await p2.request.post("/api/tasks/sync", {
      data: { tasks: [{ ...victim, title: "乗っ取り", updated_at: now }] },
    });
    await ctx.close();

    const after = await (await page.request.get("/api/tasks")).json();
    expect(after.tasks[0].title).toBe("Aのタスク");
  });
});
