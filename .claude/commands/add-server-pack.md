# MODパックサーバー追加

CurseForge URLリストからサーバーディレクトリを作成し、modlicense.json の更新、MODの配置（JAR直接 or link.json）を一括で行う。

## 入力

$ARGUMENTS

入力には以下を含むこと：
- CurseForge URL一覧（`https://www.curseforge.com/minecraft/mc-mods/{slug}/files/{fileId}` 形式）
- サーバー名（日本語可）

## 手順

### 1. URL抽出・解析
入力テキストから CurseForge URL を全て抽出する。
各URLから `slug` と `fileId` を分離する。

```
例: https://www.curseforge.com/minecraft/mc-mods/simple-voice-chat/files/6787150
→ slug: simple-voice-chat, fileId: 6787150
```

### 2. サーバーディレクトリの確認
入力のサーバー名に対応するディレクトリが `servers/` 配下に既に存在するか確認する。
存在しなければユーザーにディレクトリ名を確認する。
ディレクトリ内に `servermeta.json` と `forgemods/required/`、`forgemods/optionalon/`、`files/` を作成する。

`servermeta.json` のテンプレート：
```json
{
  "$schema": "file:///E:/softdata/git/NumaPacks/schemas/ServerMetaSchema.schema.json",
  "meta": {
    "version": "1.0.0",
    "name": "{サーバー名}(Minecraft 1.20.1)",
    "description": "1.20.1",
    "address": "",
    "discord": {
      "shortId": "Minecraft",
      "largeImageText": "Minecraft",
      "largeImageKey": "pack_numa"
    },
    "mainServer": false,
    "autoconnect": false
  },
  "forge": {
    "version": "47.3.0"
  },
  "untrackedFiles": []
}
```

### 3. modlicense.json の既存チェック
各URLの slug を使い、`docs/modlicense.json` 内に該当するURLが既に存在するか確認する（Grepで検索）。
未登録のMODのみ、ステップ4〜7のmodlicense更新対象とする。

### 4. modlicense.json 更新（未登録MODのみ）
未登録MODがある場合、`/add-mods` スキルと同様の手順で modlicense.json を更新する：

