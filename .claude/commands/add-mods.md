# MODホワイトリスト追加

ユーザーから渡されたDiscordメッセージ（またはテキスト）に含まれるCurseForge URLを抽出し、`docs/modlicense.json` にMOD情報を追加・更新する。

## 入力

$ARGUMENTS

## 手順

### 1. URL抽出
入力テキストから `https://www.curseforge.com/minecraft/mc-mods/` で始まるURLを全て抽出する。

### 2. 既存チェック
各URLのslug部分（例: `spell-engine`）を使い、`docs/modlicense.json` 内に該当するmodidまたはURLが既に存在するか確認する（Grepで検索）。

### 3. MOD情報の取得
未登録のMODについて、以下の順序で情報を取得する：

1. **Modrinth API** で検索: `https://api.modrinth.com/v2/search?query=<slug>&facets=[["project_type:mod"]]&limit=5`
   - displayName, authors, license を取得
2. **GitHubリポジトリ** の `fabric.mod.json` から正確な modid を取得:
   - Modrinthのプロジェクト詳細やCurseForgeページからGitHubリンクを探す
   - `gh api` コマンドでリポジトリのファイルツリーを取得し、`fabric.mod.json` または `mods.toml` を読む
   - `fabric.mod.json` 内の `"id"` フィールドが正確な modid
3. GitHubが見つからない場合、jarファイル名やModrinthのslugからmodidを推定する

### 4. JSON追加
取得した情報を以下の形式で `docs/modlicense.json` に追加する：

```json
{
    "modid": "<fabric.mod.jsonのid>",
    "license": "<ライセンス名>",
    "url": "<CurseForge URL>",
    "authors": "<作者名>",
    "displayName": "<MOD表示名>",
    "ignore": false
}
```

**重要**: modid のアルファベット順を維持して挿入すること。

### 5. 検証
- `node -e "JSON.parse(require('fs').readFileSync('docs/modlicense.json','utf8')); console.log('Valid')"` でJSONの妥当性を検証
- 追加したエントリをGrepで表示して確認

### 6. 結果報告
追加・更新したMODの一覧を表形式で報告する：

| MOD名 | modid | ライセンス | 状態（新規/更新/既存） |
|-------|-------|----------|---------------------|

## 注意事項
- CurseForgeの直接フェッチは403になることが多いので、Modrinth APIとGitHubを優先して使う
- ライセンスはfabric.mod.jsonの値を優先する（Modrinthと異なる場合がある）
- modidはfabric.mod.jsonの `"id"` フィールドの値を使う（CurseForgeのslugではない）
- 既に登録済みのMODはスキップし、情報が不足している既存エントリは更新する
