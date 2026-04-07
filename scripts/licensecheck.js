const fsp = require("node:fs/promises");
const path = require("node:path");
const readline = require("node:readline");
const unzipper = require("unzipper");

const ROOT = process.cwd();
const SERVER_DIR = path.join(ROOT, "servers");

// ----- modlicense / license の候補（読み込みは ROOT 優先） -----
const ROOT_MODLICENSE = path.join(ROOT, "modlicense.json");
const DOCS_MODLICENSE = path.join(ROOT, "docs", "modlicense.json");
const ROOT_LICENSE = path.join(ROOT, "license.json");
const DOCS_LICENSE = path.join(ROOT, "docs", "license.json");

// 二次配布禁止 JAR の退避先 (../scripts/mods 相当)
const QUARANTINE_DIR = path.join(ROOT, "scripts", "mods");

const jarModsTomlCache = new Map();
let modMap = new Map();               // key: normalized modid -> {license,url,authors,displayName,ignore}
const jarSourceModids = new Set();    // normalized modid（JAR から見つかったものだけ）
const jarPathsByModid = new Map();    // normalized modid -> Set<jarPath>

// ---------- utils ----------
const normId = (s) => String(s || "").trim().toLowerCase();

// ライセンス名の表記揺れを正規名に変換
function normalizeLicense(raw) {
  const s = (raw || "").trim();
  if (!s) return "";
  const l = s.toLowerCase();
  if (l === "not specified" || l === "unknown") return s;
  // All Rights Reserved 系
  if (/\ball\s*rights?\s*reserved\b/i.test(s) || l === "arr") return "All Rights Reserved";
  // MIT
  if (/\bmit\b/i.test(s)) return "MIT";
  // Apache
  if (/apache/i.test(s)) return "Apache-2.0";
  // AGPL (LGPL より先に判定)
  if (/agpl|affero/i.test(s)) return "AGPL-3.0";
  // LGPL
  if (/lgpl|lesser.*general.*public/i.test(s)) return "LGPL-3.0";
  // GPL (LGPL/AGPL を除外済み)
  if (/\bgpl\b|general.*public.*licen/i.test(s)) return "GPL-3.0";
  // CC 系 (順序重要: 具体的→一般的)
  if (/cc.*by.*nc.*nd/i.test(s)) return "CC BY-NC-ND 4.0";
  if (/cc.*by.*nc.*sa/i.test(s)) return "CC BY-NC-SA 4.0";
  if (/cc.*by.*nc/i.test(s)) return "CC BY-NC 4.0";
  if (/cc.*by.*4/i.test(s) || /cc-by-4/i.test(s)) return "CC-BY-4.0";
  if (/cc0/i.test(s)) return "CC0-1.0";
  // MPL / EPL / BSD / CDDL
  if (/mpl.*2/i.test(s)) return "MPL-2.0";
  if (/epl.*2/i.test(s)) return "EPL-2.0";
  if (/bsd.*3/i.test(s)) return "BSD-3-Clause";
  if (/cddl/i.test(s)) return "CDDL-1.0";
  // Polyform
  if (/polyform.*noncommercial/i.test(s)) return "Polyform-Noncommercial-1.0.0";
  // Custom
  if (/\bcustom\b/i.test(s)) return "Custom License";
  // マッチしなければそのまま返す（個別ライセンスはlicense.jsonに残す）
  return s;
}

// 対話式プロンプト
function ask(rl, question) {
  return new Promise((resolve) => rl.question(question, (ans) => resolve(ans.trim())));
}
async function askYesNo(rl, question) {
  while (true) {
    const a = (await ask(rl, `${question} (y/n): `)).toLowerCase();
    if (a === "y" || a === "yes") return true;
    if (a === "n" || a === "no") return false;
    console.log("  y または n で回答してください。");
  }
}

const exists = async (p) => !!(await fsp.stat(p).catch(() => null));
const listDirs = async (dir) =>
  (await fsp.readdir(dir, { withFileTypes: true }))
    .filter((e) => e.isDirectory())
    .map((e) => path.join(dir, e.name));
