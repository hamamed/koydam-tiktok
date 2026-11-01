/**
 * Country flags as pictures (bundled SVGs in /flags/<code>.svg, MIT, from flag-icons).
 * Emoji flags do not render on Windows / in OBS, so a team whose emoji is a flag
 * shows the bundled picture automatically.
 */
const FLAG_RE = /^\/flags\/[a-z]{2}(-[a-z0-9]{2,3})?\.svg$/;
export const isFlagPath = (s) => FLAG_RE.test(String(s || ''));

/** "🇲🇦" -> "ma" (null when the text is not a country flag emoji). */
export function flagCode(emoji) {
  const cps = [...String(emoji || '').trim()].map((c) => c.codePointAt(0));
  if (cps.length !== 2 || cps.some((c) => c < 0x1f1e6 || c > 0x1f1ff)) return null;
  return cps.map((c) => String.fromCharCode(c - 0x1f1e6 + 97)).join('');
}
export const flagPath = (code) => `/flags/${code}.svg`;
/** The flag picture for a team without its own photo, or ''. */
export const emojiFlagUrl = (emoji) => { const c = flagCode(emoji); return c ? flagPath(c) : ''; };

/** All 22 Arab League countries. */
export const ARAB_COUNTRIES = [
  { code: 'sa', name: 'السعودية', color: '#006c35', keywords: ['saudi', 'ksa', 'سعودية', 'السعودية', 'سعودي'] },
  { code: 'eg', name: 'مصر', color: '#c8102e', keywords: ['egypt', 'egypte', 'masr', 'مصر', 'مصري'] },
  { code: 'ma', name: 'المغرب', color: '#c1272d', keywords: ['morocco', 'maroc', 'maghrib', 'مغرب', 'المغرب', 'مغربي'] },
  { code: 'dz', name: 'الجزائر', color: '#00a651', keywords: ['algeria', 'algerie', 'dz', 'djazair', 'الجزائر', 'جزائر', 'جزائري'] },
  { code: 'tn', name: 'تونس', color: '#e70013', keywords: ['tunisia', 'tunisie', 'tounes', 'تونس', 'تونسي'] },
  { code: 'ly', name: 'ليبيا', color: '#239e46', keywords: ['libya', 'libye', 'ليبيا', 'ليبي'] },
  { code: 'mr', name: 'موريتانيا', color: '#00a95c', keywords: ['mauritania', 'mauritanie', 'موريتانيا', 'موريتاني'] },
  { code: 'sd', name: 'السودان', color: '#d21034', keywords: ['sudan', 'soudan', 'السودان', 'سودان', 'سوداني'] },
  { code: 'ae', name: 'الإمارات', color: '#00732f', keywords: ['uae', 'emirates', 'الامارات', 'الإمارات', 'اماراتي'] },
  { code: 'kw', name: 'الكويت', color: '#007a3d', keywords: ['kuwait', 'الكويت', 'كويت', 'كويتي'] },
  { code: 'qa', name: 'قطر', color: '#8a1538', keywords: ['qatar', 'قطر', 'قطري'] },
  { code: 'bh', name: 'البحرين', color: '#ce1126', keywords: ['bahrain', 'البحرين', 'بحرين', 'بحريني'] },
  { code: 'om', name: 'عُمان', color: '#db161b', keywords: ['oman', 'عمان', 'عُمان', 'عماني'] },
  { code: 'ye', name: 'اليمن', color: '#ce1126', keywords: ['yemen', 'اليمن', 'يمن', 'يمني'] },
  { code: 'iq', name: 'العراق', color: '#007a3d', keywords: ['iraq', 'العراق', 'عراق', 'عراقي'] },
  { code: 'sy', name: 'سوريا', color: '#007a3d', keywords: ['syria', 'syrie', 'سوريا', 'سورية', 'سوري'] },
  { code: 'jo', name: 'الأردن', color: '#007a3d', keywords: ['jordan', 'الاردن', 'الأردن', 'اردن', 'اردني'] },
  { code: 'lb', name: 'لبنان', color: '#00a651', keywords: ['lebanon', 'liban', 'لبنان', 'لبناني'] },
  { code: 'ps', name: 'فلسطين', color: '#009639', keywords: ['palestine', 'فلسطين', 'فلسطيني'] },
  { code: 'so', name: 'الصومال', color: '#4189dd', keywords: ['somalia', 'الصومال', 'صومال', 'صومالي'] },
  { code: 'dj', name: 'جيبوتي', color: '#6ab2e7', keywords: ['djibouti', 'جيبوتي'] },
  { code: 'km', name: 'جزر القمر', color: '#3a75c4', keywords: ['comoros', 'comores', 'القمر', 'جزر القمر', 'قمري'] },
];
const byCode = new Map(ARAB_COUNTRIES.map((c) => [c.code, c]));
export const arabCountry = (code) => byCode.get(code);
/** Flag emoji from a code: "ma" -> "🇲🇦". */
export const codeEmoji = (code) => String.fromCodePoint(...[...code.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));

/** A team object for a country (picture flag, emoji kept as a fallback for chat text). */
export function countryTeam(code, gift) {
  const c = byCode.get(code);
  return { name: c.name, emoji: codeEmoji(code), image: flagPath(code), color: c.color, keywords: [...c.keywords], gifts: gift ? [gift] : [] };
}
