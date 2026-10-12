# Wordring 英単語帳

自分で単語を登録して、暗記カードと4択テストで覚える英単語帳アプリです。
PC とスマホのブラウザで動き、ホーム画面に追加するとアプリのように使えます（オフラインでも動きます）。
Google アカウントでログインすると、PC とスマホで単語帳が同期されます。

## ファイル

| ファイル | 内容 |
| --- | --- |
| `index.html` / `style.css` / `app.js` | アプリ本体 |
| `firebase-config.js` | Firebase の接続設定（手順2で書き換える） |
| `firestore.rules` | データを本人しか読めないようにするルール（手順3で貼り付ける） |
| `sw.js` / `manifest.webmanifest` / `icons/` | オフライン対応とホーム画面用アイコン |

`firebase-config.js` が未設定のままでも、同期なし（その端末だけに保存）で動きます。

---

## 手順1：GitHub Pages で公開する

1. https://github.com にログインし、右上の「＋」→「New repository」
2. Repository name に `wordring` と入れ、**Public** を選んで「Create repository」
3. 作成後の画面で「uploading an existing file」をクリック
4. このフォルダの中身（`index.html` や `icons` フォルダなど全部。`README.md` も可）をドラッグ＆ドロップ → 「Commit changes」
5. リポジトリの「Settings」→ 左の「Pages」→ Branch を `main`、フォルダを `/ (root)` にして「Save」
6. 1〜2分後、`https://<GitHubのユーザー名>.github.io/wordring/` で開けるようになります

## 手順2：Firebase プロジェクトを作る（同期用・無料）

1. https://console.firebase.google.com を開き「プロジェクトを作成」
   - 名前は `wordring` など。Google アナリティクスはオフでOK
2. 左メニュー「構築」→「**Authentication**」→「始める」→「Sign-in method」で **Google** を有効にして保存
3. 同じ Authentication の「設定」→「**承認済みドメイン**」→「ドメインを追加」で
   `<GitHubのユーザー名>.github.io` を追加（`localhost` は最初から入っています）
4. 左メニュー「構築」→「**Firestore Database**」→「データベースを作成」
   - ロケーションは `asia-northeast1 (Tokyo)`、「本番環境モード」で作成
5. 左上の歯車 →「プロジェクトの設定」→ 下の「マイアプリ」で **ウェブ（`</>`）** を選んでアプリを登録
   （Firebase Hosting のチェックは不要）
6. 表示された `firebaseConfig = { ... }` の値を、このフォルダの `firebase-config.js` に貼り付けて保存

## 手順3：データを守るルールを設定する

Firestore Database の「ルール」タブを開き、中身を `firestore.rules` の内容に置き換えて「公開」。
これで、ログインした本人以外は単語帳を読み書きできなくなります。

## 手順4：更新したファイルを GitHub に上げる

`firebase-config.js` を書き換えたら、GitHub のリポジトリで「Add file」→「Upload files」から上書きアップロードします。
アプリを開いて右上の「Googleでログイン」を押せば同期が始まります。

> アプリを修正して上げ直すときは、`sw.js` の `VERSION`（例：`wordring-v1` → `wordring-v2`）も変えてください。
> スマホに古いファイルが残らず、新しい版に切り替わります。

## スマホでアプリとして使う

- **iPhone**：Safari で URL を開く → 共有ボタン →「ホーム画面に追加」
- **Android**：Chrome で URL を開く → メニュー →「ホーム画面に追加」または「アプリをインストール」
- **PC（Chrome / Edge）**：アドレスバー右端のインストールボタン

ホーム画面から開いたアプリは、Safari とは別に保存されます。ホーム画面のアプリ側で一度ログインしてください。

## 手元のPCで試す

```bash
python3 -m http.server 8770 --directory /Users/taroyu0927/wordring-app
```

ブラウザで http://localhost:8770 を開きます。
