/**
 * Remove comments across the codebase while PRESERVING security-relevant
 * documentation.
 *
 * Uses the TypeScript AST (not regex) so string literals, template literals,
 * regex literals and JSX text are never mistaken for comments — the codebase
 * contains `split(/[-_]/)`, `replace(/\D/g, "")` and URL strings such as
 * "https://socket.io", all of which a naive `sed` would corrupt.
 *
 * A comment paragraph is KEPT when any line inside it carries a security
 * marker (PRIVACY / FAIRPLAY / invariant / CRITICAL / security), so those
 * rules stay auditable. Paragraphs are grouped by contiguous lines at the
 * same indentation, so a marked comment keeps its full explanation.
 *
 * Usage: bun scripts/strip-comments.js [--dry]
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import ts from "typescript";

const ROOT = resolve(import.meta.dir, "..");
const DRY = process.argv.includes("--dry");

const MARKERS = /PRIVACY|FAIRPLAY|invariant|CRITICAL|security/i;
const SCAN_ROOTS = ["src", "mini-services/poker-service", "scripts"];
const SKIP = new Set(["node_modules", ".next", ".git"]);

function collect(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) collect(full, out);
    else if (/\.(js|jsx|mjs)$/.test(name)) out.push(full);
  }
  return out;
}

function findComments(src, fileName) {
  const sf = ts.createSourceFile(fileName, src, ts.ScriptTarget.Latest, true);
  const found = [];
  const push = (pos, end) => {
    const text = src.slice(pos, end);
    found.push({ pos, end, text, kind: text.startsWith("//") ? "line" : "block" });
  };
  const visit = (node) => {
    for (const r of ts.getLeadingCommentRanges(src, node.pos) ?? []) push(r.pos, r.end);
    for (const r of ts.getTrailingCommentRanges(src, node.end) ?? []) push(r.pos, r.end);
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sf, visit);
  for (const r of ts.getLeadingCommentRanges(src, 0) ?? []) push(r.pos, r.end);

  const seen = new Set();
  const unique = found.filter((c) => {
    const k = `${c.pos}:${c.end}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  unique.sort((a, b) => a.pos - b.pos);
  return unique;
}

/**
 * Decide for the comment at index `i` whether its whole paragraph must be
 * kept. A paragraph is a run of contiguous `//` lines at the same indentation;
 * a security marker anywhere in the run protects every line of it.
 */
function paragraphAt(comments, src, i) {
  const c = comments[i];
  let end = i;
  if (c.kind === "line") {
    const baseIndent = indentOf(src, c.pos);
    let j = i + 1;
    while (j < comments.length) {
      const n = comments[j];
      if (n.kind !== "line") break;
      if (!/^[ \t]*\r?\n[ \t]*$/.test(src.slice(comments[end].end, n.pos))) break;
      if (indentOf(src, n.pos) !== baseIndent) break;
      end = j;
      j++;
    }
  }
  const marked = comments.slice(i, end + 1).some((n) => MARKERS.test(n.text));
  return { keep: marked, end };
}

const keep = (text) => MARKERS.test(text);

function indentOf(src, pos) {
  let k = pos;
  while (k > 0 && src[k - 1] !== "\n") k--;
  return src.slice(k, pos).match(/^[ \t]*/)[0];
}

function removeRanges(src, ranges) {
  const sorted = [...ranges].sort((a, b) => a.pos - b.pos);
  let out = src;
  for (let i = sorted.length - 1; i >= 0; i--) {
    const { pos, end } = sorted[i];
    let s = pos;
    let e = end;
    if (out.slice(s, e).startsWith("//") && out[s] !== " ") {
      let j = e;
      while (j < out.length && (out[j] === " " || out[j] === "\t")) j++;
      if (out[j] === "\n") e = j + 1;
      else if (out[j] === "\r" && out[j + 1] === "\n") e = j + 2;
    }
    let k = s;
    while (k > 0 && (out[k - 1] === " " || out[k - 1] === "\t")) k--;
    if (k === 0 || out[k - 1] === "\n") s = k;
    out = out.slice(0, s) + out.slice(e);
  }
  return out;
}

const tidy = (src) =>
  src
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\s+$/gm, "")
    .replace(/^\n+/, "")
    .replace(/\s+$/, "\n");

const files = SCAN_ROOTS.flatMap((d) => {
  try {
    return collect(join(ROOT, d));
  } catch {
    return [];
  }
});

let totalRemoved = 0;
let totalKept = 0;
const perFile = [];

for (const abs of files) {
  const rel = abs.slice(ROOT.length + 1);
  const src = readFileSync(abs, "utf8");
  const comments = findComments(src, abs);
  if (comments.length === 0) continue;

  const drop = [];
  let keptHere = 0;
  let removedHere = 0;

  for (let i = 0; i < comments.length; i++) {
    const { keep: keepRun, end: runEnd } = paragraphAt(comments, src, i);
    if (keepRun) {
      keptHere += runEnd - i + 1;
      i = runEnd;
      continue;
    }
    for (let k = i; k <= runEnd; k++) {
      drop.push({ pos: comments[k].pos, end: comments[k].end });
      removedHere++;
    }
    i = runEnd;
  }

  if (drop.length === 0) continue;
  const out = tidy(removeRanges(src, drop));
  totalRemoved += removedHere;
  totalKept += keptHere;
  perFile.push({ rel, removedHere, keptHere });

  if (!DRY) writeFileSync(abs, out, "utf8");
}

console.log(`files scanned    : ${files.length}`);
console.log(`comments removed : ${totalRemoved}`);
console.log(`comments kept    : ${totalKept}  (security markers)`);
if (DRY) console.log("DRY RUN — nothing written");

const cssPath = join(ROOT, "src/app/globals.css");
try {
  const css = readFileSync(cssPath, "utf8");
  const before = (css.match(/\/\*/g) ?? []).length;
  const stripped = tidy(css.replace(/\/\*[\s\S]*?\*\//g, ""));
  if (!DRY) writeFileSync(cssPath, stripped, "utf8");
  console.log(`css comments     : ${before}`);
} catch {
  /* none */
}

if (!DRY) {
  console.log("\ntop files by removal:");
  for (const f of perFile.sort((a, b) => b.removedHere - a.removedHere).slice(0, 8)) {
    console.log(
      `  ${String(f.removedHere).padStart(4)}  ${f.rel}${f.keptHere ? `  (kept ${f.keptHere})` : ""}`,
    );
  }
}