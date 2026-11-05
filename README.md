# Flick

開いた瞬間にメモでき、フリックでステータスを動かすタスク管理Webアプリ（モバイルファースト）。

- **即メモ**：起動と同時に入力欄へフォーカス。読み込み中（スケルトン表示中）でも書ける。ログイン前でも端末内に保存され、ログインすると自動で同期
- **フリック**：右へ弾くと 未着手 → 進行中 → 完了、左へ弾くと一つ戻る（未着手で左は削除）。すべて「元に戻す」可能
- **タップで編集**、**AIボタン（✨）**で走り書きのメモを複数タスクに分解（Workers AI）
- **Liquid Glass UI**（白ベース）、全画面スケルトン、各所にスプリングアニメーション
- **Googleログインのみ**

## 構成

```
ブラウザ (React + Motion, PWA)
   │  localStorage に即保存 → バックグラウンドで差分同期
   ▼
Cloudflare Workers (Hono)
   ├─ 静的アセット配信 (Workers Static Assets)
   ├─ /auth/*  Google OAuth 2.0 (PKCE) → セッションCookie
   ├─ /api/*   タスク同期 API
   ├─ D1 (SQLite)   users / sessions / tasks
   └─ Workers AI    @cf/google/gemma-4-26b-a4b-it
```

## 技術選定の理由

| 領域 | 採用 | 理由 |
|---|---|---|
| ホスティング | **Cloudflare Workers + Static Assets** | フロントとAPIを1つのWorkerで同一オリジン配信でき、CORSが不要・Cookie認証が素直に書ける。Pagesより新しい推奨構成で、エッジ配信なので日本からの初回表示も速い |
| APIフレームワーク | **Hono** | Workers向けに作られた軽量ルーター。Cookie・ミドルウェア（CSRF/認証）が標準で揃い、バンドルが小さくコールドスタートに響かない |
| DB | **Cloudflare D1** | Workersからバインディングで直接呼べるSQLite。ユーザー×タスクという関係データに合い、`batch`で同期をまとめて1往復で書ける。無料枠で個人利用は十分 |
| AI | **Workers AI / Gemma 4 26B A4B** | 指定どおりWorkers AI。2026年5月の旧モデル廃止で推奨された後継の一つで、MoE（実働4B）なので応答が速く、日本語も扱える。JSON Schema 指定で出力を構造化 |
| 認証 | **Google OAuth を自前実装（arctic）＋D1セッション** | Googleのみなら重い認証基盤は不要。arcticはPKCE/stateを含む安全なOAuthフローを数行で書ける小さなライブラリ。セッションはランダムトークンのSHA-256だけをD1に保存し、HttpOnly・SameSite=Lax Cookieで配る |
| フロント | **React 19 + Vite** | フリック・レイアウト遷移など状態とアニメーションが絡むUIを素直に組める。Cloudflare公式のViteプラグインで、ローカルでも本番同等のWorkers実行環境（workerd + D1）が動く |
| アニメーション | **Motion（旧 Framer Motion）** | ドラッグ（フリック）、慣性、スプリング、`layout`による並び替え、`AnimatePresence`の退場アニメ、タブの`layoutId`ピル移動まで1ライブラリで完結する |
| スタイル | **素のCSS（CSS変数）** | Liquid Glassは`backdrop-filter`・多層の`box-shadow`・疑似要素の鏡面ハイライト・マスクで縁の屈折を作る細かい調整が中心で、ユーティリティCSSより直接書く方が速く正確 |
| 即起動 | **PWA（vite-plugin-pwa / Workbox）＋localStorage先行** | 2回目以降はService Workerのキャッシュから即表示。データもまず端末に書いてから同期するので、通信を待たずにメモできオフラインでも動く |
| フォント | **システムフォント** | Webフォントの読み込み待ちを無くし「開いた瞬間」を優先 |
| テスト | **Playwright（iPhone 15 エミュレーション）** | 実ブラウザで本当にカードをドラッグしてフリックを検証できる。CIでも同じテストが走る |
| CI/CD | **GitHub Actions → wrangler deploy** | pushするとテスト→D1作成/マイグレーション→デプロイまで自動 |

## ローカル開発

```bash
npm install
cp .dev.vars.example .dev.vars
npm run db:migrate:local
npm run dev            # http://localhost:5173
```

ローカルでは `CLOUDFLARE_ENV=dev` で動き、Cloudflareアカウントなしで起動できます。

- `/auth/dev?name=Tester` で開発用ログイン（本番は `DEV_LOGIN="0"` なので無効・404）
- AIバインディングが無い環境では、区切り文字でメモを分割する簡易処理にフォールバックします

### テスト

```bash
npm run test:e2e
```

## デプロイ（GitHub Actions）

1. Cloudflare で API トークンを作成（テンプレート「Edit Cloudflare Workers」に **D1: Edit** と **Workers AI: Read** を追加）
2. Google Cloud Console で OAuth クライアント（ウェブアプリ）を作成し、承認済みリダイレクトURIに `https://<worker>.<subdomain>.workers.dev/auth/google/callback` を追加
3. GitHub リポジトリの Settings → Secrets and variables → Actions に登録
   - `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID`
   - `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`
4. `main` に push すると、テスト → D1作成（初回のみ）→ マイグレーション → デプロイ → OAuthシークレット登録 が走ります

手元からデプロイする場合は `npx wrangler login` の後に `npm run deploy`。
