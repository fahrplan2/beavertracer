/**
 * Central locale registry.
 * Used by translate-all-i18n-via-claude.mjs and translate-pages-via-claude.mjs.
 *
 * rtl: true for right-to-left languages (affects page wrapping in translate-pages).
 * notes: extra instructions for this language, passed to every translate script
 *        (UI strings, lessons incl. glossary, static pages).
 */

/** For languages where networking is usually taught with the English terms. */
const KEEP_TERMS_ENGLISH =
  "Keep networking and IT technical terms in English (e.g. router, switch, IP address, subnet mask, " +
  "gateway, packet, port, firewall, DNS server, MAC address, VLAN) — do not coin or use native-language " +
  "equivalents for them. Translate only the surrounding text and everyday words.";

export const LOCALES = [
  { code: "de",      name: "German" },
  { code: "es",      name: "Spanish" },
  { code: "fr",      name: "French" },
  { code: "it",      name: "Italian" },
  { code: "id",      name: "Indonesian" },
  { code: "bg",      name: "Bulgarian" },
  { code: "bs",      name: "Bosnian" },
  { code: "cs",      name: "Czech" },
  { code: "sk",      name: "Slovak" },
  { code: "da",      name: "Danish" },
  { code: "et",      name: "Estonian" },
  { code: "fi",      name: "Finnish" },
  { code: "lv",      name: "Latvian" },
  { code: "lt",      name: "Lithuanian" },
  { code: "hu",      name: "Hungarian" },
  { code: "sl",      name: "Slovenian" },
  { code: "el",      name: "Greek" },
  { code: "hr",      name: "Croatian" },
  { code: "pt-PT",   name: "European Portuguese (Portugal)" },
  { code: "ro",      name: "Romanian" },
  { code: "ru",      name: "Russian" },
  { code: "sr-Cyrl", name: "Serbian (Cyrillic script)" },
  { code: "sr-Latn", name: "Serbian (Latin script)" },
  { code: "nl",      name: "Dutch" },
  { code: "pl",      name: "Polish" },
  { code: "tr",      name: "Turkish" },
  { code: "vi",      name: "Vietnamese" },
  { code: "sv",      name: "Swedish" },
  { code: "ja",      name: "Japanese" },
  { code: "ko",      name: "Korean" },
  { code: "zh",      name: "Simplified Chinese" },
  { code: "zh-Hant", name: "Traditional Chinese" },
  { code: "ar",      name: "Arabic",          rtl: true },
  { code: "fa",      name: "Persian (Farsi)", rtl: true },
  { code: "uk",      name: "Ukrainian" },
  { code: "nb",      name: "Norwegian Bokmål" },
  { code: "sq",      name: "Albanian" },
  { code: "ca",      name: "Catalan" },
  { code: "mt",      name: "Maltese", notes: KEEP_TERMS_ENGLISH },
  { code: "so",      name: "Somali",  notes: KEEP_TERMS_ENGLISH },
];
