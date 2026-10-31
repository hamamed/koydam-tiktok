/**
 * Arabic fonts bundled with the app (no Google Fonts needed, works offline in OBS).
 * The font files are only downloaded by a browser when a page actually uses that font.
 */
export const FONTS = [
  { family: 'Cairo', label: 'القاهرة', style: 'عصري متوازن' },
  { family: 'Tajawal', label: 'تجوال', style: 'عصري خفيف' },
  { family: 'Almarai', label: 'المراعي', style: 'واضح للشاشات' },
  { family: 'Changa', label: 'شنقا', style: 'رياضي عريض' },
  { family: 'Readex Pro', label: 'ريدكس', style: 'حديث مستدير' },
  { family: 'IBM Plex Sans Arabic', label: 'آي بي إم بلكس', style: 'تقني أنيق' },
  { family: 'Noto Kufi Arabic', label: 'نوتو كوفي', style: 'كوفي حديث' },
  { family: 'Reem Kufi', label: 'ريم كوفي', style: 'كوفي هندسي' },
  { family: 'El Messiri', label: 'المسيري', style: 'أنيق للعناوين' },
  { family: 'Baloo Bhaijaan 2', label: 'بالو بهيجان', style: 'مرح ومستدير' },
  { family: 'Lemonada', label: 'ليمونادة', style: 'ناعم ودائري' },
  { family: 'Marhey', label: 'مرحي', style: 'مرح للعناوين' },
  { family: 'Lalezar', label: 'لاله‌زار', style: 'عريض جداً للعناوين' },
  { family: 'Rakkas', label: 'رقاص', style: 'عناوين فخمة' },
  { family: 'Blaka', label: 'بلاكا', style: 'زخرفي قوطي' },
  { family: 'Amiri', label: 'أميري', style: 'نسخ كلاسيكي' },
  { family: 'Aref Ruqaa', label: 'عارف رقعة', style: 'خط رقعة تقليدي' },
];
export const BUNDLED_FONTS = new Set(FONTS.map((f) => f.family));
