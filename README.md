**デプロイ方法**

http://redmine.lab.kunmc.net/redmine/projects/mod/wiki/%E6%B2%BC%E3%83%A9%E3%83%B3%E3%83%81%E3%83%A3%E3%83%BCMod%E3%83%87%E3%83%97%E3%83%AD%E3%82%A4%E6%96%B9%E6%B3%95

# 📦 link.jsonジェネレーター

Forge MOD の JAR ファイルから `Claritas.jar` を利用してメタ情報を抽出し、JSON 形式で保存する Node.js ツールです。

## ✅ 機能概要

- 指定した Forge MOD JAR ファイルに対して `Claritas.jar` を実行し、グループ名を取得
- `mods.toml` から `modId`, `version`, `displayName` を取得
- JAR のサイズ（バイト単位）と MD5 ハッシュを取得
- すべての情報を組み合わせて、`output/<ファイル名>.link.json` を生成
- mods.tomlを含むjarファイルにのみ対応。リソースパックなどは手動で作成してください

## 📁 出力形式

```json
{
  "id": "dev.imb11.loader:mru:1.0.4@jar",
  "name": "MRU",
  "type": "ForgeMod",
  "artifact": {
    "size": 123456,
    "MD5": "abcdef1234567890abcdef1234567890",
    "url": "",
    "manual": {
      "url": "",
      "name": ""
    }
  }
}
```

## 🚀 セットアップ

### 1. Node.js をインストール（未インストールの場合）

- [Node.js 公式サイト](https://nodejs.org/) より最新版をダウンロードしてインストール

### 2. パッケージのインストール

```bash
npm install
```

## 🏁 使い方

### 1. MODのjarを配置

- script/modsフォルダに対象のjarファイルを配置(ない場合は手動で作る)

### 2. コマンド実行

```bash
npm run generate
```

- scripts/outputに<modName>.link.jsonが生成されます

### 3. DLリンク記載

- 生成されたjsonのmanual.url部分にCurseForgeなどのDLページのURLを記載して完成

# 📦 ライセンスチェッカー＆クレジットジェネレーター

Forge MOD の JAR ファイルから ライセンス情報を読み取り、配布可否のチェックと[クレジットページ](https://teamkun.github.io/ModPacks/)への追加を行います。

## ✅ 機能概要

- 指定した MODパック のjarファイルのmods.tomlを読み取り license を取得
- 読みよとった　license　ライセンスをもとに二次配布の可否、クレジット記載の要不要を判定
- パック内に二次配布負荷のMODがある場合、コマンドラインに警告を表示します(link.jsonの形式に直してください)
- クレジット記載の必要があるMODの場合クレジットを自動表記し[クレジットページ](https://teamkun.github.io/ModPacks/)に反映します。
- mods.tomlを含むjarファイルにのみ対応

## 🚀 セットアップ

### 1. Node.js をインストール（未インストールの場合）

- [Node.js 公式サイト](https://nodejs.org/) より最新版をダウンロードしてインストール

### 2. パッケージのインストール

```bash
npm install
```

## 🏁 使い方

### コマンド実行

```bash
npm run license < modpack >
```

sample
```bash
npm run license local-1.20.1
```

- < modpack > は/servers/< packName >のpackName部分です
- < modpack >を指定しない場合すべてのパックをスキャンします

### 二次配布禁止の警告が出た場合

- 対象のjarファイルをパックから/scripts/modsに移動されます。link.jsonに置き換えて再実行してください

### URLの記載を要求された場合

- 権利表記の際に必要なURL情報が欠落している状態です
- scripts/modlicens.jsonを開き、対象modオブジェクトの"url"欄にMODの公開ページのURLを入力し再実行してください

### 未登録のライセンスを検出しましたと出た場合

- 検出したライセンスがscripts/license.jsonに登録されていない状態です
- 該当のライセンスのない内容を調べて手動でlicense.jsonにオブジェクトを追加して再実行してください

#### license.json例
```json

  {
    "name": "LGPL-v3", // ライセンス名
    "canSecondaryDistribution": true, // 二次配布可否 true: 可 false: 不可
    "shouldRightsNotation": false　// クレジット記載の要不要
  }
```

### MOD以外のファイルのクレジットを表記する

- リソースパックなどをクレジットページに追加したい場合、/script/modlicense.jsonに直接オブジェクトを記載してコマンドを実行してください

#### modlicense.json例
```json

    {
        "modid": "リソースパック名",
        "license": "ライセンス名",
        "url": "配布元URL",
        "authors": "著者",
        "displayName": "リソースパック名",
        "ignore": false
    },
```

### ライセンスチェックを無視する

- 参加勢が制作したものなど権利者からの許可が取れているものをチェック対象外にする機能です
- /script/modlicense.jsonから該当のオブジェクトを見つけて"ignore"の欄をtrueに変更してください