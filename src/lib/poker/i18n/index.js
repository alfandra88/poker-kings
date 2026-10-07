import { EN } from "./en.js";
import { ID } from "./id.js";
import { ZH } from "./zh.js";
import { HI } from "./hi.js";
import { ES } from "./es.js";
import { FR } from "./fr.js";
import { AR } from "./ar.js";
import { BN } from "./bn.js";
import { RU } from "./ru.js";
import { PT } from "./pt.js";
import { UR } from "./ur.js";
import { DE } from "./de.js";
import { JA } from "./ja.js";
import { TR } from "./tr.js";
import { KO } from "./ko.js";
import { VI } from "./vi.js";
import { IT } from "./it.js";
import { TH } from "./th.js";
import { FA } from "./fa.js";
import { PL } from "./pl.js";
import { NL } from "./nl.js";
import { TL } from "./tl.js";
import { MS } from "./ms.js";
import { UK } from "./uk.js";
import { SW } from "./sw.js";
export { EN, DICTS };

export const LANGS = [
    { code: "en", native: "English", en: "English", dir: "ltr", locale: "en-US" },
    { code: "zh", native: "中文", en: "Chinese (Simplified)", dir: "ltr", locale: "zh-CN" },
    { code: "hi", native: "हिन्दी", en: "Hindi", dir: "ltr", locale: "hi-IN" },
    { code: "es", native: "Español", en: "Spanish", dir: "ltr", locale: "es-ES" },
    { code: "fr", native: "Français", en: "French", dir: "ltr", locale: "fr-FR" },
    { code: "ar", native: "العربية", en: "Arabic", dir: "rtl", locale: "ar-EG" },
    { code: "bn", native: "বাংলা", en: "Bengali", dir: "ltr", locale: "bn-BD" },
    { code: "ru", native: "Русский", en: "Russian", dir: "ltr", locale: "ru-RU" },
    { code: "pt", native: "Português", en: "Portuguese (BR)", dir: "ltr", locale: "pt-BR" },
    { code: "ur", native: "اردو", en: "Urdu", dir: "rtl", locale: "ur-PK" },
    { code: "id", native: "Indonesia", en: "Indonesian", dir: "ltr", locale: "id-ID" },
    { code: "de", native: "Deutsch", en: "German", dir: "ltr", locale: "de-DE" },
    { code: "ja", native: "日本語", en: "Japanese", dir: "ltr", locale: "ja-JP" },
    { code: "tr", native: "Türkçe", en: "Turkish", dir: "ltr", locale: "tr-TR" },
    { code: "ko", native: "한국어", en: "Korean", dir: "ltr", locale: "ko-KR" },
    { code: "vi", native: "Tiếng Việt", en: "Vietnamese", dir: "ltr", locale: "vi-VN" },
    { code: "it", native: "Italiano", en: "Italian", dir: "ltr", locale: "it-IT" },
    { code: "th", native: "ไทย", en: "Thai", dir: "ltr", locale: "th-TH" },
    { code: "fa", native: "فارسی", en: "Persian", dir: "rtl", locale: "fa-IR" },
    { code: "pl", native: "Polski", en: "Polish", dir: "ltr", locale: "pl-PL" },
    { code: "nl", native: "Nederlands", en: "Dutch", dir: "ltr", locale: "nl-NL" },
    { code: "tl", native: "Filipino", en: "Tagalog", dir: "ltr", locale: "fil-PH" },
    { code: "ms", native: "Melayu", en: "Malay", dir: "ltr", locale: "ms-MY" },
    { code: "uk", native: "Українська", en: "Ukrainian", dir: "ltr", locale: "uk-UA" },
    { code: "sw", native: "Kiswahili", en: "Swahili", dir: "ltr", locale: "sw-KE" },
];
const DICTS = {
    en: EN, id: ID, zh: ZH, hi: HI, es: ES, fr: FR, ar: AR, bn: BN, ru: RU,
    pt: PT, ur: UR, de: DE, ja: JA, tr: TR, ko: KO, vi: VI, it: IT, th: TH,
    fa: FA, pl: PL, nl: NL, tl: TL, ms: MS, uk: UK, sw: SW,
};

