// ./page/script.js

/**
 * JSON を取得（相対パスOK）
 */
async function loadJSON(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);
  return res.json();
}

/**
 * 権利表記が必要な MOD の一覧を取得
 * @param {Object} [opts]
 * @param {string} [opts.scriptsBase="../scripts"]
 * @param {boolean} [opts.creditUnknown=true]
 * @returns {Promise<Array<{
 *   modid:string, displayName:string, authors:string,
 *   license:string, url:string, shouldRightsNotation:boolean,
 *   canSecondaryDistribution:boolean, reason:'listed_in_license_json'|'unknown_license',
 *   creditLine:string
 * }>>}
 */
async function getCreditRequiredMods(opts = {}) {
  const { scriptsBase = "../scripts", creditUnknown = true } = opts;

  // 取得
  const [licenseTable, modLicense] = await Promise.all([
    loadJSON(`${scriptsBase}/license.json`),
    loadJSON(`${scriptsBase}/modlicense.json`),
  ]);

  // ライセンス属性（小文字キー）
  const lmap = new Map(
    (licenseTable || []).map((l) => [String(l.name || "").toLowerCase(), l])
  );

  // 判定 & 整形
  const rows = (modLicense || []).map((m) => {
    const lic = String(m.license || "").trim();
    const attr = lmap.get(lic.toLowerCase());

    const shouldRightsNotation =
      attr?.shouldRightsNotation === true || (!attr && creditUnknown);

    const canSecondaryDistribution = attr?.canSecondaryDistribution ?? false;

    const displayName = m.displayName?.trim() || m.modid;
    const authors = m.authors?.trim() || "<author>";
    const url = (m.url || "").trim();

    const reason = attr ? "listed_in_license_json" : "unknown_license";

    const creditLine = shouldRightsNotation
      ? `${displayName} by ${authors} (${url || "<URL>"}) Licensed under ${
          lic || "Unspecified"
        }`
      : "";

    return {
      modid: m.modid,
      displayName,
      authors,
      license: lic || "Unspecified",
      url,
      shouldRightsNotation,
      canSecondaryDistribution,
      reason,
      creditLine,
    };
  });

  // 表記が必要なものだけ、名前順で返す
  return rows
    .filter((r) => r.shouldRightsNotation)
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

window.getCreditRequiredMods = getCreditRequiredMods;
