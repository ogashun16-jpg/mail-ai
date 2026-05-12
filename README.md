# Mail · AI - iPadだけで動かす（Render.com 無料版）

Macなし、iPadだけで使える完全無料のメールクライアント。  
Render.comでサーバーを動かし、ClaudeのAPIだけが従量課金（実質月数十円〜数百円）。

---

## 構成と料金

```
iPad (Safari/PWA)  ──HTTPS──►  Render.com  ──IMAP/SMTP──►  mail.sritakada.com.my
                              (無料・スリープあり)
                                    │
                                    └──HTTPS──►  Claude API ($5/月程度)
```

| 項目 | 月額 |
|---|---|
| Render.com 無料プラン | **$0** |
| GitHub（コード保管） | **$0** |
| Claude API（要約20回・下書き20回/日想定） | $1〜$5 |
| **合計** | **$1〜$5（約150〜750円）** |

**スリープについて**: Render無料プランは15分使わないと停止します。次にURLを開くと30秒〜1分で復帰。実用上は問題ありません。

---

## セットアップ手順（iPadだけで15分）

### Step 1: GitHubアカウント作成（5分）

1. iPadのSafariで [github.com](https://github.com) を開く
2. **Sign up** → 無料登録
3. メール認証を済ませる

### Step 2: 新規リポジトリ作成

1. GitHub右上の「**+**」 → **New repository**
2. 設定:
   - **Repository name**: `mail-ai`
   - **Public** または **Private** どちらでもOK
   - その他はチェック不要
3. **Create repository** をタップ

### Step 3: コードをGitHubにアップロード

iPadではコマンドラインが使えないので、ブラウザのGitHub UIで直接アップロードします。

1. 作成したリポジトリページで「**uploading an existing file**」リンクをタップ  
   （`Quick setup` セクション内）
2. **Choose your files** から、このZIPを展開した中身を**フォルダごと選択**
   - `server.js`、`package.json`、`render.yaml`、`.gitignore`、`README.md`
   - `public/` フォルダの中身全部（`index.html`、`app.js`、`sw.js`、`manifest.json`、各アイコン）
3. 下部の **Commit changes** をタップしてアップロード

> **注**: iPadのSafariでは複数ファイル選択が一度にできない場合があります。その場合は何回かに分けてアップロードしてください。フォルダ構成（`public/`が階層化されている状態）を保つことが重要です。

**代替方法（おすすめ）**: GitHubの「**Add file > Create new file**」で1ファイルずつ作成し、コードをコピー&ペーストする方法もあります。手間ですが確実です。

### Step 4: Claude APIキーを取得

1. 別タブで [console.anthropic.com](https://console.anthropic.com) を開く
2. アカウント作成 → 支払い方法を登録（最初は$5の無料クレジット付き）
3. **API Keys** → **Create Key** で新規キーを生成
4. `sk-ant-api03-...` 形式のキーをコピーして安全な場所に保管

### Step 5: Render.comアカウント作成（3分）

1. iPadのSafariで [render.com](https://render.com) を開く
2. **Get Started for Free** → **GitHub** でサインアップ
3. RenderにGitHubアクセス許可を与える

### Step 6: Renderにデプロイ

1. Renderダッシュボードで **New +** → **Web Service**
2. **Build and deploy from a Git repository** → **Next**
3. `mail-ai` リポジトリを選択 → **Connect**
4. 設定画面で以下を確認・入力:

| 項目 | 値 |
|---|---|
| **Name** | `mail-ai`（任意の名前） |
| **Region** | Singapore（マレーシアに近い） |
| **Branch** | `main` |
| **Runtime** | Node |
| **Build Command** | `npm install` |
| **Start Command** | `node server.js` |
| **Plan** | **Free** を選択 |

5. 下にスクロールして **Advanced** をタップ
6. **Add Environment Variable** で以下を2つ追加:

| Key | Value |
|---|---|
| `ANTHROPIC_API_KEY` | （Step 4でコピーした `sk-ant-...`） |
| `SESSION_SECRET` | 適当な長い文字列（例: `mailai-secret-7x9k2pq8mznv3`） |

7. **Create Web Service** をタップ
8. ビルドが始まる（初回は3〜5分）

### Step 7: iPadのSafariで開く

1. デプロイ完了後、Renderが自動でURLを発行します（例: `https://mail-ai-xxxx.onrender.com`）
2. このURLをiPadのSafariで開く
3. ログイン画面が表示されたら以下を入力:
   - **メールアドレス**: あなたの `@sritakada.com.my` アドレス
   - **パスワード**: メールパスワード
   - **詳細設定**: 既定値（IMAP:993, SMTP:465 SSL/ON）でOK
4. **ログイン** をタップ

接続できれば受信箱が表示されます。

### Step 8: ホーム画面に追加（PWA化）

ネイティブアプリのように使うため:

1. Safariで開いた状態で、共有ボタン（□↑）をタップ
2. **「ホーム画面に追加」** を選択
3. 名前を「Mail · AI」に → 追加

これでホーム画面のアイコンから全画面表示で起動できます。

---

## 使い方

### 受信メールの日本語要約

1. メールをタップして開く
2. 紫色の **「✨ 日本語で要約する」** ボタンをタップ
3. Claudeが「要点・依頼・期限・推奨アクション」の4セクションで要約（約2〜5秒）

### AI下書き返信

1. 返信したいメールを開き、紫の要約カード内の **「✨ AI返信を作成」** をタップ  
   または、ヘッダーの **「返信」** をタップして手動で作成画面へ
2. 上部のセグメントで言語を選択: **日本語 / English / Auto**
3. トーンを選択: 丁寧 / フォーマル / 簡潔 / カジュアル
4. **「AIで下書き」** をタップ
5. プロンプト入力（例:「快諾して火曜の14時を提案」）
6. Claudeが下書きを生成 → 編集 → 送信

### 迷惑メール対応

迷惑メールフォルダのメールには自動でオレンジの警告バナーが表示され、「受信箱へ移動」「完全に削除」のアクションがすぐ使えます。

---

## スリープ問題の解決法（任意）

Render無料プランは15分アクセスがないと停止します。復帰に30秒〜1分かかるのが気になる場合、以下のいずれかで対策できます。

### 方法1: UptimeRobot で定期ping（無料・推奨）

1. [uptimerobot.com](https://uptimerobot.com) で無料アカウント作成
2. **Add New Monitor** → 設定:
   - Monitor Type: **HTTP(s)**
   - Friendly Name: `Mail AI`
   - URL: `https://あなたのRenderURL/health`
   - Monitoring Interval: **5分**
3. 保存

これで5分ごとにヘルスチェックが走り、スリープしません。  
（厳密にはRenderの無料枠は月750時間で、24時間稼働すると枠を超える可能性がありますが、個人利用なら問題ない範囲です）

### 方法2: 受け入れる

普段から30〜60秒の待ちを許容するなら何もしなくてOK。Claude API料金が増えないので一番安いです。

---

## トラブルシューティング

### ログインに失敗する

**「認証エラー」と出る場合**:
- パスワードが正しいか確認
- cPanelのメール管理画面で IMAPアクセス が有効か確認

**ポートを変えてみる**:
- IMAP: 993 (SSL) → 143 (STARTTLS)
- SMTP: 465 (SSL) → 587 (STARTTLS)

### Renderのビルドが失敗

- ログ画面で原因を確認
- `package.json` が正しくアップロードされているか確認
- 環境変数が設定されているか確認

### Claude APIエラー

- Render → 該当サービス → **Environment** タブで `ANTHROPIC_API_KEY` を確認
- 修正後は **Manual Deploy** で再起動

### iPadのSafariでセッションが切れる

- 7日間でセッション切れ（再ログインのみ）
- ホーム画面のアイコンから起動すると、Cookie保持が長くなります

### URLが安全じゃないと警告される

- Render無料プランは `*.onrender.com` ドメインで自動HTTPS
- 警告が出る場合はURLが`https://`になっているか確認

---

## セキュリティについて

- **メールパスワード**: Renderサーバーのメモリ上のセッションに保存（永続化されない）
- **メール本文**: 要約・下書き生成時にClaude API（Anthropic）に送信
- **Claude APIキー**: Renderの環境変数に保存（HTTPSで暗号化）
- **通信**: すべてHTTPS

**重要**: 本格的な業務利用の場合は、専用ドメインの取得とより厳密なアクセス制御をご検討ください。

---

## まとめ

✅ **iPadだけで完結**（Mac/PC不要）  
✅ **サーバー無料**（Render.com）  
✅ **24時間アクセス可能**（UptimeRobot併用）  
✅ **Claude AIで要約・下書き**  
✅ **PWAでネイティブ風UI**

質問や問題があれば、ZIPに含まれるコードを直接編集してGitHubにコミット → Renderが自動再デプロイします（iPadのGitHub Webから可能）。
