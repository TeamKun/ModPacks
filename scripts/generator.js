const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const crypto = require("crypto");
const AdmZip = require("adm-zip");
const toml = require("@iarna/toml");

const claritasJar = path.resolve("./scripts/Claritas.jar");
const modsDir = path.resolve("./scripts/mods");
const outputDir = path.resolve("./scripts/output");

if (!fs.existsSync(claritasJar)) {
  console.error("❌ Claritas.jar がプロジェクトルートに存在しません");
  process.exit(1);
}

if (!fs.existsSync(modsDir)) {
  console.error("❌ mods ディレクトリが存在しません");
  process.exit(1);
}

if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir);
}

// modsディレクトリ内の .jar ファイル一覧を取得
const jarFiles = fs.readdirSync(modsDir).filter((f) => f.endsWith(".jar"));

if (jarFiles.length === 0) {
  console.log("🔍 処理対象の JAR ファイルが見つかりませんでした");
  process.exit(0);
}

// fabric.mod.json は description 等に生の改行を含むことがあり厳密なJSONとして不正な場合がある。
// Fabric ローダー自体は許容するため、文字列内の制御文字をエスケープしてから読む。
function parseLenientJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    let out = "";
    let inString = false;
    let escaped = false;
    for (const ch of text) {
      if (escaped) {
        out += ch;
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        out += ch;
        escaped = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        out += ch;
        continue;
      }
      if (inString && ch < " ") {
        if (ch === "\n") out += "\\n";
        else if (ch === "\r") out += "\\r";
        else if (ch === "\t") out += "\\t";
        else out += "\\u" + ch.charCodeAt(0).toString(16).padStart(4, "0");
        continue;
      }
      out += ch;
    }
    return JSON.parse(out);
  }
}

// fabric.mod.json の authors は ["名前"] か [{ name: "名前" }] の両方がある
function fabricAuthors(raw) {
  if (!raw) return "";
  const arr = Array.isArray(raw) ? raw : [raw];
  return arr
    .map((a) => (typeof a === "string" ? a : String(a && a.name ? a.name : "")))
    .filter(Boolean)
    .join(", ");
}

// fabric.mod.json の license は文字列か配列
function fabricLicense(raw) {
  if (!raw) return "";
  return (Array.isArray(raw) ? raw : [raw]).map(String).join(", ").trim();
}

// 最終手段: JAR内の .class の共通パッケージから group を推定する
// (例: net.dnlayu.fastboot.* / modId=fastboot -> net.dnlayu)
function inferGroupFromClasses(zip, modId) {
  const pkgs = zip
    .getEntries()
    .map((e) => e.entryName)
    .filter((n) => n.endsWith(".class") && n.includes("/"))
    .map((n) => n.split("/").slice(0, -1));
  if (pkgs.length === 0) return null;

  // 全クラスに共通する先頭パッケージを求める
  let common = pkgs[0];
  for (const p of pkgs.slice(1)) {
    let i = 0;
    while (i < common.length && i < p.length && common[i] === p[i]) i++;
    common = common.slice(0, i);
    if (common.length === 0) return null;
  }

  if (common[common.length - 1].toLowerCase() === modId.toLowerCase()) {
    common = common.slice(0, -1);
  }
  return common.length > 0 ? common.join(".") : null;
}

// Claritas は FORGE しか解析できないため、Fabric MOD の group は
// エントリポイントのパッケージ名から推定する (例: dev.emi.emi.EmiMain -> dev.emi)
function fabricGroup(meta, modId, zip) {
  const eps = meta.entrypoints || {};
  const classes = []
    .concat(eps.main || [], eps.client || [], eps.server || [])
    .map((e) => (typeof e === "string" ? e : e && e.value))
    .filter((v) => typeof v === "string" && v.includes("."));

  if (classes.length > 0) {
    const parts = classes[0].split(".");
    parts.pop(); // クラス名を除去
    // 末尾が modId と同じならパッケージの一段上を group とみなす
    if (parts.length > 1 && parts[parts.length - 1].toLowerCase() === modId.toLowerCase()) {
      parts.pop();
    }
    if (parts.length > 0) return parts.join(".");
  }

  // フォールバック: mixin 設定の package
  const mixinFiles = (Array.isArray(meta.mixins) ? meta.mixins : [])
    .map((m) => (typeof m === "string" ? m : m && m.config))
    .filter(Boolean);
  for (const mf of mixinFiles) {
    const entry = zip.getEntry(mf);
    if (!entry) continue;
    try {
      const pkg = JSON.parse(entry.getData().toString("utf-8")).package;
      if (pkg) {
        const parts = String(pkg).split(".");
        if (parts[parts.length - 1] === "mixin" || parts[parts.length - 1] === "mixins") parts.pop();
        if (parts.length > 1 && parts[parts.length - 1].toLowerCase() === modId.toLowerCase()) {
          parts.pop();
        }
        if (parts.length > 0) return parts.join(".");
      }
    } catch {
      /* 無視 */
    }
  }

  return modId;
}

