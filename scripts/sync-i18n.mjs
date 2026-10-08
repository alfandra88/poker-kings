// One-time i18n sync for the stay-or-pass rework: rebuild every locale with
// exact key parity against the new en.js. Surviving keys keep their old
// translation (when the English text did not change and it has no em dash);
// everything else falls back to the new English text, with a hand-written
// core translated below.
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const i18nDir = path.join(here, "..", "src", "lib", "poker", "i18n");

const { EN } = await import(path.join(i18nDir, "en.js"));
const oldENSrc = execFileSync("git", ["show", "HEAD:src/lib/poker/i18n/en.js"], {
  cwd: path.join(here, ".."), encoding: "utf8", maxBuffer: 1 << 24,
});
const oldEN = (await import("data:text/javascript;base64," + Buffer.from(oldENSrc).toString("base64"))).EN;

// Hand-translated core gameplay keys (short strings only; long descriptive
// copy intentionally falls back to English).
const CORE = {
  es: { "table.stay": "Me quedo", "table.pass": "Paso", "act.stay": "se queda", "act.pass": "pasa", "common.points": "puntos", "table.strikes": "{n} falta(s)", "seat.benched": "Descanso: {n} ronda(s)", "error.account_required": "Crea una cuenta para jugar", "error.pass_not_allowed": "No se puede pasar en este torneo", "profile.roundsWon": "Rondas ganadas", "profile.seasonPoints": "Puntos de temporada", "profile.played": "Rondas jugadas", "lb.seasonTitle": "Puntos de temporada" },
  fr: { "table.stay": "Je reste", "table.pass": "Je passe", "act.stay": "reste", "act.pass": "passe", "common.points": "points", "table.strikes": "{n} faute(s)", "seat.benched": "Au banc pendant {n} manche(s)", "error.account_required": "Créez un compte pour jouer", "error.pass_not_allowed": "Passer son tour n'est pas autorisé dans ce tournoi", "profile.roundsWon": "Manches gagnées", "profile.seasonPoints": "Points de saison", "profile.played": "Manches jouées", "lb.seasonTitle": "Points de saison" },
  de: { "table.stay": "Ich bleibe", "table.pass": "Ich passe", "act.stay": "bleibt", "act.pass": "passt", "common.points": "Punkte", "table.strikes": "{n} Fehlpunkt(e)", "seat.benched": "{n} Runde(n) ausgesetzt", "error.account_required": "Erstelle ein Konto, um zu spielen", "error.pass_not_allowed": "Passen ist in diesem Turnier nicht erlaubt", "profile.roundsWon": "Gewonnene Runden", "profile.seasonPoints": "Saisonpunkte", "profile.played": "Gespielte Runden", "lb.seasonTitle": "Saisonpunkte" },
  pt: { "table.stay": "Fico", "table.pass": "Passo", "act.stay": "fica", "act.pass": "passa", "common.points": "pontos", "table.strikes": "{n} falta(s)", "seat.benched": "Fora por {n} rodada(s)", "error.account_required": "Crie uma conta para jogar", "error.pass_not_allowed": "Passar não é permitido neste torneio", "profile.roundsWon": "Rodadas ganhas", "profile.seasonPoints": "Pontos de temporada", "profile.played": "Rodadas jogadas", "lb.seasonTitle": "Pontos de temporada" },
  it: { "table.stay": "Resto", "table.pass": "Passo", "act.stay": "resta", "act.pass": "passa", "common.points": "punti", "table.strikes": "{n} fallo", "seat.benched": "In panchina per {n} round", "error.account_required": "Crea un account per giocare", "error.pass_not_allowed": "Passare non è consentito in questo torneo", "profile.roundsWon": "Round vinti", "profile.seasonPoints": "Punti stagione", "profile.played": "Round giocati", "lb.seasonTitle": "Punti stagione" },
  ru: { "table.stay": "Остаюсь", "table.pass": "Пасую", "act.stay": "остаётся", "act.pass": "пасует", "common.points": "очков", "table.strikes": "{n} замечание(я)", "seat.benched": "В запасе {n} круг(а)", "error.account_required": "Создайте аккаунт, чтобы играть", "error.pass_not_allowed": "В этом турнире нельзя пасовать", "profile.roundsWon": "Выигранных кругов", "profile.seasonPoints": "Очки сезона", "profile.played": "Сыгранных кругов", "lb.seasonTitle": "Очки сезона" },
  uk: { "table.stay": "Залишаюсь", "table.pass": "Пасую", "act.stay": "залишається", "act.pass": "пасує", "common.points": "очок", "table.strikes": "{n} зауваг(и)", "seat.benched": "В запасі {n} кол(а)", "error.account_required": "Створіть акаунт, щоб грати", "error.pass_not_allowed": "У цьому турнірі не можна пасувати", "profile.roundsWon": "Виграні кола", "profile.seasonPoints": "Бали сезону", "profile.played": "Зіграні кола", "lb.seasonTitle": "Бали сезону" },
  zh: { "table.stay": "留下", "table.pass": "跳过", "act.stay": "留守", "act.pass": "跳过", "common.points": "积分", "table.strikes": "{n} 次违规", "seat.benched": "轮空 {n} 局", "error.account_required": "创建账户后开始游戏", "error.pass_not_allowed": "本锦标赛不允许跳过", "profile.roundsWon": "获胜局数", "profile.seasonPoints": "赛季积分", "profile.played": "已玩局数", "lb.seasonTitle": "赛季积分" },
  ja: { "table.stay": "残る", "table.pass": "パス", "act.stay": "残る", "act.pass": "パス", "common.points": "ポイント", "table.strikes": "{n} ミス", "seat.benched": "{n} 回戦の欠場", "error.account_required": "アカウントを作成してプレイ", "error.pass_not_allowed": "このトーナメントではパスできません", "profile.roundsWon": "勝利ラウンド", "profile.seasonPoints": "シーズンポイント", "profile.played": "プレイ回数", "lb.seasonTitle": "シーズンポイント" },
  ko: { "table.stay": "남기", "table.pass": "패스", "act.stay": "잔류", "act.pass": "패스", "common.points": "포인트", "table.strikes": "{n} 스트라이크", "seat.benched": "{n} 라운드 결장", "error.account_required": "계정을 만들어 플레이하세요", "error.pass_not_allowed": "이 토너먼트에서는 패스할 수 없습니다", "profile.roundsWon": "라운드 승리", "profile.seasonPoints": "시즌 포인트", "profile.played": "플레이한 라운드", "lb.seasonTitle": "시즌 포인트" },
  tr: { "table.stay": "Kalırım", "table.pass": "Pas", "act.stay": "kalır", "act.pass": "pas geçer", "common.points": "puan", "table.strikes": "{n} ihtar", "seat.benched": "{n} el boyunca yedek", "error.account_required": "Oynamak için hesap oluştur", "error.pass_not_allowed": "Bu turnuvada pas geçilemez", "profile.roundsWon": "Kazanılan raund", "profile.seasonPoints": "Sezon puanı", "profile.played": "Oynanan raund", "lb.seasonTitle": "Sezon puanı" },
  vi: { "table.stay": "Ở lại", "table.pass": "Bỏ lượt", "act.stay": "ở lại", "act.pass": "bỏ lượt", "common.points": "điểm", "table.strikes": "{n} lần lỗi", "seat.benched": "Nghỉ {n} ván", "error.account_required": "Tạo tài khoản để chơi", "error.pass_not_allowed": "Không được bỏ lượt trong giải này", "profile.roundsWon": "Ván thắng", "profile.seasonPoints": "Điểm mùa", "profile.played": "Ván đã chơi", "lb.seasonTitle": "Điểm mùa" },
  id: { "table.stay": "Tetap", "table.pass": "Lewati", "act.stay": "tetap", "act.pass": "melewati", "common.points": "poin", "table.strikes": "{n} pelanggaran", "seat.benched": "Dipinggirkan {n} ronde", "error.account_required": "Buat akun untuk bermain", "error.pass_not_allowed": "Lewati tidak diizinkan di turnamen ini", "profile.roundsWon": "Ronde menang", "profile.seasonPoints": "Poin musim", "profile.played": "Ronde dimainkan", "lb.seasonTitle": "Poin musim" },
  ms: { "table.stay": "Tetap", "table.pass": "Lewati", "act.stay": "tetap", "act.pass": "melewati", "common.points": "poin", "table.strikes": "{n} pelanggaran", "seat.benched": "Dipinggirkan {n} pusingan", "error.account_required": "Buat akaun untuk bermain", "error.pass_not_allowed": "Lewati tidak dibenarkan dalam kejohanan ini", "profile.roundsWon": "Pusingan menang", "profile.seasonPoints": "Mata musim", "profile.played": "Pusingan dimainkan", "lb.seasonTitle": "Mata musim" },
  pl: { "table.stay": "Zostaję", "table.pass": "Pasuję", "act.stay": "zostaje", "act.pass": "pasuje", "common.points": "punktów", "table.strikes": "{n} karny punkt", "seat.benched": "Zawieszenie na {n} rund(y)", "error.account_required": "Utwórz konto, aby grać", "error.pass_not_allowed": "Nie można pasować w tym turnieju", "profile.roundsWon": "Wygrane rundy", "profile.seasonPoints": "Punkty sezonu", "profile.played": "Rozegrane rundy", "lb.seasonTitle": "Punkty sezonu" },
  nl: { "table.stay": "Ik blijf", "table.pass": "Ik pas", "act.stay": "blijft", "act.pass": "past", "common.points": "punten", "table.strikes": "{n} waarschuwing(en)", "seat.benched": "{n} ronde(n) aan de kant", "error.account_required": "Maak een account om te spelen", "error.pass_not_allowed": "Passen is niet toegestaan in dit toernooi", "profile.roundsWon": "Gewonnen ronden", "profile.seasonPoints": "Seizoenpunten", "profile.played": "Gespeelde ronden", "lb.seasonTitle": "Seizoenpunten" },
  ar: { "table.stay": "أبقى", "table.pass": "أتخطى", "act.stay": "يبقى", "act.pass": "يتخطى", "common.points": "نقاط", "table.strikes": "{n} إنذار", "seat.benched": "محروم لمدة {n} جولة", "error.account_required": "أنشئ حساباً للعب", "error.pass_not_allowed": "لا يُسمح بالتخطي في هذه البطولة", "profile.roundsWon": "جولات فاز بها", "profile.seasonPoints": "نقاط الموسم", "profile.played": "عدد الجولات", "lb.seasonTitle": "نقاط الموسم" },
  hi: { "table.stay": "रुकें", "table.pass": "छोड़ें", "act.stay": "रुका", "act.pass": "पास", "common.points": "अंक", "table.strikes": "{n} स्ट्राइक", "seat.benched": "{n} राउंड के लिए बाहर", "error.account_required": "खेलने के लिए खाता बनाएँ", "error.pass_not_allowed": "इस टूर्नामेंट में पास की अनुमति नहीं है", "profile.roundsWon": "जीते गए राउंड", "profile.seasonPoints": "सीज़न अंक", "profile.played": "खेले गए राउंड", "lb.seasonTitle": "सीज़न अंक" },
  bn: { "table.stay": "থাকব", "table.pass": "পাস", "act.stay": "থাকে", "act.pass": "পাস", "common.points": "পয়েন্ট", "table.strikes": "{n} স্ট্রাইক", "seat.benched": "{n} রাউন্ডের জন্য বাইরে", "error.account_required": "খেলতে অ্যাকাউন্ট তৈরি করুন", "error.pass_not_allowed": "এই টুর্নামেন্টে পাস করা যাবে না", "profile.roundsWon": "জেতা রাউন্ড", "profile.seasonPoints": "সিজন পয়েন্ট", "profile.played": "খেলা রাউন্ড", "lb.seasonTitle": "সিজন পয়েন্ট" },
  fa: { "table.stay": "می‌مانم", "table.pass": "پاس", "act.stay": "ماند", "act.pass": "پاس کرد", "common.points": "امتیاز", "table.strikes": "{n} تذکر", "seat.benched": "{n} دست کنار", "error.account_required": "برای بازی حساب بسازید", "error.pass_not_allowed": "در این تورنمنت پاس مجاز نیست", "profile.roundsWon": "دست‌های برده", "profile.seasonPoints": "امتیاز فصل", "profile.played": "دست‌های بازی‌شده", "lb.seasonTitle": "امتیاز فصل" },
  th: { "table.stay": "อยู่ต่อ", "table.pass": "ข้าม", "act.stay": "อยู่ต่อ", "act.pass": "ข้าม", "common.points": "แต้ม", "table.strikes": "{n} ครั้ง", "seat.benched": "พัก {n} รอบ", "error.account_required": "สร้างบัญชีเพื่อเล่น", "error.pass_not_allowed": "ห้ามข้ามในทัวร์นาเมนต์นี้", "profile.roundsWon": "รอบที่ชนะ", "profile.seasonPoints": "แต้มฤดูกาล", "profile.played": "รอบที่เล่น", "lb.seasonTitle": "แต้มฤดูกาล" },
  sw: { "table.stay": "Ninabaki", "table.pass": "Ruka", "act.stay": "anabaki", "act.pass": "anaruka", "common.points": "pointi", "table.strikes": "{n} makosa", "seat.benched": "Pumziko kwa raundi {n}", "error.account_required": "Fungua akaunti iliucheza", "error.pass_not_allowed": "Kuruka hairuhusiwi katika mashindano haya", "profile.roundsWon": "Raundi zilizoshinda", "profile.seasonPoints": "Pointi za msimu", "profile.played": "Raundi zilizochezwa", "lb.seasonTitle": "Pointi za msimu" },
  tl: { "table.stay": "Mananatili", "table.pass": "Lalampas", "act.stay": "nanatili", "act.pass": "lumampas", "common.points": "puntos", "table.strikes": "{n} pagkakamali", "seat.benched": "Naka-bench ng {n} rounds", "error.account_required": "Gumawa ng account para maglaro", "error.pass_not_allowed": "Hindi puwedeng lumampas sa tournament na ito", "profile.roundsWon": "Mpanalong rounds" },
};
// fix a typo above defensively
if (CORE.tl["profile.roundsWon"] === "Mpanalong rounds") CORE.tl["profile.roundsWon"] = "Mga panalong rounds";
CORE.tl["profile.seasonPoints"] = "Mga season points";
CORE.tl["profile.played"] = "Mga larong rounds";
CORE.tl["lb.seasonTitle"] = "Mga season points";
// Urdu mirrors the Hindi set with its own script
CORE.ur = {
  "table.stay": "ٹکنا", "table.pass": "پاس", "act.stay": "ٹکا", "act.pass": "پاس",
  "common.points": "پوائنٹس", "table.strikes": "{n} سٹرائیک",
  "seat.benched": "{n} راؤنڈ کے لیے باہر",
  "error.account_required": "کھیلنے کے لیے اکاؤنٹ بنائیں",
  "error.pass_not_allowed": "اس ٹورنامنٹ میں پاس کی اجازت نہیں",
  "profile.roundsWon": "جیتے گئے راؤنڈ", "profile.seasonPoints": "سیزن پوائنٹس",
  "profile.played": "کھیلے گئے راؤنڈ", "lb.seasonTitle": "سیزن پوائنٹس",
};

