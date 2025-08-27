const fsp = require("node:fs/promises");
const path = require("node:path");
const unzipper = require("unzipper");

const ROOT = process.cwd();
const SERVER_DIR = path.join(ROOT, "servers");
const MODLICENSE_JSON_PATH = path.join(ROOT, "./scripts/modlicense.json");
const LICENSE_JSON_PATH = path.join(ROOT, "./scripts/license.json");
const jarModsTomlCache = new Map();

const jarSourceModids = new Set();

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
  while ((m = licRe.exec(text)) !== null) {
    if (m[1]) licenses.push(m[1].trim());
  }

  const idRe = /^\s*modId\s*=\s*["']([^"']+)["']/gim;
  while ((m = idRe.exec(text)) !== null) {
    if (m[1]) modids.push(m[1].trim());
  }

  const dnRe = /^\s*displayName\s*=\s*["']([^"']+)["']/im;
  m = dnRe.exec(text);
  if (m) displayName = m[1].trim();

  const auRe = /^\s*authors\s*=\s*["']([^"']+)["']/im;
  m = auRe.exec(text);
  if (m) authors = m[1].trim();

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
      try {
        t = buf.toString("utf8");
      } catch {}
      if (!/\w/.test(t)) t = buf.toString("latin1");
      return t;
    };

    try {
      const st = await fsp.stat(jarPath).catch(() => null);
      if (!st || !st.isFile() || st.size === 0) {
        if (!st) console.warn(`  -> SKIP (stat failed): ${jarPath}`);
        else console.warn(`  -> SKIP (empty jar): ${jarPath}`);
        return [];
      }
      const MAX_JAR_BYTES = 256 * 1024 * 1024;
      if (st.size > MAX_JAR_BYTES) {
        console.warn(`  -> SKIP (jar too large: ${st.size} bytes): ${jarPath}`);
        return [];
      }

      let buf;
      try {
        buf = await fsp.readFile(jarPath);
      } catch (e) {
        console.warn(`  -> SKIP (read error): ${jarPath} : ${e.message || e}`);
        return [];
      }
      if (!Buffer.isBuffer(buf) || buf.length === 0) return [];

      let dir;
      try {
        dir = await unzipper.Open.buffer(buf);
      } catch (e) {
        console.warn(`  -> SKIP (corrupt zip): ${jarPath} : ${e.message || e}`);
        return [];
      }

      const out = [];
      for (const f of dir.files) {
        if (path.basename(f.path).toLowerCase() !== "mods.toml") continue;

        try {
          const s = await f.stream();
          const acc = await new Promise((resolve) => {
            let a = Buffer.alloc(0);
            let timer = setTimeout(() => {
              try {
                s.destroy();
              } catch {}
              resolve(a);
            }, streamTimeoutMs);

            s.on("data", (chunk) => {
              a = Buffer.concat([a, chunk]);
              if (a.length > maxBytes) {
                try {
                  s.destroy();
                } catch {}
              }
            });
            s.on("end", () => {
              clearTimeout(timer);
              resolve(a);
            });
            s.on("close", () => {
              clearTimeout(timer);
              resolve(a);
            });
            s.on("error", () => {
              clearTimeout(timer);
              resolve(a);
            });
          });

          out.push({ name: f.path, text: toText(acc) });
        } catch (e) {
          console.warn(
            `  -> entry read error in ${jarPath}: ${e.message || e}`
          );
        }
      }

      return out;
    } catch (e) {
      console.warn(
        `  -> SKIP (unexpected error): ${jarPath} : ${e.message || e}`
      );
      return [];
    }
  })();

  jarModsTomlCache.set(jarPath, p);
  return p;
}

// forgemods 配下の .jar / link.json を収集
async function collectForgeModArtifacts(baseDir) {
  const fm = path.join(baseDir, "forgemods");
  if (!(await exists(fm))) return { jars: [], links: [] };

  const buckets = ["optionaloff", "optionalon", "required"];
  const dirs = [fm, ...buckets.map((b) => path.join(fm, b))];

  const jarSets = await Promise.all(dirs.map((d) => listJarFiles(d)));
  const linkSets = await Promise.all(dirs.map((d) => listLinkJsonFiles(d)));

  return { jars: jarSets.flat(), links: linkSets.flat() };
}

