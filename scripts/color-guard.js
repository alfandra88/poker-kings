import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCAN_DIRS = ["src", "public"];
const SKIP = new Set(["node_modules", ".next", ".git"]);

let failures = 0;
const fail = (m) => {
  failures++;
  console.error(`  FAIL ${m}`);
};

function collect(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) collect(full, out);
    else if (/\.(css|jsx?|svg|json)$/.test(name)) out.push(full);
  }
  return out;
}

const hexToRgb = (hex) => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];
function rgbToHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  const d = max - min;
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      default: h = (r - g) / d + 4;
    }
    h /= 6;
  }
  return [h * 360, s * 100, l * 100];
}
const chan = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const lum = (hex) => { const [r, g, b] = hexToRgb(hex); return 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b); };
const contrast = (a, b) => {
  const l1 = lum(a), l2 = lum(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
};

const css = readFileSync(join(ROOT, "src/app/globals.css"), "utf8");

const token = (name) => {
  const m = css.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, "i"));
  return m ? m[1].toLowerCase() : null;
};
const brand = token("brand");
const wanted = "#27bef5";
console.log(`brand token = ${brand}`);
if (brand !== wanted) fail(`--brand should be ${wanted}, got ${brand}`);

const textOnBrand = token("brand") && (css.match(/color:\s*(#[0-9a-f]{6});/i) || [])[1];
console.log("\ncontrast checks (WCAG AA = 4.5 for body, 3.0 for large):");
const checks = [
  ["brand text on page bg", brand, "#07090d", 4.5],
  ["brand text on card bg", brand, "#0d1117", 4.5],
  ["felt-1 text on page bg", token("felt-1"), "#07090d", 4.5],
];
if (textOnBrand) {
  checks.push(["CTA label on brand", textOnBrand, brand, 4.5]);
}
for (const [label, fg, bg, min] of checks) {
  if (!fg || !bg) continue;
  const r = contrast(fg, bg);
  const okk = r >= min;
  if (!okk) failures++;
  console.log(`  ${okk ? "ok  " : "FAIL"} ${label}: ${fg} on ${bg} = ${r.toFixed(2)}:1 (need ${min})`);
}

console.log("\nscanning for residual gold/yellow...");
const GOLD = new Set([
  "#fdd573", "#f5c04e", "#ffd97a", "#ffe9ad", "#e0b04e", "#a9781f",
  "#c9952b", "#d09a26", "#c98f1f", "#fff3d6", "#ffedbb", "#a3720c",
  "#8a5f08", "#6f4d06", "#b47d0e", "#231603", "#eab308",
  "#facc15", "#fbbf24", "#d97706", "#f59e0b", "#ffdd00", "#ffd60a",
]);

let scanned = 0;
let hexHits = 0;
let warmHits = 0;
for (const dir of SCAN_DIRS) {
  const base = join(ROOT, dir);
  let files = [];
  try {
    files = collect(base);
  } catch {
    continue;
  }
  for (const f of files) {
    scanned++;
    const src = readFileSync(f, "utf8");
    const rel = f.slice(ROOT.length + 1);

    for (const m of src.matchAll(/#[0-9a-f]{6}\b/gi)) {
      const hex = m[0].toLowerCase();
      if (GOLD.has(hex)) {
        fail(`${rel}: leftover gold hex ${hex}`);
        hexHits++;
      }
    }

    for (const m of src.matchAll(/#[0-9a-f]{6}\b/gi)) {
      const hex = m[0].toLowerCase();
      if (GOLD.has(hex)) continue;       const [h, s, l] = rgbToHsl(hexToRgb(hex));
      const warm = h >= 20 && h <= 70;
      const bright = l >= 35;
      const saturated = s >= 25;
      if (warm && bright && saturated) {
        fail(`${rel}: warm/yellow hue ${hex} (h=${h.toFixed(0)}° s=${s.toFixed(0)}% l=${l.toFixed(0)}%)`);
        warmHits++;
      }
    }
  }
}
console.log(`  scanned ${scanned} files — ${hexHits} gold-hex, ${warmHits} warm-hue leftovers`);

if (failures) {
  console.error(`\nRESULT: ${failures} colour failure(s)`);
  process.exit(1);
}
console.log("\nRESULT: ALL COLOUR CHECKS PASSED");