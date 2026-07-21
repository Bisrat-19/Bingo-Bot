/**
 * Built-in default content for the Support and Instructions buttons.
 *
 * These are the fallbacks. Admins override them at runtime from the bot's admin panel
 * or the dashboard; whatever they save wins. Keeping the defaults here means a fresh
 * database still shows something sensible without any setup.
 */

export interface SupportItem {
  label: string;
  handle: string;
}

export const DEFAULT_SUPPORT: SupportItem[] = [
  { label: 'support', handle: '@ciroobingosupport' },
  { label: 'chanel', handle: '@ciroobingo9' },
];

export const DEFAULT_INSTRUCTIONS = `🎮 <b>Ciroo Bingo — የቢንጎ ጨዋታ ህጎች</b>

🃏 <b>መጫወቻ ካርድ</b>
ጨዋታውን ለመጀመር ከሚመጣልን ከ1-400 የመጫወቻ ካርድ ውስጥ አንዱን እንመርጣለን
የመጫወቻ ካርዱ ላይ በቀይ ቀለም የተመረጡ ቁጥሮች የሚያሳዩት መጫወቻ ካርድ በሌላ ተጫዋች መመረጡን ነው
የመጫወቻ ካርድ ስንነካው ከታች በኩል ካርድ ቁጥሩ የሚይዘዉን መጫወቻ ካርድ ያሳየናል
ወደ ጨዋታው ለመግባት የምንፈልገዉን ካርድ ከመረጥን ለምዝገባ የተሰጠው ሰኮንድ ዜሮ ሲሆን ቀጥታ ወደ ጨዋታ ያስገባናል

🎲 <b>ጨዋታ</b>
ወደ ጨዋታው ስንገባ በመረጥነው የካርድ ቁጥር መሰረት የመጫወቻ ካርድ እናገኛለን
ከላይ በቀኝ በኩል ጨዋታው ለመጀመር ያለዉን ቀሪ ሴኮንድ መቁጠር ይጀምራል
ጨዋታው ሲጀምር የተለያዪ ቁጥሮች ከ1 እስከ 75 መጥራት ይጀምራል
የሚጠራው ቁጥር የኛ መጫወቻ ካርድ ዉስጥ ካለ የተጠራዉን ቁጥር ክሊክ በማረግ መምረጥ እንችላለን
የመረጥነዉን ቁጥር ማጥፋት ከፈለግን መልሰን እራሱን ቁጠር ክሊክ በማረግ ማጥፋት እንችላለን

🏆 <b>አሸናፊ</b>
ቁጥሮቹ ሲጠሩ ከመጫወቻ ካርዳችን ላይ እየመረጥን ወደጎን ወይም ወደታች ወይም ወደሁለቱም አግዳሚ ወይም አራቱን ማእዘናት ከመረጥን ወዲአዉኑ ከታች በኩል bingo የሚለዉን በመንካት ማሸነፍ እንችላለን
ወደጎን ወይም ወደታች ወዪም ወደሁለቱም አግዳሚ ወይም አራቱን ማእዘናት ሳይጠሩ bingo የሚለዉን ክሊክ ካደረግን ከጨዋታው እንታገዳለን
ሁለት ወይም ከዚያ በላይ ተጫዋቾች እኩል ቢያሸንፉ ደራሹ ለ ቀጥራቸው ይካፈላል።`;

/** Parse whatever is stored in Settings.supportItems, falling back to the defaults. */
export function parseSupport(raw: unknown): SupportItem[] {
  if (!Array.isArray(raw) || raw.length === 0) return DEFAULT_SUPPORT;
  const items = raw
    .filter((r): r is Record<string, unknown> => typeof r === 'object' && r !== null)
    .map((r) => ({ label: String(r.label ?? '').trim(), handle: String(r.handle ?? '').trim() }))
    .filter((r) => r.label && r.handle);
  return items.length > 0 ? items : DEFAULT_SUPPORT;
}