export function isLang(x) {
    return typeof x === "string" && Object.prototype.hasOwnProperty.call(DICTS, x);
}

export function langMeta(lang) {
    return LANGS.find((l) => l.code === lang) ?? LANGS[0];
}

export function translate(lang, key, params) {
    const primary = DICTS[lang];
    let text = (primary && primary[key]) || EN[key] || key;
    if (params) {
        for (const [k, v] of Object.entries(params)) {
            text = text.replaceAll(`{${k}}`, String(v));
        }
    }
    return text;
}

export const RANKS = {
    en: { "rank.2": "Twos", "rank.3": "Threes", "rank.4": "Fours", "rank.5": "Fives", "rank.6": "Sixes", "rank.7": "Sevens", "rank.8": "Eights", "rank.9": "Nines", "rank.T": "Tens", "rank.J": "Jacks", "rank.Q": "Queens", "rank.K": "Kings", "rank.A": "Aces" },
    id: { "rank.2": "Dua", "rank.3": "Tiga", "rank.4": "Empat", "rank.5": "Lima", "rank.6": "Enam", "rank.7": "Tujuh", "rank.8": "Delapan", "rank.9": "Sembilan", "rank.T": "Sepuluh", "rank.J": "Jacks", "rank.Q": "Queens", "rank.K": "Kings", "rank.A": "Aces" },
    zh: { "rank.2": "2", "rank.3": "3", "rank.4": "4", "rank.5": "5", "rank.6": "6", "rank.7": "7", "rank.8": "8", "rank.9": "9", "rank.T": "10", "rank.J": "J", "rank.Q": "Q", "rank.K": "K", "rank.A": "A" },
    ja: { "rank.2": "2", "rank.3": "3", "rank.4": "4", "rank.5": "5", "rank.6": "6", "rank.7": "7", "rank.8": "8", "rank.9": "9", "rank.T": "10", "rank.J": "J", "rank.Q": "Q", "rank.K": "K", "rank.A": "A" },
    ko: { "rank.2": "2", "rank.3": "3", "rank.4": "4", "rank.5": "5", "rank.6": "6", "rank.7": "7", "rank.8": "8", "rank.9": "9", "rank.T": "10", "rank.J": "J", "rank.Q": "Q", "rank.K": "K", "rank.A": "A" },
    vi: { "rank.2": "Hai", "rank.3": "Ba", "rank.4": "Bốn", "rank.5": "Năm", "rank.6": "Sáu", "rank.7": "Bảy", "rank.8": "Tám", "rank.9": "Chín", "rank.T": "Mười", "rank.J": "Bồi", "rank.Q": "Đầm", "rank.K": "Ghi", "rank.A": "Át" },
    th: { "rank.2": "สอง", "rank.3": "สาม", "rank.4": "สี่", "rank.5": "ห้า", "rank.6": "หก", "rank.7": "เจ็ด", "rank.8": "แปด", "rank.9": "เก้า", "rank.T": "สิบ", "rank.J": "แจ็ค", "rank.Q": "ควีน", "rank.K": "คิง", "rank.A": "เอซ" },
    tl: { "rank.2": "Twos", "rank.3": "Threes", "rank.4": "Fours", "rank.5": "Fives", "rank.6": "Sixes", "rank.7": "Sevens", "rank.8": "Eights", "rank.9": "Nines", "rank.T": "Tens", "rank.J": "Jacks", "rank.Q": "Queens", "rank.K": "Kings", "rank.A": "Aces" },
    hi: { "rank.2": "दो", "rank.3": "तीन", "rank.4": "चार", "rank.5": "पाँच", "rank.6": "छह", "rank.7": "सात", "rank.8": "आठ", "rank.9": "नौ", "rank.T": "दस", "rank.J": "जैक", "rank.Q": "क्वीन", "rank.K": "किंग", "rank.A": "ऐस" },
    bn: { "rank.2": "দুই", "rank.3": "তিন", "rank.4": "চার", "rank.5": "পাঁচ", "rank.6": "ছয়", "rank.7": "সাত", "rank.8": "আট", "rank.9": "নয়", "rank.T": "দশ", "rank.J": "জ্যাক", "rank.Q": "কুইন", "rank.K": "কিং", "rank.A": "এস" },
    ur: { "rank.2": "دو", "rank.3": "تین", "rank.4": "چار", "rank.5": "پانچ", "rank.6": "چھ", "rank.7": "سات", "rank.8": "آٹھ", "rank.9": "نو", "rank.T": "دس", "rank.J": "جیک", "rank.Q": "کوین", "rank.K": "کنگ", "rank.A": "اے" },
    ar: { "rank.2": "اثنان", "rank.3": "ثلاثة", "rank.4": "أربعة", "rank.5": "خمسة", "rank.6": "ستة", "rank.7": "سبعة", "rank.8": "ثمانية", "rank.9": "تسعة", "rank.T": "عشرة", "rank.J": "جاك", "rank.Q": "ملكة", "rank.K": "ملك", "rank.A": "آص" },
    fa: { "rank.2": "دو", "rank.3": "سه", "rank.4": "چهار", "rank.5": "پنج", "rank.6": "شش", "rank.7": "هفت", "rank.8": "هشت", "rank.9": "نه", "rank.T": "ده", "rank.J": "جک", "rank.Q": "بی‌بی", "rank.K": "شاه", "rank.A": "آس" },
    es: { "rank.2": "Doses", "rank.3": "Treses", "rank.4": "Cuatros", "rank.5": "Cincos", "rank.6": "Seises", "rank.7": "Sietes", "rank.8": "Ochos", "rank.9": "Nueves", "rank.T": "Dieces", "rank.J": "Sotas", "rank.Q": "Reinas", "rank.K": "Reyes", "rank.A": "Ases" },
    fr: { "rank.2": "Deux", "rank.3": "Trois", "rank.4": "Quatres", "rank.5": "Cinq", "rank.6": "Six", "rank.7": "Sept", "rank.8": "Huit", "rank.9": "Neuf", "rank.T": "Dix", "rank.J": "Valets", "rank.Q": "Dames", "rank.K": "Rois", "rank.A": "As" },
    pt: { "rank.2": "Dois", "rank.3": "Três", "rank.4": "Quatros", "rank.5": "Cincos", "rank.6": "Seis", "rank.7": "Setes", "rank.8": "Oitos", "rank.9": "Noves", "rank.T": "Dez", "rank.J": "Vales", "rank.Q": "Damas", "rank.K": "Reis", "rank.A": "Ases" },
    it: { "rank.2": "Due", "rank.3": "Tre", "rank.4": "Quattro", "rank.5": "Cinque", "rank.6": "Sei", "rank.7": "Sette", "rank.8": "Otto", "rank.9": "Nove", "rank.T": "Dieci", "rank.J": "Fanti", "rank.Q": "Donne", "rank.K": "Re", "rank.A": "Assi" },
    de: { "rank.2": "Zwei", "rank.3": "Drei", "rank.4": "Vier", "rank.5": "Fünf", "rank.6": "Sechs", "rank.7": "Sieben", "rank.8": "Acht", "rank.9": "Neun", "rank.T": "Zehn", "rank.J": "Buben", "rank.Q": "Damen", "rank.K": "Könige", "rank.A": "Asse" },
    nl: { "rank.2": "Tweeën", "rank.3": "Drieën", "rank.4": "Vieren", "rank.5": "Vijven", "rank.6": "Zessen", "rank.7": "Zeven", "rank.8": "Achten", "rank.9": "Negenen", "rank.T": "Tienen", "rank.J": "Boeren", "rank.Q": "Vrouwen", "rank.K": "Heren", "rank.A": "Azen" },
    ru: { "rank.2": "Двойки", "rank.3": "Тройки", "rank.4": "Четвёрки", "rank.5": "Пятёрки", "rank.6": "Шестёрки", "rank.7": "Семёрки", "rank.8": "Восьмёрки", "rank.9": "Девятки", "rank.T": "Десятки", "rank.J": "Валеты", "rank.Q": "Дамы", "rank.K": "Короли", "rank.A": "Тузы" },
    uk: { "rank.2": "Двійки", "rank.3": "Трійки", "rank.4": "Четвірки", "rank.5": "П'ятірки", "rank.6": "Шістки", "rank.7": "Сімки", "rank.8": "Вісімки", "rank.9": "Дев'ятки", "rank.T": "Десятки", "rank.J": "Валети", "rank.Q": "Дами", "rank.K": "Королі", "rank.A": "Тузи" },
    pl: { "rank.2": "Dwójki", "rank.3": "Trójki", "rank.4": "Czwórki", "rank.5": "Piątki", "rank.6": "Szóstki", "rank.7": "Siódemki", "rank.8": "Ósemki", "rank.9": "Dziewiątki", "rank.T": "Dziesiątki", "rank.J": "Walety", "rank.Q": "Damy", "rank.K": "Króle", "rank.A": "Asy" },
    tr: { "rank.2": "İkiler", "rank.3": "Üçler", "rank.4": "Dörtler", "rank.5": "Beşler", "rank.6": "Altılar", "rank.7": "Yediler", "rank.8": "Sekizler", "rank.9": "Dokuzlar", "rank.T": "Onlar", "rank.J": "Valeler", "rank.Q": "Kızlar", "rank.K": "Papazlar", "rank.A": "Aslar" },
    ms: { "rank.2": "Dua", "rank.3": "Tiga", "rank.4": "Empat", "rank.5": "Lima", "rank.6": "Enam", "rank.7": "Tujuh", "rank.8": "Lapan", "rank.9": "Sembilan", "rank.T": "Sepuluh", "rank.J": "Jacks", "rank.Q": "Queens", "rank.K": "Kings", "rank.A": "Aces" },
    sw: { "rank.2": "Twos", "rank.3": "Threes", "rank.4": "Fours", "rank.5": "Fives", "rank.6": "Sixes", "rank.7": "Sevens", "rank.8": "Eights", "rank.9": "Nines", "rank.T": "Tens", "rank.J": "Jacks", "rank.Q": "Queens", "rank.K": "Kings", "rank.A": "Aces" },
};

