# annetmii English Camp (no-build版)

## フォルダの中身
- `index.html` … React + Babel（CDN）でそのまま動く
- `app.jsx` … 画面の本体コード
- `netlify/functions/save.js` … GitHubへJSONを書き込み
- `netlify/functions/load.js` … GitHubからJSONを読み込み
- `netlify.toml` … Netlify設定（functionsディレクトリとSPAリダイレクト）
- `package.json` … Netlify Functions用依存（octokit）

## デプロイ
1. GitHubで `annetmii/english-camp` を作成 → このフォルダを丸ごとアップロード
2. Netlifyで **Add new site → Import from Git** → リポを選択
   - Build command: （空欄）
   - Publish directory: `.`
3. Netlifyの環境変数に `GITHUB_TOKEN`（対象リポに Contents: Read&Write）を追加
4. デプロイ後、`/.netlify/functions/load?...` が 200 を返せばOK
