/**
 * CurseForge MOD ダウンローダー (Playwright headed)
 *
 * check-result.json の curseforgeUrl から status="none" のMODを
 * ヘッド有りブラウザで開き、1.20.1 Forge 向けの最新JARをDLする。
 *
 * Usage: node scripts/curseforge-dl.js [check-result.json path]
 */

const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const DEFAULT_INPUT = "D:/Users/Owner/Downloads/check-result.json";
const DOWNLOAD_DIR = path.resolve(__dirname, "mods");
const MC_VERSION = "1.20.1";

async function waitForCF(page, maxRetries = 15) {
  for (let i = 0; i < maxRetries; i++) {
    const title = await page.title();
    if (
      !title.toLowerCase().includes("just a moment") &&
      !title.toLowerCase().includes("challenge") &&
      !title.toLowerCase().includes("attention")
    )
      return true;
    console.log("  ⏳ Cloudflare チャレンジ待ち...");
    await page.waitForTimeout(3000);
  }
  return false;
}

async function main() {
  const inputPath = process.argv[2] || DEFAULT_INPUT;
  if (!fs.existsSync(inputPath)) {
    console.error(`❌ 入力ファイルが見つかりません: ${inputPath}`);
    process.exit(1);
  }

  const entries = JSON.parse(fs.readFileSync(inputPath, "utf8"));
  const targets = entries.filter((e) => e.status === "none");

  console.log(`📦 ${targets.length} 件のMODをダウンロードします`);
  console.log(`📁 保存先: ${DOWNLOAD_DIR}`);

  if (!fs.existsSync(DOWNLOAD_DIR)) {
    fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
  }

  const browser = await chromium.launch({
    headless: false,
    slowMo: 300,
  });

  const context = await browser.newContext({
    acceptDownloads: true,
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  });

  // 最初に1ページ開いてCookieを取得（CF challenge 1回でOKにする）
  const warmup = await context.newPage();
  await warmup.goto("https://www.curseforge.com/minecraft/mc-mods", {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });
  await waitForCF(warmup);
  await warmup.waitForTimeout(2000);
  await warmup.close();

  const results = [];

  for (let i = 0; i < targets.length; i++) {
    const entry = targets[i];
    const slug = entry.curseforgeUrl.split("/").pop();
    console.log(`\n[${i + 1}/${targets.length}] ${slug} ...`);

    const page = await context.newPage();

    try {
      // Files ページ (1.20.1 フィルタ付き)
      const filesUrl = `${entry.curseforgeUrl}/files/all?page=1&pageSize=20&version=${MC_VERSION}&showAlphaFiles=hide`;
      await page.goto(filesUrl, {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });
      await waitForCF(page);
      await page.waitForTimeout(2000);

      // download リンクを全部取得
      let dlLinks = await page.evaluate((cfSlug) => {
        return Array.from(document.querySelectorAll("a"))
          .filter((a) => {
            const href = a.getAttribute("href") || "";
            return href.includes("/download/") && /\/download\/\d+/.test(href);
          })
          .map((a) => {
            const href = a.getAttribute("href") || "";
            const m = href.match(/\/download\/(\d+)/);
            return m ? m[1] : null;
          })
          .filter(Boolean);
      });

      // 重複除去
      dlLinks = [...new Set(dlLinks)];

      if (dlLinks.length === 0) {
        // フィルタなしで再試行
        console.log("  ⚠️ 1.20.1 ファイルが見つからないため全バージョンで再試行...");
        await page.goto(`${entry.curseforgeUrl}/files/all`, {
          waitUntil: "domcontentloaded",
          timeout: 30000,
        });
        await waitForCF(page);
        await page.waitForTimeout(2000);

        dlLinks = await page.evaluate(() => {
          return [
            ...new Set(
              Array.from(document.querySelectorAll("a"))
                .map((a) => {
                  const href = a.getAttribute("href") || "";
                  const m = href.match(/\/download\/(\d+)/);
                  return m ? m[1] : null;
                })
                .filter(Boolean)
            ),
          ];
        });
      }

      if (dlLinks.length > 0) {
        const fileId = dlLinks[0]; // 最新（一番上）
        const downloadUrl = `${entry.curseforgeUrl}/download/${fileId}`;
        console.log(`  📥 ダウンロード: fileId=${fileId}`);

        const [download] = await Promise.all([
          page.waitForEvent("download", { timeout: 60000 }),
          page.goto(downloadUrl, {
            waitUntil: "domcontentloaded",
            timeout: 30000,
          }),
        ]);

        const suggestedName = download.suggestedFilename();
        const savePath = path.join(DOWNLOAD_DIR, suggestedName);
        await download.saveAs(savePath);
        console.log(`  ✅ 保存: ${suggestedName}`);
        results.push({ slug, file: suggestedName, status: "ok" });
      } else {
        console.log("  ❌ ダウンロードリンクが見つからない");
        results.push({ slug, file: null, status: "no-link" });
      }
    } catch (err) {
      console.error(`  ❌ エラー: ${err.message}`);
      results.push({ slug, file: null, status: "error", error: err.message });
    } finally {
      await page.close();
    }
  }

  await browser.close();

  // 結果表示
  console.log("\n\n========== 結果 ==========");
  const ok = results.filter((r) => r.status === "ok");
  const ng = results.filter((r) => r.status !== "ok");
  console.log(`✅ 成功: ${ok.length} / ${results.length}`);
  for (const r of ok) console.log(`  ${r.slug} -> ${r.file}`);
  if (ng.length > 0) {
    console.log(`❌ 失敗: ${ng.length}`);
    for (const r of ng)
      console.log(`  ${r.slug} : ${r.status} ${r.error || ""}`);
  }

  // 結果をJSONに保存
  const resultPath = path.join(__dirname, "dl-result.json");
  fs.writeFileSync(resultPath, JSON.stringify(results, null, 2));
  console.log(`\n📄 結果を保存: ${resultPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