const listFilesByExt = async (dir, ext) =>
  (await fsp.readdir(dir, { withFileTypes: true }).catch(() => []))
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(ext))
    .map((e) => path.join(dir, e.name));
const listJarFiles = (dir) => listFilesByExt(dir, ".jar");
const listLinkJsonFiles = (dir) => listFilesByExt(dir, "link.json");

function extractFromModsToml(text) {
  const licenses = [];
  const modids = [];
  let displayName = "";
  let authors = "";
  let m;

  const licRe = /^\s*license\s*=\s*["']([^"']+)["']/gim;
  while ((m = licRe.exec(text)) !== null) if (m[1]) licenses.push(m[1].trim());

  const idRe = /^\s*modId\s*=\s*["']([^"']+)["']/gim;
  while ((m = idRe.exec(text)) !== null) if (m[1]) modids.push(m[1].trim());

  const dnRe = /^\s*displayName\s*=\s*["']([^"']+)["']/im;
  if ((m = dnRe.exec(text))) displayName = m[1].trim();

  const auRe = /^\s*authors\s*=\s*["']([^"']+)["']/im;
  if ((m = auRe.exec(text))) authors = m[1].trim();

  return { licenses, modids, displayName, authors };
}

async function extractModsTomlFromJar(
  jarPath,
  maxBytes = 1024 * 1024,
  streamTimeoutMs = 30000
) {
  if (jarModsTomlCache.has(jarPath)) return jarModsTomlCache.get(jarPath);
  const p = (async () => {
    const toText = (buf) => {
      let t = "";
      try { t = buf.toString("utf8"); } catch {}
      if (!/\w/.test(t)) t = buf.toString("latin1");
      return t;
    };

    try {
      const st = await fsp.stat(jarPath).catch(() => null);
      if (!st || !st.isFile() || st.size === 0) {
        console.warn(!st ? `  -> SKIP (stat failed): ${jarPath}` : `  -> SKIP (empty jar): ${jarPath}`);
        return [];
      }
      const MAX_JAR_BYTES = 256 * 1024 * 1024;
      if (st.size > MAX_JAR_BYTES) {
        console.warn(`  -> SKIP (jar too large: ${st.size} bytes): ${jarPath}`);
        return [];
      }

      let buf;
      try { buf = await fsp.readFile(jarPath); }
      catch (e) { console.warn(`  -> SKIP (read error): ${jarPath} : ${e.message || e}`); return []; }
      if (!Buffer.isBuffer(buf) || buf.length === 0) return [];

      let dir;
      try { dir = await unzipper.Open.buffer(buf); }
      catch (e) { console.warn(`  -> SKIP (corrupt zip): ${jarPath} : ${e.message || e}`); return []; }

      const out = [];
      for (const f of dir.files) {
        if (path.basename(f.path).toLowerCase() !== "mods.toml") continue;
        try {
          const s = await f.stream();
          const acc = await new Promise((resolve) => {
            let a = Buffer.alloc(0);
            const timer = setTimeout(() => { try { s.destroy(); } catch {} resolve(a); }, streamTimeoutMs);
            s.on("data", (chunk) => {
              a = Buffer.concat([a, chunk]);
              if (a.length > maxBytes) { try { s.destroy(); } catch {} }
            });
            const done = () => { clearTimeout(timer); resolve(a); };
            s.on("end", done); s.on("close", done); s.on("error", done);
          });
          out.push({ name: f.path, text: toText(acc) });
        } catch (e) {
          console.warn(`  -> entry read error in ${jarPath}: ${e.message || e}`);
        }
      }
      return out;
    } catch (e) {
      console.warn(`  -> SKIP (unexpected error): ${jarPath} : ${e.message || e}`);
      return [];
    }
  })();
  jarModsTomlCache.set(jarPath, p);
  return p;
}

