// Round 49: the set-password link's page (LinkPassword.tsx) in English and Sinhala. The site is English; this page is the
// one a new person sees first, from a WhatsApp message, before they have an account, so it carries both languages with a
// switch (the driver app's words where it has them: common.showPassword / hidePassword, office.login.password,
// "වාහන පරිපාලක" for the fleet admin, "සබැඳිය" for a link). Numbers in Latin digits in both.

export type LinkLang = "en" | "si";

export const LINK_WORDS = {
  en: {
    eyebrow: "Your Fame Fleet account",
    title: "Choose a password",
    checking: "Checking your link…",
    forWho: "For {name} · {email}",
    newPassword: "New password",
    again: "Again",
    hint: "At least 6 characters. Longer is safer.",
    tooShort: "Use at least 6 characters.",
    tooLong: "Too long: use at most 72 English letters or numbers (a Sinhala letter counts as 3).",
    differ: "The two passwords differ.",
    save: "Save password",
    saving: "Saving…",
    savedSigningIn: "Password saved. Signing you in…",
    savedSignIn: "Password saved. Sign in with your e-mail and the new password.",
    deadTitle: "This link can't be used",
    dead: "This link has expired or was already used. Ask the fleet admin for a new one.",
    haveOne: "Already chose a password?",
    signIn: "Sign in",
    noAnswer: "Fame Fleet did not answer.",
    tryAgain: "Try again",
    rateLimited: "Too many tries · try again in a minute",
    show: "Show password",
    hide: "Hide password",
    language: "Language",
  },
  si: {
    eyebrow: "ඔබේ Fame Fleet ගිණුම",
    title: "මුරපදයක් තෝරන්න",
    checking: "ඔබේ සබැඳිය පරීක්ෂා කරමින්…",
    forWho: "{name} සඳහා · {email}",
    newPassword: "නව මුරපදය",
    again: "මුරපදය නැවත",
    hint: "අවම වශයෙන් අක්ෂර 6ක්. දිගු වන තරමට ආරක්ෂිතයි.",
    tooShort: "අවම වශයෙන් අක්ෂර 6ක් භාවිත කරන්න.",
    tooLong: "දිග වැඩියි: උපරිම ඉංග්‍රීසි අකුරු හෝ ඉලක්කම් 72ක් භාවිත කරන්න (සිංහල අකුරක් 3ක් ලෙස ගණන් වේ).",
    differ: "මුරපද දෙක එකිනෙකට වෙනස්ය.",
    save: "මුරපදය සුරකින්න",
    saving: "සුරකිමින්…",
    savedSigningIn: "මුරපදය සුරැකිණි. ඔබව ඇතුළු කරමින්…",
    savedSignIn: "මුරපදය සුරැකිණි. ඔබේ ඊමේල් සහ නව මුරපදයෙන් ඇතුළු වන්න.",
    deadTitle: "මෙම සබැඳිය භාවිත කළ නොහැක",
    dead: "මෙම සබැඳිය කල් ඉකුත් වී හෝ දැනටමත් භාවිත කර ඇත. නව එකක් සඳහා වාහන පරිපාලකගෙන් ඉල්ලන්න.",
    haveOne: "දැනටමත් මුරපදයක් තෝරා ඇත්ද?",
    signIn: "ඇතුළු වන්න",
    noAnswer: "Fame Fleet පිළිතුරු දුන්නේ නැත.",
    tryAgain: "නැවත උත්සාහ කරන්න",
    rateLimited: "උත්සාහයන් වැඩියි · මිනිත්තුවකින් නැවත උත්සාහ කරන්න",
    show: "මුරපදය පෙන්වන්න",
    hide: "මුරපදය සඟවන්න",
    language: "භාෂාව",
  },
} as const satisfies Record<LinkLang, Record<string, string>>;

export type LinkWord = keyof typeof LINK_WORDS.en;

export function linkWord(lang: LinkLang, key: LinkWord, values: Record<string, string> = {}): string {
  return LINK_WORDS[lang][key].replace(/\{(\w+)\}/g, (_, k: string) => values[k] ?? "");
}

/** The token a link carries after "#k=" (43 characters, base64url); null when there is none. */
export function linkToken(hash: string): string | null {
  const m = /[#&]k=([A-Za-z0-9_-]{43})(?:&|$)/.exec(hash);
  return m ? m[1] : null;
}

/**
 * /set-password opens the link page unless it is one of Supabase's old recovery landings (`type=recovery` in the hash,
 * links made before Round 49, handled by AuthProvider as before). An old link that was already used lands with
 * `#error=…&error_code=otp_expired`: the link page shows its "can't be used" sentence for it, never the bare sign-in.
 */
export function isLinkLanding(path: string, hash: string): boolean {
  return path.replace(/\/+$/, "") === "/set-password" && !/[#&]type=recovery(&|$)/.test(hash);
}

/** The page's language: the one chosen before on this browser, else the browser's (Sinhala when it says si), else English. */
export function startLang(saved: string | null, browser: string | undefined): LinkLang {
  if (saved === "en" || saved === "si") return saved;
  return (browser ?? "").toLowerCase().startsWith("si") ? "si" : "en";
}