const emDash = (s) => typeof s === "string" && s.includes("—");

const enKeys = Object.keys(EN);
const files = readdirSync(i18nDir).filter((f) => /^[a-z]{2}\.js$/.test(f) && f !== "en.js");
let kept = 0, fellBack = 0, coreUsed = 0;

for (const file of files) {
  const code = file.replace(".js", "");
  const mod = await import(path.join(i18nDir, file));
  const oldDict = mod[Object.keys(mod)[0]];
  const out = {};
  for (const k of enKeys) {
    const oldVal = oldDict[k];
    const enSame = oldEN[k] === EN[k];
    if (typeof oldVal === "string" && oldVal.trim() !== "" && enSame && !emDash(oldVal)) {
      out[k] = oldVal;
      kept++;
    } else if (CORE[code]?.[k]) {
      out[k] = CORE[code][k];
      coreUsed++;
    } else {
      out[k] = EN[k];
      fellBack++;
    }
  }
  const name = Object.keys(mod)[0];
  const body = Object.entries(out)
    .map(([k, v]) => `    ${JSON.stringify(k)}: ${JSON.stringify(v)},`)
    .join("\n");
  const banner = `// Locale "${code}" synced against en.js by scripts/sync-i18n.mjs (stay-or-pass rework).\n`;
  const src = `${banner}export const ${name} = {\n${body}\n};\n`;
  const { writeFileSync } = await import("node:fs");
  writeFileSync(path.join(i18nDir, file), src);
}

console.log(`synced ${files.length} locales: ${kept} kept, ${coreUsed} core-translated, ${fellBack} english-fallback`);