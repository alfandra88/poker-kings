import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const CHECK_ONLY = process.argv.includes("--check");

const TARGET = "#27bef5";

const hexToRgb = (hex) => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];
const rgbToHex = ([r, g, b]) =>
  "#" +
  [r, g, b]
    .map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0"))
    .join("");

function rgbToHsl([r, g, b]) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  const d = max - min;
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      default:
        h = (r - g) / d + 4;
    }
    h /= 6;
  }
  return [h * 360, s * 100, l * 100];
}

function hslToRgb([h, s, l]) {
  h /= 360;
  s /= 100;
  l /= 100;
  if (s === 0) {
    const v = l * 255;
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue2rgb = (t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [hue2rgb(h + 1 / 3) * 255, hue2rgb(h) * 255, hue2rgb(h - 1 / 3) * 255];
}

function rehue(hex, targetHue) {
  const [h, s, l] = rgbToHsl(hexToRgb(hex));
  return rgbToHex(hslToRgb([targetHue, s, l]));
}

function rehueRgba(r, g, b, a, targetHue) {
  const out = hslToRgb([targetHue, ...rgbToHsl([r, g, b]).slice(1)]);
  const [nr, ng, nb] = out.map((v) => Math.max(0, Math.min(255, Math.round(v))));
  return `rgba(${nr}, ${ng}, ${nb}, ${a})`;
}

const TARGET_HUE = rgbToHsl(hexToRgb(TARGET))[0];

const OLD_BRAND = "#fdd573";
const OLD_BRAND_L = rgbToHsl(hexToRgb(OLD_BRAND))[2];
const NEW_BRAND_L = rgbToHsl(hexToRgb(TARGET))[2];
const L_SCALE = NEW_BRAND_L / OLD_BRAND_L; 

function mapGold(hex) {
  if (hex.toLowerCase() === OLD_BRAND) return TARGET;
  const [h, s, l] = rgbToHsl(hexToRgb(hex));
  return rgbToHex(hslToRgb([TARGET_HUE, s, l * L_SCALE]));
}

function mapGoldRgba(r, g, b, a) {
  const mapped = mapGold(rgbToHex([r, g, b]));
  const [mr, mg, mb] = hexToRgb(mapped);
  return `rgba(${mr}, ${mg}, ${mb}, ${a})`;
}

const chan = (c) => {
  c /= 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
};
const lum = (hex) => {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b);
};
const contrast = (a, b) => {
  const l1 = lum(a);
  const l2 = lum(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
};

const GOLD_HEXES = [
  "#fdd573", "#f5c04e", "#ffd97a", "#ffe9ad", "#e0b04e", "#a9781f",
  "#c9952b", "#d09a26", "#c98f1f", "#fff3d6", "#ffedbb", "#a3720c",
  "#8a5f08", "#6f4d06", "#b47d0e", "#241703", "#231603", "#eab308",
  "#3d2b1c", "#241a10", "#7a5a10", "#7a5206",
  "#e67e22", "#d35400",
];

const STRUCTURAL = new Set(["#3d2b1c", "#241a10"]);

console.log(`target ${TARGET}  hue=${TARGET_HUE.toFixed(1)}°`);
console.log("\nhex        before   after     ΔL(after-before)");
for (const hex of GOLD_HEXES) {
  if (STRUCTURAL.has(hex)) continue;
  const after = mapGold(hex);
  const dl = (lum(after) - lum(hex)) * 100;
  console.log(
    `${hex}  →  ${after}   ${dl >= 0 ? "+" : ""}${dl.toFixed(1)}`,
  );
}

const SCAN_ROOTS = ["src", "public"];
const SKIP_DIRS = new Set(["node_modules", ".next", ".git"]);
function collect(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) collect(full, out);
    else if (/\.(css|jsx?|svg)$/.test(name)) out.push(full);
  }
  return out;
}
const FILES = SCAN_ROOTS.flatMap((d) => {
  try {
    return collect(join(ROOT, d));
  } catch {
    return [];
  }
});

let totalHex = 0;
let totalRgba = 0;
const report = [];

for (const abs of FILES) {
  const rel = abs.slice(ROOT.length + 1);
  let src = readFileSync(abs, "utf8");
  const before = src;

  for (const hex of GOLD_HEXES) {
    if (STRUCTURAL.has(hex)) continue;
    const re = new RegExp(hex.replace("#", "#"), "gi");
    const hits = src.match(re);
    if (!hits) continue;
    const next = mapGold(hex.toLowerCase());
    src = src.replace(re, (m) => (m.toLowerCase() === hex ? next : m.toUpperCase()));
    totalHex += hits.length;
    report.push(`  ${rel}: ${hex} → ${next} (${hits.length})`);
  }

  src = src.replace(
    /rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)/g,
    (m, r, g, b, a) => {
      const [rh, rs, rl] = rgbToHsl([+r, +g, +b]);
      if (rh < 25 || rh > 65) return m;
      totalRgba++;
      return mapGoldRgba(+r, +g, +b, +a);
    },
  );

  if (src !== before) {
    if (CHECK_ONLY) console.log(`\n[check] would rewrite ${rel}`);
    else {
      writeFileSync(abs, src, "utf8");
      console.log(`\nrewrote ${rel}`);
    }
  }
}

console.log(`\nrotated ${totalHex} hex + ${totalRgba} rgba occurrence(s)`);
console.log("next: bun scripts/color-guard.js");