for (const file of jarFiles) {
  const jarPath = path.join(modsDir, file);
  console.log(`🛠 処理中: ${file}`);

  // 先にJARを開いてローダー種別を判定する
  const zip = new AdmZip(jarPath);
  const modsTmlEntry =
    zip.getEntry("META-INF/mods.toml") ||
    zip.getEntry("META-INF/neoforge.mods.toml");
  const fabricEntry =
    zip.getEntry("fabric.mod.json") || zip.getEntry("quilt.mod.json");

  if (!modsTmlEntry && !fabricEntry) {
    console.error(
      "❌ mods.toml / neoforge.mods.toml / fabric.mod.json が見つかりません"
    );
    continue;
  }

  // mods.toml と fabric.mod.json を両方持つマルチローダーJARは、
  // まず Forge として扱い、Claritas が group を解けなければ Fabric に切り替える。
  let isFabric = !modsTmlEntry;
  const outputJsonPath = path.resolve("output.json");
  let group = null;

  // Claritas は LibraryType が FORGE のみのため、Forge/NeoForge の場合だけ実行する
  if (!isFabric) {
    // 前回実行分が残っていると誤った group を拾うので消しておく
    if (fs.existsSync(outputJsonPath)) fs.unlinkSync(outputJsonPath);

    const claritasResult = spawnSync(
      "java",
      [
        "-jar",
        claritasJar,
        "--absoluteJarPaths",
        jarPath,
        "--libraryType",
        "FORGE",
        "--mcVersion",
        "1.20.1",
      ],
      { encoding: "utf-8" }
    );

    let claritasFailure = null;
    if (claritasResult.error) {
      claritasFailure = `Claritas 実行エラー: ${claritasResult.error.message}`;
    } else if (!fs.existsSync(outputJsonPath)) {
      claritasFailure = "output.json が生成されませんでした";
    } else {
      const outputData = JSON.parse(fs.readFileSync(outputJsonPath, "utf-8"));
      const groupEntry = Object.values(outputData).find((entry) => entry.group);
      if (!groupEntry) claritasFailure = "group 情報が output.json に見つかりません";
      else group = groupEntry.group;
    }

    if (claritasFailure) {
      if (fabricEntry) {
        console.warn(`⚠️ ${claritasFailure} -> fabric.mod.json で処理します`);
        isFabric = true;
      } else {
        // group は modId 確定後にパッケージ構造から推定する
        console.warn(`⚠️ ${claritasFailure} -> パッケージ構造から group を推定します`);
      }
    }
  }

  let modId, version, displayName, author, license;

  if (isFabric) {
    // fabric.mod.json / quilt.mod.json 読み取り
    let fabricMeta;
    try {
      fabricMeta = parseLenientJson(fabricEntry.getData().toString("utf-8"));
    } catch (e) {
      console.error(`❌ fabric.mod.json のパースに失敗: ${e.message}`);
      continue;
    }

    // quilt.mod.json は quilt_loader 配下に同等の情報を持つ
    const meta = fabricMeta.quilt_loader || fabricMeta;
    const md = meta.metadata || {};

    modId = String(meta.id || "").trim();
    version = String(meta.version || "").trim();
    displayName = String(
      meta.name || md.name || modId || path.basename(file, ".jar")
    ).trim();
    author = fabricAuthors(meta.authors || md.contributors);
    license = fabricLicense(meta.license || md.license);

    if (!modId) {
      console.error("❌ fabric.mod.json に id が見つかりません");
      continue;
    }

    group = fabricGroup(meta, modId, zip);
  } else {
    // mods.toml 読み取り (Forge: mods.toml / NeoForge: neoforge.mods.toml)
    const modsTmlContent = modsTmlEntry.getData().toString("utf-8");
    let parsed;
    try {
      parsed = toml.parse(modsTmlContent);
    } catch (e) {
      console.error(`❌ mods.toml のパースに失敗: ${e.message}`);
      continue;
    }

    const mod = Array.isArray(parsed.mods) ? parsed.mods[0] : parsed.mods;
    if (!mod) {
      console.error("❌ mods.toml に mods セクションが見つかりません");
      continue;
    }

    modId = String(mod.modId || "").trim();
    version = String(mod.version || "").trim();
    displayName = String(
      mod.displayName || modId || path.basename(file, ".jar")
    ).trim();

    // 追加: author / license 取得
    const authorFromMods = (
      mod.authors != null ? String(mod.authors) : ""
    ).trim();
    const authorFromRoot = (
      parsed.authors != null ? String(parsed.authors) : ""
    ).trim();
    author = authorFromMods || authorFromRoot || ""; // 空なら下流で <author>

    // Forge の慣例ではライセンスはルートにあることが多い
    const licenseFromRoot = (
      parsed.license != null ? String(parsed.license) : ""
    ).trim();
    const licenseFromMods = (
      mod.license != null ? String(mod.license) : ""
    ).trim();
    license = licenseFromRoot || licenseFromMods || ""; // 空なら下流で Not specified
  }

  // Claritas が group を解決できなかった Forge MOD の最終フォールバック
  if (!group) {
    group = inferGroupFromClasses(zip, modId);
    if (!group) {
      console.error("❌ group を特定できませんでした");
      continue;
    }
    console.log(`   推定した group: ${group}`);
  }

  // JARのサイズ/MD5
  const buffer = fs.readFileSync(jarPath);
  const size = buffer.length;
  const md5 = crypto.createHash("md5").update(buffer).digest("hex");

  const result = {
    id: `${group}:${modId}:${version}@jar`,
    name: displayName,
    author: author,
    type: isFabric ? "FabricMod" : "ForgeMod",
    artifact: {
      size: size,
      MD5: md5,
      url: "",
      license: license,
      manual: {
        url: "",
        name: path.basename(file),
      },
    },
  };

  const outName = path.basename(file, ".jar") + ".link.json";
  const outPath = path.join(outputDir, outName);
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2));
  console.log(`✅ 出力完了: ${outPath}`);
}

console.log("🎉 全てのMOD処理が完了しました");
