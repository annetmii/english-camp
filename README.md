# annetmii English Camp

React + Netlify Functions 版。ローカル保存 + 60秒無操作でクラウド自動同期、提出時は必ず同期、起動/ユーザー/日付変更時にクラウド自動読み込み。

## デプロイ手順

### 1) GitHub にアップロード
```
npm i
git init
git add .
git commit -m "initial deploy"
git branch -M main
git remote add origin <YOUR_GITHUB_REPO_URL>
git push -u origin main
```

### 2) Netlify 設定
- **Build command**: `npm run build`
- **Publish directory**: `dist`
- **Functions directory**: `netlify/functions`

#### 環境変数（Site settings → Environment variables）
- `GITHUB_TOKEN` : GitHub の PAT (contents:read/write 必須)
- `REPO` : 保存先リポジトリ（例：`annetmii/annetmii-english-dictionary`）
- `PATH_PREFIX` : ユーザーのルートフォルダ（例：`masayuki`）
- `TRAINER_PIN` : 講師モード用PIN（関数側で検証）

### 3) 動作
- ローカル即時保存（localStorage）
- 60秒無操作で自動同期（Netlify Functions → GitHub）
- 提出ボタンで即時同期
- 起動/日付変更でクラウド読み込み
- カレンダーはローカル保存日＋GitHub上の保存日をドットで表示

## 開発
```
npm i
npm run dev
```
