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

for (const file of jarFiles) {
  const jarPath = path.join(modsDir, file);
  console.log(`🛠 処理中: ${file}`);

  // Claritas.jar 実行
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

  if (claritasResult.error) {
    console.error(`❌ Claritas 実行エラー: ${claritasResult.error.message}`);
    continue;
  }

  const outputJsonPath = path.resolve("output.json");
  if (!fs.existsSync(outputJsonPath)) {
    console.error(`❌ output.json が生成されませんでした`);
    continue;
  }

  const outputData = JSON.parse(fs.readFileSync(outputJsonPath, "utf-8"));
  const groupEntry = Object.values(outputData).find((entry) => entry.group);
  if (!groupEntry) {
    console.error(`❌ group 情報が output.json に見つかりません`);
    continue;
  }
  const group = groupEntry.group;

  // mods.toml 読み取り
  const zip = new AdmZip(jarPath);
  const modsTmlEntry = zip.getEntry("META-INF/mods.toml");
  if (!modsTmlEntry) {
    console.error("❌ mods.toml が見つかりません");
    continue;
  }

  const modsTmlContent = modsTmlEntry.getData().toString("utf-8");
  const parsed = toml.parse(modsTmlContent);
  const mod = Array.isArray(parsed.mods) ? parsed.mods[0] : parsed.mods;
  const modId = mod.modId;
  const version = mod.version;
  const displayName = mod.displayName || modId;

  const buffer = fs.readFileSync(jarPath);
  const size = buffer.length;
  const md5 = crypto.createHash("md5").update(buffer).digest("hex");

  const result = {
    id: `${group}:${modId}:${version}@jar`,
    name: displayName,
    type: "ForgeMod",
    artifact: {
      size: size,
      MD5: md5,
      url: "",
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