1. `scripts/check-result.json` を作成（未登録MODのみ）
2. `node scripts/curseforge-dl.js scripts/check-result.json` でJARダウンロード（タイムアウト600秒）
3. `npm run generate` でメタデータ抽出
4. group情報取得に失敗したMODは手動で link.json を作成（JARを unzip して `fabric.mod.json` or `META-INF/mods.toml` から modid, license, authors を読み取る）
5. `cp scripts/check-result.json "D:/Users/Owner/Downloads/check-result.json"` でコピー
6. `node scripts/update-modlicense.js` で更新
7. JSON妥当性検証
8. 一時ファイル（check-result.json, dl-result.json, output/*.link.json, mods/*.jar）を削除

### 5. 特定fileIdのJARダウンロード
ユーザーが指定した**特定の fileId** のJARをダウンロードする。
以下のPlaywrightスクリプトを `scripts/dl-specific.js` として作成・実行する：

```javascript
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DOWNLOAD_DIR = path.resolve(__dirname, "mods");
// FILES配列はステップ1で抽出したslug/fileIdから動的に生成する
const FILES = [
  // { slug: "simple-voice-chat", fileId: "6787150" },
];

async function waitForCF(page, max = 15) {
  for (let i = 0; i < max; i++) {
    const t = await page.title();
    if (!t.toLowerCase().includes("just a moment") && !t.toLowerCase().includes("challenge")) return true;
    await page.waitForTimeout(3000);
  }
  return false;
}

async function main() {
  if (!fs.existsSync(DOWNLOAD_DIR)) fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
  const browser = await chromium.launch({ headless: false, slowMo: 200 });
  const ctx = await browser.newContext({
    acceptDownloads: true,
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0.0.0 Safari/537.36",
  });
  const w = await ctx.newPage();
  await w.goto("https://www.curseforge.com/minecraft/mc-mods", { waitUntil: "domcontentloaded", timeout: 30000 });
  await waitForCF(w); await w.waitForTimeout(2000); await w.close();

  const results = [];
  for (let i = 0; i < FILES.length; i++) {
    const e = FILES[i];
    console.log(`[${i+1}/${FILES.length}] ${e.slug} (${e.fileId})`);
    const page = await ctx.newPage();
    try {
      const dp = page.waitForEvent("download", { timeout: 60000 });
      await page.goto(`https://www.curseforge.com/minecraft/mc-mods/${e.slug}/download/${e.fileId}`, { waitUntil: "domcontentloaded", timeout: 30000 });
      await waitForCF(page);
      const dl = await dp;
      const fn = dl.suggestedFilename();
      const savePath = path.join(DOWNLOAD_DIR, fn);
      await dl.saveAs(savePath);
      const buf = fs.readFileSync(savePath);
      console.log(`  -> ${fn} (${buf.length} bytes, MD5: ${crypto.createHash("md5").update(buf).digest("hex")})`);
      results.push({ slug: e.slug, fileId: e.fileId, filename: fn, size: buf.length, md5: crypto.createHash("md5").update(buf).digest("hex") });
    } catch (err) { console.log(`  ERROR: ${err.message.substring(0, 200)}`); }
    await page.close();
  }
  await browser.close();
  fs.writeFileSync(path.resolve(__dirname, "dl-specific-result.json"), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
}
main().catch(console.error);
```

タイムアウトは `600000`（10分）に設定すること。

### 6. ライセンス判定・MOD配置
ダウンロードしたJARの `META-INF/mods.toml`（Forge）または `fabric.mod.json`（Fabric）からライセンスを読み取る：

```bash
cd scripts/mods && for jar in *.jar; do echo "=== $jar ==="; unzip -p "$jar" META-INF/mods.toml 2>/dev/null | head -30; echo "---"; done
```

**ライセンス判定基準：**

| ライセンス | 二次配布 | 配置方法 |
|-----------|---------|---------|
| MIT / MIT License | OK | JAR直接配置 |
| Apache-2.0 | OK | JAR直接配置 |
| GNU GPLv2 / GPLv3 / LGPL | OK | JAR直接配置 |
| BSD (2-clause / 3-clause) | OK | JAR直接配置 |
| CC0 / Public Domain | OK | JAR直接配置 |
| MPL-2.0 | OK | JAR直接配置 |
| All Rights Reserved | NG | link.json |
| 独自ライセンス / 不明 | NG | link.json |
| Polyform-Noncommercial | NG | link.json |
| ARR / カスタム | NG | link.json |

**二次配布OKの場合（JAR直接配置）：**
JARファイルを `servers/{サーバーディレクトリ}/forgemods/required/` に直接コピーする。

**二次配布NGの場合（link.json）：**
以下の形式で `.link.json` ファイルを作成する：

```json
{
  "id": "{group}:{modid}:{version}@jar",
  "name": "{displayName}",
  "type": "ForgeMod",
  "artifact": {
    "size": 12345,
    "MD5": "abc123def456",
    "url": "",
    "manual": {
      "url": "https://www.curseforge.com/minecraft/mc-mods/{slug}/download/{fileId}",
      "name": "{filename}.jar"
    }
  }
}
```

- `id` のgroup部分は mods.toml の authors やパッケージ構造から推測する
- `manual.url` は `https://www.curseforge.com/minecraft/mc-mods/{slug}/download/{fileId}` 形式を使用する（プロジェクトID不要）
- ファイル名は `{JARファイル名}.link.json`（例: `voicechat-forge-1.20.1-2.5.35.jar.link.json`）

### 7. クリーンアップ
一時ファイルを削除する：
- `scripts/dl-specific.js`
- `scripts/dl-specific-result.json`
- `scripts/mods/*.jar`

### 8. 結果報告
サーバーに配置したMODの一覧を表形式で報告する：

| MOD名 | modid | ライセンス | 配置方法 | ファイル名 |
|-------|-------|----------|---------|-----------|

## 注意事項
- Playwright が未インストールの場合は `npx playwright install chromium` を先に実行する
- CurseForgeはCloudflare保護があるため、ヘッド有りブラウザでの操作が必須
- ブラウザDL実行時のBashタイムアウトは `600000`（10分）に設定する
- `curseforge-dl.js`（ステップ4）は最新の1.20.1 Forge版をDLする。特定fileIdのDLにはステップ5の `dl-specific.js` を使うこと
- modlicense.json のエントリはmodidのアルファベット順を維持する（update-modlicense.js が自動ソートする）
- サーバーディレクトリが既に存在し servermeta.json がある場合は新規作成をスキップする
- link.json の `manual.url` はスラッグベースの `https://www.curseforge.com/minecraft/mc-mods/{slug}/download/{fileId}` を使う（プロジェクトIDは不要）