async function collectForgeModArtifacts(baseDir) {
  const fm = path.join(baseDir, "forgemods");
  if (!(await exists(fm))) return { jars: [], links: [] };
  const buckets = ["optionaloff", "optionalon", "required"];
  const dirs = [fm, ...buckets.map((b) => path.join(fm, b))];
  const jarSets = await Promise.all(dirs.map((d) => listJarFiles(d)));
  const linkSets = await Promise.all(dirs.map((d) => listLinkJsonFiles(d)));
  return { jars: jarSets.flat(), links: linkSets.flat() };
}

async function parseLinkJson(filePath) {
  try {
    const raw = await fsp.readFile(filePath, "utf8");
    const j = JSON.parse(raw);

    let modid = "";
    if (typeof j.id === "string" && j.id.includes(":")) {
      const parts = j.id.split(":");
      if (parts.length >= 2) modid = (parts[1] || "").trim();
    }
    if (!modid) {
      const manualName = j?.artifact?.manual?.name || "";
      const base = manualName.split("/").pop() || "";
      const guess = base
        .toLowerCase()
        .replace(/\.jar$/i, "")
        .replace(/[^a-z0-9_\-\.]/gi, "_");
      if (guess) modid = guess;
    }
    if (!modid && typeof j.name === "string") {
      modid = j.name.toLowerCase().replace(/[^\w\-\.]/g, "_");
    }
    if (!modid) modid = path.basename(filePath, ".link.json").toLowerCase();

    let license = (j?.artifact?.license || "").trim();
    if (!license) license = "Not specified";

    const displayName = (j?.name || "").trim() || modid;
    const authors = (j?.author || "").trim() || "<author>";

    return { modid, license, displayName, authors, ok: true };
  } catch (e) {
    console.warn(`  -> SKIP (bad link.json): ${filePath} : ${e.message || e}`);
    return { ok: false };
  }
}

// modMap を安全に更新（ignore は常に保持）
function upsertModRecord(modid, { license, url, authors, displayName, ignore }) {
  const k = normId(modid);
  const prev = modMap.get(k) || {};
  const next = {
    license: license ?? prev.license ?? "",
    url: url ?? prev.url ?? "",
    authors: authors ?? prev.authors ?? "",
    displayName: displayName ?? prev.displayName ?? "",
    ignore: typeof ignore === "boolean" ? ignore : !!prev.ignore, // ← 既存値を必ず保持
  };
  modMap.set(k, next);
}

const isIgnored = (modid) => !!(modMap.get(normId(modid))?.ignore);

async function moveFileSafe(src, destDir) {
  await fsp.mkdir(destDir, { recursive: true });
  const base = path.basename(src);
  let dest = path.join(destDir, base);
  let i = 1;
  while (await exists(dest)) {
    const ext = path.extname(base);
    const stem = path.basename(base, ext);
    dest = path.join(destDir, `${stem} (${i})${ext}`);
    i++;
  }
  try { await fsp.rename(src, dest); }
  catch (e) {
    if (e.code === "EXDEV") { await fsp.copyFile(src, dest); await fsp.unlink(src).catch(() => {}); }
    else { throw e; }
  }
  return dest;
}

async function readJsonSafely(p, fallback = []) {
  try { return JSON.parse(await fsp.readFile(p, "utf8")); }
  catch { return fallback; }
}

