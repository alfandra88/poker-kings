import { EN, LANGS, DICTS, isLang, translate } from "../src/lib/poker/i18n/index.js";

let failures = 0;

function fail(msg) {
  failures++;
  console.error(`  FAIL ${msg}`);
}

const enKeys = Object.keys(EN).sort();
console.log(`i18n: ${LANGS.length} languages registered, ${enKeys.length} keys in en`);

for (const meta of LANGS) {
  if (!DICTS[meta.code]) fail(`no dictionary loaded for "${meta.code}" (${meta.native})`);
}

for (const meta of LANGS) {
  const dict = DICTS[meta.code];
  if (!dict) continue;
  const keys = new Set(Object.keys(dict));
  const missing = enKeys.filter((k) => !keys.has(k));
  const extra = [...keys].filter((k) => !Object.prototype.hasOwnProperty.call(EN, k));
  if (missing.length) {
    fail(`${meta.code}: ${missing.length} missing key(s): ${missing.slice(0, 8).join(", ")}${missing.length > 8 ? " …" : ""}`);
  }
  if (extra.length) {
    fail(`${meta.code}: ${extra.length} unknown key(s): ${extra.slice(0, 8).join(", ")}${extra.length > 8 ? " …" : ""}`);
  }
}

for (const meta of LANGS) {
  const dict = DICTS[meta.code];
  if (!dict) continue;
  for (const k of enKeys) {
    const v = dict[k];
    if (v === undefined) continue;
    if (typeof v !== "string" || v.trim() === "") fail(`${meta.code}: empty value for "${k}"`);
  }
}

for (const meta of LANGS) {
  if (!isLang(meta.code)) fail(`isLang() rejects registered language "${meta.code}"`);
}
if (isLang("xx")) fail("isLang() accepted a bogus language");
const unknown = translate("en", "definitely.not.a.real.key");
if (unknown !== "definitely.not.a.real.key") {
  fail(`translate() should fall back to the raw key, got "${unknown}"`);
}
const param = translate("en", "hand.fullHouse", { a: "Kings", b: "Fives" });
if (param.includes("{a}") || param.includes("{b}")) {
  fail(`translate() left unresolved params: "${param}"`);
}

const brandKeys = ["app.disclaimer", "app.consent", "home.features", "faq.q1", "faq.a4"];
for (const meta of LANGS) {
  const dict = DICTS[meta.code];
  if (!dict) continue;
  for (const k of brandKeys) {
    const v = dict[k];
    if (typeof v !== "string") continue;
    if (/poker\s*x\b/i.test(v)) fail(`${meta.code}: "${k}" still says "Poker X": ${v.slice(0, 60)}`);
  }
}

if (failures) {
  console.error(`\nRESULT: ${failures} i18n failure(s)`);
  process.exit(1);
}
console.log("RESULT: ALL I18N CHECKS PASSED");