export function formatHandLabel(lang, label) {
    if (!label || !label.key)
        return "";
    const ranks = RANKS[lang] ?? RANKS.en;
    const a = label.a ? ranks[label.a] ?? label.a : "";
    const b = label.b ? ranks[label.b] ?? label.b : "";
    return translate(lang, `hand.${label.key}`, { a, b });
}

export function fmt(n, lang) {
    if (!Number.isFinite(n))
        return "0";
    const meta = LANGS.find((l) => l.code === lang);
    const locale = meta?.locale || "en-US";
    try {
        return new Intl.NumberFormat(locale).format(n);
    }
    catch {
        try {
            return new Intl.NumberFormat("en-US").format(n);
        }
        catch {
            return String(Math.round(n));
        }
    }
}

export function compactFmt(n, lang) {
    if (!Number.isFinite(n))
        return "0";
    const meta = LANGS.find((l) => l.code === lang);
    const locale = meta?.locale || "en-US";
    try {
        return new Intl.NumberFormat(locale, {
            notation: "compact",
            maximumFractionDigits: 1,
        }).format(n);
    }
    catch (e) {
        console.debug("compactFmt: compact notation unavailable, falling back", e);
        try {
            return new Intl.NumberFormat("en-US", { notation: "compact" }).format(n);
        }
        catch {
            return fmt(n, lang);
        }
    }
}

export function detectLang() {
    if (typeof navigator === "undefined")
        return "en";
    const candidates = [];
    try {
        if (Array.isArray(navigator.languages))
            candidates.push(...navigator.languages);
        if (typeof navigator.language === "string" && navigator.language) {
            candidates.push(navigator.language);
        }
    }
    catch {
        // exotic environments can throw on navigator access — fail safe
    }
    for (const raw of candidates) {
        const base = String(raw).toLowerCase().split(/[-_]/)[0];
        if (isLang(base))
            return base;
    }
    return "en";
}

export function applyLangToDocument(lang) {
    if (typeof document === "undefined")
        return;
    const meta = langMeta(lang);
    try {
        document.documentElement.lang = meta.code;
        document.documentElement.dir = meta.dir;
    }
    catch {
        // document not writable (rare embeds) — cosmetic only, ignore
    }
}