// -------------------- main --------------------
async function main() {
  const args = process.argv.slice(2);
  const scanAll = args.includes("-a");
  const maybeName = args.find(a => a !== "-a");

  // 1) modlicense.json 読み込み（ROOT 優先）
  let modlicenseSrc = (await exists(ROOT_MODLICENSE)) ? ROOT_MODLICENSE : DOCS_MODLICENSE;
  let modlicenseTable = (await exists(modlicenseSrc))
    ? await readJsonSafely(modlicenseSrc, [])
    : [];
  modMap = new Map(
    modlicenseTable.map((m) => [
      normId(m.modid),
      {
        license: normalizeLicense(String(m.license || "")),
        url: m.url ?? "",
        authors: m.authors ?? "",
        displayName: m.displayName ?? "",
        ignore: !!m.ignore, // 既定 false
      },
    ])
  );

  // 2) license.json 読み込み（ROOT 優先）
  const licenseSrc = (await exists(ROOT_LICENSE)) ? ROOT_LICENSE : DOCS_LICENSE;
  if (!(await exists(licenseSrc))) {
    console.error(`license.json が見つかりません: ${licenseSrc}`);
    process.exit(1);
  }
  const licenseAttr = await readJsonSafely(licenseSrc, []);
  const licenseMap = new Map(
    licenseAttr.map((l) => [String(l.name || "").toLowerCase(), l])
  );

  // 3) targets 収集
  const targets = scanAll
    ? await listDirs(SERVER_DIR)
    : [path.join(SERVER_DIR, maybeName || "0store-1.20.1")];

  let touched = false;

  // 4) 解析（modMap 更新は ignore を保持する）
  for (const target of targets) {
    const { jars, links } = await collectForgeModArtifacts(target);
    const seenModids = new Set();       // normalized
    const metaByModid = new Map();      // normalized -> {displayName, authors}

    // link.json
    for (const link of links) {
      console.log(`\n[LINK] ${link}`);
      const info = await parseLinkJson(link);
      if (!info.ok) continue;

      const k = normId(info.modid);
      const displayName = (info.displayName || "").trim() || k;
      const authors = (info.authors || "").trim() || "<author>";
      const detectedLicense = normalizeLicense((info.license || "").trim());
      const hasDetected = detectedLicense && detectedLicense.toLowerCase() !== "not specified";

      seenModids.add(k);
      if (!metaByModid.has(k)) metaByModid.set(k, { displayName, authors });

      const rec = modMap.get(k);
      const existing = rec?.license;

      if (existing !== undefined) {
        if (hasDetected && (existing === "unknown" || existing === "Not specified" || detectedLicense !== existing)) {
          console.log(`  -> UPDATE: modid=${k} license: "${existing}" -> "${detectedLicense}"`);
          upsertModRecord(k, { license: detectedLicense, url: rec?.url ?? "", authors, displayName });
          touched = true;
        } else {
          console.log(`  -> NO CHANGE/KEEP: modid=${k} license="${existing ?? "(none)"}"`);
          upsertModRecord(k, { authors, displayName });
        }
      } else {
        const licToSet = hasDetected ? detectedLicense : "Not specified";
        console.log(`  -> ADD: modid=${k} license="${licToSet}"`);
        upsertModRecord(k, { license: licToSet, url: "", authors, displayName });
        touched = true;
      }
    }

    // JAR
    for (const jar of jars) {
      console.log(`\n[JAR] ${jar}`);
      const items = await extractModsTomlFromJar(jar);
      if (items.length === 0) { console.log("  -> mods.toml が見つかりませんでした"); continue; }

      for (const it of items) {
        const parsed = extractFromModsToml(it.text);
        const k = normId(parsed.modids[0] || "");
        const detectedLicense = normalizeLicense((parsed.licenses[0] || "").trim());
        const hasDetected = detectedLicense && detectedLicense.toLowerCase() !== "not specified";
        const displayName = (parsed.displayName || "").trim();
        const authors = (parsed.authors || "").trim();
        if (!k) { console.log("  -> mods.toml に modId が見つかりませんでした"); continue; }

        if (!jarPathsByModid.has(k)) jarPathsByModid.set(k, new Set());
        jarPathsByModid.get(k).add(jar);
        jarSourceModids.add(k);
        seenModids.add(k);

        const nowMeta = metaByModid.get(k) || {};
        metaByModid.set(k, {
          displayName: displayName || nowMeta.displayName || k,
          authors: authors || nowMeta.authors || "<author>",
        });

        const rec = modMap.get(k);
        const existing = rec?.license;

        if (existing !== undefined) {
          if (hasDetected && (existing === "unknown" || existing === "Not specified" || detectedLicense !== existing)) {
            console.log(`  -> UPDATE: modid=${k} license: "${existing}" -> "${detectedLicense}"`);
            upsertModRecord(k, { license: detectedLicense, url: rec?.url ?? "", authors, displayName });
            touched = true;
          } else {
            console.log(`  -> NO CHANGE/KEEP: modid=${k} license="${existing ?? "(none)"}"`);
            upsertModRecord(k, { authors, displayName });
          }
        } else {
          const licToSet = hasDetected ? detectedLicense : "unknown";
          console.log(`  -> ADD: modid=${k} license="${licToSet}"`);
          upsertModRecord(k, { license: licToSet, url: "", authors, displayName });
          touched = true;
        }
      }
    }

  }

  // 5) —— ここが重要：判定（警告／移動）は “書き戻し前” にやる —— //

  // 未解決
  const unresolved = Array.from(modMap.entries())
    .filter(([modid, v]) => {
      if (isIgnored(modid)) return false;
      const lic = String(v.license || "");
      return !lic || lic.toLowerCase() === "not specified" || lic.toLowerCase() === "unknown";
    })
    .map(([modid, v]) => ({ modid, license: v.license }));
  if (unresolved.length > 0) {
    console.warn("\n⚠️ ライセンス不明 (Not specified / unknown):");
    for (const u of unresolved) console.warn(`  - ${u.modid} (license: ${u.license || "未指定"})`);
  }

  // URL 未設定
  const unlinked = Array.from(modMap.entries())
    .filter(([modid, v]) => {
      if (isIgnored(modid)) return false;
      const lic = String(v.license || "");
      const attr = licenseMap.get(lic.toLowerCase()) || { shouldRightsNotation: false };
      const urlEmpty = !v.url || String(v.url).trim() === "";
      return attr.shouldRightsNotation && urlEmpty;
    })
    .map(([modid, v]) => ({ modid, license: v.license }));
  if (unlinked.length > 0) {
    console.warn("\n⚠️ 権利表記が必要だが URL 未設定:");
    for (const u of unlinked) console.warn(`  - ${u.modid} (license: ${u.license || "未指定"})`);
  }

  // 二次配布禁止（JAR 由来のみ）
  const prohibited = Array.from(modMap.entries())
    .filter(([modid, v]) => {
      if (isIgnored(modid)) return false;                // ← ignore の最優先スキップ
      if (!jarSourceModids.has(normId(modid))) return false;
      const lic = String(v.license || "").toLowerCase();
      const attr = licenseMap.get(lic);
      return attr && attr.canSecondaryDistribution === false;
    })
    .map(([modid, v]) => ({ modid, license: v.license }));

  if (prohibited.length > 0) {
    console.warn("\n⛔ 二次配布禁止（canSecondaryDistribution: false）の JAR:");
    for (const p of prohibited) {
      const rec = modMap.get(normId(p.modid));
      const lic = String(rec?.license || "").toLowerCase();
      const attr = licenseMap.get(lic);
      console.warn(`  - ${p.modid} (license: ${p.license || "未指定"}) ignore=${!!rec?.ignore} canSecondaryDistribution=${String(attr?.canSecondaryDistribution)}`);
    }
  }

  // 退避（移動）— ignore を再確認してから実施
  if (prohibited.length > 0) {
    console.warn(`\n🚚 二次配布禁止と判定された JAR を "${QUARANTINE_DIR}" に移動します...`);
    for (const p of prohibited) {
      const k = normId(p.modid);
      if (isIgnored(k)) {   // 二重チェック
        console.warn(`  -> ignore=true のため移動スキップ: ${k}`);
        continue;
      }
      const jarSet = jarPathsByModid.get(k);
      if (!jarSet || jarSet.size === 0) {
        console.warn(`  -> JAR パス不明のためスキップ: ${k}`);
        continue;
      }
      for (const jarPath of jarSet) {
        try {
          if (!(await exists(jarPath))) {
            console.warn(`  -> 既に存在しないためスキップ: ${jarPath}`);
            continue;
          }
          const movedTo = await moveFileSafe(jarPath, QUARANTINE_DIR);
          console.warn(`  -> 移動: ${jarPath} -> ${movedTo}`);
        } catch (e) {
          console.warn(`  -> 移動失敗: ${jarPath} : ${e && e.message ? e.message : e}`);
        }
      }
    }
  }

  // 未知ライセンス — 対話形式で登録
  const unknownLicNames = new Set();
  const modsByUnknownLic = new Map(); // licName -> [modid, ...]
  for (const [modid, v] of modMap.entries()) {
    if (isIgnored(modid)) continue;
    const lic = String(v.license || "").trim();
    if (!lic) continue;
    if (!licenseMap.has(lic.toLowerCase())) {
      unknownLicNames.add(lic);
      if (!modsByUnknownLic.has(lic)) modsByUnknownLic.set(lic, []);
      modsByUnknownLic.get(lic).push(modid);
    }
  }

  if (unknownLicNames.size > 0) {
    console.warn("\n⚠️ license.json に未登録のライセンスが見つかりました:");
    for (const name of unknownLicNames) {
      const mods = modsByUnknownLic.get(name) || [];
      console.warn(`  - ${name} (${mods.join(", ")})`);
    }

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const newEntries = [];
    try {
      for (const name of unknownLicNames) {
        const mods = modsByUnknownLic.get(name) || [];
        console.log(`\n--- ライセンス登録: "${name}" ---`);
        console.log(`  対象MOD: ${mods.join(", ")}`);
        const canDist = await askYesNo(rl, "  二次配布を許可しますか？");
        const shouldNotation = await askYesNo(rl, "  権利表記は必要ですか？");
        const entry = {
          name,
          canSecondaryDistribution: canDist,
          shouldRightsNotation: shouldNotation,
        };
        newEntries.push(entry);
        licenseMap.set(name.toLowerCase(), entry);
        console.log(`  -> 登録: canSecondaryDistribution=${canDist}, shouldRightsNotation=${shouldNotation}`);

        // MODごとに ignore を確認
        for (const modid of mods) {
          const shouldIgnore = await askYesNo(rl, `  "${modid}" を ignore（警告・退避をスキップ）しますか？`);
          if (shouldIgnore) {
            upsertModRecord(modid, { ignore: true });
            touched = true;
            console.log(`  -> ${modid}: ignore=true`);
          }
        }
      }
    } finally {
      rl.close();
    }

    // license.json に追記保存
    if (newEntries.length > 0) {
      const saveLicPath = (await exists(ROOT_LICENSE)) ? ROOT_LICENSE : DOCS_LICENSE;
      const current = await readJsonSafely(saveLicPath, []);
      current.push(...newEntries);
      await fsp.writeFile(saveLicPath, JSON.stringify(current, null, 2), "utf8");
      console.log(`\nlicense.json に ${newEntries.length} 件追加しました: ${saveLicPath}`);
    }
  }

  // 6) modlicense.json の書き戻し（最後に一括・ignore を保持）
  if (touched) {
    const outArr = Array.from(modMap.entries())
      .map(([modid, v]) => ({
        modid,
        license: v.license,
        url: v.url ?? "",
        authors: v.authors ?? "",
        displayName: v.displayName ?? "",
        ignore: !!v.ignore,
      }))
      .sort((a, b) => a.modid.localeCompare(b.modid));
    const savePath = (await exists(ROOT_MODLICENSE)) ? ROOT_MODLICENSE : DOCS_MODLICENSE;
    await fsp.mkdir(path.dirname(savePath), { recursive: true });
    await fsp.writeFile(savePath, JSON.stringify(outArr, null, 4), "utf8");
    console.log(`\nmodlicense.json を更新しました: ${savePath}`);
  } else {
    console.log(`\n新規追加/更新はありませんでした（modlicense.json は変更されていません）`);
  }

}

main().catch((e) => {
  console.error(e);
  process.exit(99);
});
