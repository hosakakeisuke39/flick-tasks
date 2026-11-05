// 本番用 D1 データベースが無ければ作成し、wrangler.jsonc の database_id を埋める（CI / 初回デプロイ用）
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const NAME = "flick-tasks";
const PLACEHOLDER = "00000000-0000-0000-0000-000000000000";
const wrangler = (...args) => execFileSync("npx", ["wrangler", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });

const find = () => JSON.parse(wrangler("d1", "list", "--json")).find((d) => d.name === NAME);

let db = find();
if (!db) {
  console.log(`D1 "${NAME}" を作成します`);
  wrangler("d1", "create", NAME);
  db = find();
}
if (!db?.uuid) throw new Error("D1 の作成に失敗しました");

const file = "wrangler.jsonc";
const src = readFileSync(file, "utf8");
if (src.includes(PLACEHOLDER)) {
  writeFileSync(file, src.replace(PLACEHOLDER, db.uuid));
  console.log(`database_id = ${db.uuid}`);
}
