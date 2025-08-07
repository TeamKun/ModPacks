**デプロイ方法**

http://redmine.lab.kunmc.net/redmine/projects/mod/wiki/%E6%B2%BC%E3%83%A9%E3%83%B3%E3%83%81%E3%83%A3%E3%83%BCMod%E3%83%87%E3%83%97%E3%83%AD%E3%82%A4%E6%96%B9%E6%B3%95

# 📦 Link Generator

Forge MOD の JAR ファイルから `Claritas.jar` を利用してメタ情報を抽出し、JSON 形式で保存する Node.js ツールです。

## ✅ 機能概要

- 指定した Forge MOD JAR ファイルに対して `Claritas.jar` を実行し、グループ名を取得
- `mods.toml` から `modId`, `version`, `displayName` を取得
- JAR のサイズ（バイト単位）と MD5 ハッシュを取得
- すべての情報を組み合わせて、`output/<ファイル名>.link.json` を生成

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

### 1. プロジェクトルートに `Claritas.jar` を配置

```
project-root/
├─ Claritas.jar
├─ index.js
├─ output/
├─ package.json
```

### 2. MOD JAR ファイルを指定して実行

```bash
npm start /path/to/modfile.jar
```

> `Claritas.jar` が自動で起動され、`output/<modfile>.link.json` が生成されます。

## 📂 出力先

- 出力ファイルは `output/` ディレクトリに保存されます
- ファイル名形式：`<JARファイル名>.link.json`

## ⚙️ 補足仕様

- `Claritas.jar` の実行結果（`output.json`）を元に `group` を自動で抽出
- `mods.toml` は `META-INF/mods.toml` に存在する前提
- 複数MODに対応する場合は `index.js` を拡張してください

## 🧪 開発・動作確認環境

- Node.js 18+
- Java 17+
