/**
 * link.json + check-result.json + dl-result.json を読み込んで
 * modlicense.json を更新するスクリプト
 */
const fs = require("fs");
const path = require("path");

const OUTPUT_DIR = path.resolve(__dirname, "output");
const DL_RESULT = path.resolve(__dirname, "dl-result.json");
const CHECK_RESULT = "D:/Users/Owner/Downloads/check-result.json";
const MODLICENSE = path.resolve(__dirname, "..", "docs", "modlicense.json");

// ライセンス正規化
function normalizeLicense(raw) {
  const s = (raw || "").trim();
  if (!s) return "";
  if (/\ball\s*rights?\s*reserved\b/i.test(s) || s.toLowerCase() === "arr")
    return "All Rights Reserved";
  if (/\bmit\b/i.test(s)) return "MIT";
  if (/apache/i.test(s)) return "Apache-2.0";
  if (/lgpl|lesser.*general.*public/i.test(s)) return "LGPL-3.0";
  if (/agpl|affero/i.test(s)) return "AGPL-3.0";
  if (/\bgpl\b|general.*public.*licen/i.test(s)) return "GPL-3.0";
  if (/cc.*by.*nc.*nd/i.test(s)) return "CC BY-NC-ND 4.0";
  if (/cc.*by.*nc.*sa/i.test(s)) return "CC BY-NC-SA 4.0";
  if (/cc.*by.*nc/i.test(s)) return "CC BY-NC 4.0";
  if (/cc0/i.test(s)) return "CC0-1.0";
  if (/mpl.*2/i.test(s)) return "MPL-2.0";
  return s;
}

function main() {
  // 1) Read all link.json files
  const linkFiles = fs
    .readdirSync(OUTPUT_DIR)
    .filter((f) => f.endsWith(".link.json"));

  // 2) Read dl-result.json & check-result.json
  const dlResult = JSON.parse(fs.readFileSync(DL_RESULT, "utf8"));
  const checkResult = JSON.parse(fs.readFileSync(CHECK_RESULT, "utf8"));

  // 3) Map jar filename -> CurseForge URL
  const jarToUrl = new Map();
  for (const dl of dlResult) {
    if (dl.status === "ok") {
      const entry = checkResult.find((e) =>
        e.curseforgeUrl.endsWith("/" + dl.slug)
      );
      if (entry) {
        const base = dl.file.replace(/\.jar$/i, "");
        jarToUrl.set(base, entry.curseforgeUrl);
      }
    }
  }

  // 4) Read modlicense.json
  const modlicense = JSON.parse(fs.readFileSync(MODLICENSE, "utf8"));
  const modMap = new Map(modlicense.map((m) => [m.modid.toLowerCase(), m]));

  // 5) Process link.json files
  let addCount = 0;
  let updateCount = 0;

  for (const f of linkFiles) {
    const linkData = JSON.parse(
      fs.readFileSync(path.join(OUTPUT_DIR, f), "utf8")
    );
    const parts = (linkData.id || "").split(":");
    const modid = parts.length >= 2 ? parts[1] : "";
    if (!modid) continue;

    const jarBase = f.replace(".link.json", "");
    const cfUrl = jarToUrl.get(jarBase) || "";
    const license = normalizeLicense(
      linkData.artifact?.license || "Not specified"
    );
    const author = (linkData.author || "").trim() || "<author>";
    const displayName = (linkData.name || "").trim() || modid;

    const existing = modMap.get(modid.toLowerCase());

    if (existing) {
      let changed = false;
      // Update URL if empty
      if ((!existing.url || existing.url === "") && cfUrl) {
        existing.url = cfUrl;
        changed = true;
      }
      // Update authors if placeholder
      if (
        (!existing.authors || existing.authors === "<author>") &&
        author !== "<author>"
      ) {
        existing.authors = author;
        changed = true;
      }
      // Update displayName if empty
      if (!existing.displayName && displayName) {
        existing.displayName = displayName;
        changed = true;
      }
      if (changed) {
        updateCount++;
        console.log(`UPDATE: ${modid} (url=${cfUrl ? "yes" : "no"})`);
      }
    } else {
      // New entry
      const entry = {
        modid,
        license,
        url: cfUrl,
        authors: author,
        displayName,
        ignore: false,
      };
      modMap.set(modid.toLowerCase(), entry);
      addCount++;
      console.log(`ADD: ${modid} (${license}) url=${cfUrl ? "yes" : "no"}`);
    }
  }

  // 6) Also update partial entries from check-result
  for (const cr of checkResult) {
    if (cr.status === "partial" && cr.matches && cr.matches.length > 0) {
      for (const match of cr.matches) {
        const existing = modMap.get(match.modid.toLowerCase());
        if (existing && (!existing.url || existing.url === "")) {
          existing.url = cr.curseforgeUrl;
          updateCount++;
          console.log(`UPDATE-PARTIAL: ${match.modid} url=${cr.curseforgeUrl}`);
        }
      }
    }
  }

  // 7) Write back modlicense.json (sorted by modid)
  const outArr = Array.from(modMap.values()).sort((a, b) =>
    (a.modid || "").localeCompare(b.modid || "")
  );

  fs.writeFileSync(MODLICENSE, JSON.stringify(outArr, null, 4), "utf8");
  console.log(`\n✅ modlicense.json 更新完了`);
  console.log(`   新規追加: ${addCount} 件`);
  console.log(`   更新: ${updateCount} 件`);
  console.log(`   合計エントリ: ${outArr.length} 件`);
}

main();
