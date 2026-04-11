# MODホワイトリスト追加

ユーザーから渡されたDiscordメッセージ（またはテキスト）に含まれるCurseForge URLを抽出し、ヘッド有りブラウザでJARをダウンロードした上で、既存スクリプトを使って `docs/modlicense.json` を更新する。

## 入力

$ARGUMENTS

## 手順

### 1. URL抽出
入力テキストから `https://www.curseforge.com/minecraft/mc-mods/` で始まるURLを全て抽出する。

### 2. 既存チェック
各URLのslug部分（例: `spell-engine`）を使い、`docs/modlicense.json` 内に該当するURLが既に存在するか確認する（Grepで検索）。
既に登録済みのURLはスキップ対象としてユーザーに報告し、未登録のURLのみ以降の処理対象とする。

### 3. check-result.json の作成
未登録URLから `scripts/check-result.json` を生成する。形式は以下の通り：

```json
[
  {
    "curseforgeUrl": "https://www.curseforge.com/minecraft/mc-mods/spell-engine",
    "status": "none"
  }
]
```

### 4. CurseForge からJARをダウンロード（Playwright ヘッド有りブラウザ）
以下のコマンドでブラウザを起動し、MOD JARファイルを `scripts/mods/` に自動ダウンロードする：

```bash
node scripts/curseforge-dl.js scripts/check-result.json
```

- ヘッド有り（`headless: false`）でChromiumが起動する
- Cloudflareチャレンジは自動待機する（最大15回リトライ）
- 1.20.1 Forge向けの最新ファイルを優先してDLする
- 結果は `scripts/dl-result.json` に保存される

**注意**: ブラウザが開いてDLが完了するまで待機すること。タイムアウトは長めに設定する（600秒）。

### 5. JARからメタデータを抽出
ダウンロードしたJARファイルから `mods.toml` を読み取り、modid・ライセンス・作者名などを抽出する：

```bash
npm run generate
```

- `scripts/mods/` 内のJARを処理
- Claritas.jar でgroup情報を取得し、mods.toml からmodid等を読み取る
- 結果は `scripts/output/` に `.link.json` として出力される

### 6. modlicense.json の更新
抽出したメタデータとDL結果を統合して `docs/modlicense.json` を更新する：

```bash
node scripts/update-modlicense.js
```

**重要**: このスクリプトは `check-result.json` のパスが `D:/Users/Owner/Downloads/check-result.json` にハードコードされている。実行前にステップ3で作成した `scripts/check-result.json` をそのパスにコピーするか、スクリプト内のパスを一時的に変更すること：

```bash
cp scripts/check-result.json "D:/Users/Owner/Downloads/check-result.json"
```

### 7. 検証
- JSONの妥当性を検証する：
  ```bash
  node -e "JSON.parse(require('fs').readFileSync('docs/modlicense.json','utf8')); console.log('Valid')"
  ```
- 追加されたエントリをGrepで確認する

### 8. クリーンアップ
処理完了後、一時ファイルを削除する：
- `scripts/check-result.json`
- `scripts/dl-result.json`
- `scripts/output/*.link.json`
- `scripts/mods/*.jar`（DLしたJARファイル）

### 9. 結果報告
追加・更新したMODの一覧を表形式で報告する：

| MOD名 | modid | ライセンス | URL | 状態（新規/更新/既存） |
|-------|-------|----------|-----|---------------------|

## 注意事項
- Playwright が未インストールの場合は `npx playwright install chromium` を先に実行する
- CurseForgeはCloudflare保護があるため、ヘッド有りブラウザでの操作が必須
- ブラウザDL実行時のBashタイムアウトは `600000`（10分）に設定する
- modlicense.json のエントリはmodidのアルファベット順を維持する（update-modlicense.js が自動ソートする）
- `scripts/mods/` ディレクトリが存在しない場合は curseforge-dl.js が自動作成する