// link.json 解析
async function parseLinkJson(filePath) {
  try {
    const raw = await fsp.readFile(filePath, "utf8");
    const j = JSON.parse(raw);

    // modid 推定：id 形式 "group:artifact:version@jar"
    let modid = "";
    if (typeof j.id === "string" && j.id.includes(":")) {
      const parts = j.id.split(":");
      if (parts.length >= 2) modid = (parts[1] || "").trim();
    }
    // 予備: manual.name / name / ファイル名 から推定
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

    const license = (j?.artifact?.license || "").trim();
    if (!license) license = "Not specified";

    const displayName = (j?.name || "").trim() || modid;
    const authors = (j?.author || "").trim() || "<author>";

    return { modid, license, displayName, authors, ok: true };
  } catch (e) {
    console.warn(`  -> SKIP (bad link.json): ${filePath} : ${e.message || e}`);
    return { ok: false };
  }
}

// -------------------- main --------------------
async function main() {
  const [, , maybeName] = process.argv;

  // load existing modlicense.json
  let modlicenseTable = [];
  if (await exists(MODLICENSE_JSON_PATH)) {
    try {
      modlicenseTable = JSON.parse(
        await fsp.readFile(MODLICENSE_JSON_PATH, "utf8")
      );
    } catch {
      modlicenseTable = [];
    }
  }
  const modMap = new Map(
    modlicenseTable.map((m) => [
      m.modid,
      { license: String(m.license || ""), url: m.url ?? "" },
    ])
  );
  // load license attribute table
  if (!(await exists(LICENSE_JSON_PATH))) {
    console.error(`license.json が見つかりません: ${LICENSE_JSON_PATH}`);
    process.exit(1);
  }
  let licenseAttr = [];
  try {
    licenseAttr = JSON.parse(await fsp.readFile(LICENSE_JSON_PATH, "utf8"));
  } catch (e) {
    console.error(`license.json の読み込みに失敗: ${e.message}`);
    process.exit(1);
  }
  const licenseMap = new Map(
    licenseAttr.map((l) => [String(l.name || "").toLowerCase(), l])
  );

  // targets
  const targets = maybeName
    ? [path.join(SERVER_DIR, maybeName)]
    : await listDirs(SERVER_DIR);

  let touched = false;

  for (const target of targets) {
    const { jars, links } = await collectForgeModArtifacts(target);
    const seenModids = new Set();
    const metaByModid = new Map();

    // --- link.json を先に処理
    for (const link of links) {
      console.log(`\n[LINK] ${link}`);
      const info = await parseLinkJson(link);
      if (!info.ok) continue;

      const { modid, license, displayName, authors } = info;
      seenModids.add(modid);
      if (!metaByModid.has(modid))
        metaByModid.set(modid, { displayName, authors });

      const detectedLicense = (license || "").trim();
      const hasDetected =
        detectedLicense && detectedLicense.toLowerCase() !== "not specified";
      const rec = modMap.get(modid);
      const existing = rec?.license;

      if (existing !== undefined) {
        if (hasDetected) {
          if (
            existing === "unknown" ||
            existing === "Not specified" ||
            detectedLicense !== existing
          ) {
            console.log(
              `  -> UPDATE: modid=${modid} license: "${existing}" -> "${detectedLicense}"`
            );
            modMap.set(modid, {
              license: detectedLicense,
              url: rec?.url ?? "",
            });
            touched = true;
          } else {
            console.log(`  -> NO CHANGE: modid=${modid} license="${existing}"`);
          }
        } else {
          console.log(
            `  -> KEEP (no detected license): modid=${modid} license="${existing}"`
          );
        }
      } else {
        if (hasDetected) {
          console.log(`  -> ADD: modid=${modid} license="${detectedLicense}"`);
          modMap.set(modid, { license: detectedLicense, url: "" });
          touched = true;
        } else {
          console.log(`  -> ADD: modid=${modid} license="Not specified"`);
          modMap.set(modid, { license: "Not specified", url: "" });
          touched = true;
        }
      }
    }

    // --- JAR（mods.toml）処理
    for (const jar of jars) {
      console.log(`\n[JAR] ${jar}`);
      const items = await extractModsTomlFromJar(jar);

      if (items.length === 0) {
        console.log("  -> mods.toml が見つかりませんでした");
        continue;
      }

      for (const it of items) {
        const parsed = extractFromModsToml(it.text);
        const modid = (parsed.modids[0] || "").trim();
        const detectedLicense = (parsed.licenses[0] || "").trim();
        const hasDetected =
          detectedLicense && detectedLicense.toLowerCase() !== "not specified";
        const displayName = (parsed.displayName || "").trim();
        const authors = (parsed.authors || "").trim();

        if (!modid) {
          console.log("  -> mods.toml に modId が見つかりませんでした");
          continue;
        }

        jarSourceModids.add(modid);
        seenModids.add(modid);
        // 表示情報：mods.toml を優先（無ければ link.json → 既定値）
        const nowMeta = metaByModid.get(modid) || {};
        metaByModid.set(modid, {
          displayName: displayName || nowMeta.displayName || modid,
          authors: authors || nowMeta.authors || "<author>",
        });
        const rec = modMap.get(modid);
        const existing = rec?.license;

        if (existing !== undefined) {
          if (hasDetected) {
            if (
              existing === "unknown" ||
              existing === "Not specified" ||
              detectedLicense !== existing
            ) {
              console.log(
                `  -> UPDATE: modid=${modid} license: "${existing}" -> "${detectedLicense}"`
              );
              modMap.set(modid, {
                license: detectedLicense,
                url: rec?.url ?? "",
              });
              touched = true;
            } else {
              console.log(
                `  -> NO CHANGE: modid=${modid} license="${existing}"`
              );
            }
          } else {
            console.log(
              `  -> KEEP (no detected license): modid=${modid} license="${existing}"`
            );
          }
        } else {
          if (hasDetected) {
            console.log(
              `  -> ADD: modid=${modid} license="${detectedLicense}"`
            );
            modMap.set(modid, { license: detectedLicense, url: "" });
            touched = true;
          } else {
            console.log(`  -> ADD: modid=${modid} license="unknown"`);
            modMap.set(modid, { license: "unknown", url: "" });
            touched = true;
          }
        }
      }
    }

    // ---- サーバーごとの license.json / credit.txt を生成 ----
    const serverOut = [];
    const creditLines = [];

    for (const modid of seenModids) {
      const rec2 = modMap.get(modid) || { license: "", url: "" };
      const lic = String(rec2.license || "").trim();
      const attr = licenseMap.get(lic.toLowerCase()) || {
        shouldRightsNotation: true,
        canSecondaryDistribution: false,
        url: "",
      };
      const meta = metaByModid.get(modid) || {};
      const displayName = meta.displayName || modid;
      const authors = meta.authors || "<author>";
      const url = rec2.url?.trim() || "";

      let credit = "";

      if (attr.shouldRightsNotation) {
        credit = `${displayName} by ${authors} (${
          url || "<URL>"
        }) Licensed under ${lic}`;
      }
      serverOut.push({
        modid,
        license: lic,
        shouldRightsNotation: !!attr.shouldRightsNotation,
        canSecondaryDistribution: !!attr.canSecondaryDistribution,
        url: url,
        credit: credit,
      });

      if (attr.shouldRightsNotation) {
        creditLines.push(credit);
      }
    }

    const serverLicensePath = path.join(target, "license.json");
    await fsp.writeFile(
      serverLicensePath,
      JSON.stringify(serverOut, null, 4),
      "utf8"
    );
    console.log(`\n生成: ${serverLicensePath} （${serverOut.length} mods）`);

    if (creditLines.length > 0) {
      const creditPath = path.join(target, "credit.txt");
      await fsp.writeFile(creditPath, creditLines.join("\n"), "utf8");
      console.log(`生成: ${creditPath} （${creditLines.length} entries）`);
    }
  }

  // modlicense.json の書き戻し
  if (touched) {
    const outArr = Array.from(modMap.entries()).map(([modid, v]) => ({
      modid,
      license: v.license,
      url: v.url ?? "",
    }));
    await fsp.mkdir(path.dirname(MODLICENSE_JSON_PATH), { recursive: true });
    await fsp.writeFile(
      MODLICENSE_JSON_PATH,
      JSON.stringify(outArr, null, 4),
      "utf8"
    );
    console.log(`\nmodlicense.json を更新しました: ${MODLICENSE_JSON_PATH}`);
  } else {
    console.log(
      `\n新規追加/更新はありませんでした（modlicense.json は変更されていません）`
    );
  }

  // --- 警告: Not specified / unknown の MOD をリストアップ
  const unresolved = Array.from(modMap.entries())
    .filter(([_, v]) => {
      const lic = String(v.license || "");
      return (
        !lic ||
        lic.toLowerCase() === "not specified" ||
        lic.toLowerCase() === "unknown"
      );
    })
    .map(([modid, v]) => ({ modid, license: v.license }));
  if (unresolved.length > 0) {
    console.warn(
      "\n⚠️ 以下のMODはライセンスが不明 (Not specified / unknown) です:"
    );
    for (const u of unresolved) {
      console.warn(`  - ${u.modid} (license: ${u.license || "未指定"})`);
    }
  }

  // shouldRightsNotation が true かつ URL 未設定の MOD を警告
  const unlinked = Array.from(modMap.entries())
    .filter(([_, v]) => {
      const lic = String(v.license || "");
      const attr = licenseMap.get(lic.toLowerCase()) || {
        shouldRightsNotation: false,
      };
      const urlEmpty = !v.url || String(v.url).trim() === "";
      return attr.shouldRightsNotation && urlEmpty;
    })
    .map(([modid, v]) => ({ modid, license: v.license }));

  if (unlinked.length > 0) {
    console.warn(
      "\n⚠️ 以下のMODは権利表記が必要ですが URL が未表記です(modlicense.jsonに記載してください):"
    );
    for (const u of unlinked) {
      console.warn(`  - ${u.modid} (license: ${u.license || "未指定"})`);
    }
  }

  // --- 警告: JAR由来で二次配布禁止フラグ（canSecondaryDistribution: false）のMODをリストアップ
  const prohibited = Array.from(modMap.entries())
    .filter(([modid, v]) => {
      if (!jarSourceModids.has(modid)) return false; // JAR由来のみ対象
      const lic = String(v.license || "").toLowerCase();
      const attr = licenseMap.get(lic);
      return attr && attr.canSecondaryDistribution === false;
    })
    .map(([modid, v]) => ({ modid, license: v.license }));

  if (prohibited.length > 0) {
    console.warn(
      "\n⛔ 二次配布禁止（canSecondaryDistribution: false）が設定されたJAR由来のMOD:"
    );
    for (const p of prohibited) {
      console.warn(`  - ${p.modid} (license: ${p.license || "未指定"})`);
    }
  }

  // --- 警告: license.jsonに存在しない未知のライセンス
  const unknownLicenses = Array.from(modMap.entries())
    .filter(([_, v]) => {
      const lic = String(v.license || "").trim();
      if (!lic) return false;
      return !licenseMap.has(lic.toLowerCase()); // license.jsonに未登録
    })
    .map(([modid, v]) => ({ modid, license: v.license }));

  if (unknownLicenses.length > 0) {
    console.warn(
      "\n⚠️ 以下のMODは license.json に未登録のライセンスを検出しました（クレジット必須・二次配布禁止として扱います）:"
    );
    for (const u of unknownLicenses) {
      console.warn(`  - ${u.modid} (license: ${u.license || "未指定"})`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(99);
});
