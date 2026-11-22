import { AppLanguage } from '../types/charisma';

export type LocalAssistAction = 'summarize' | 'clean_format' | 'suggest_replies' | 'stats';

function isMostlyArabic(text: string): boolean {
  const arabicMatches = text.match(/[\u0600-\u06FF]/g)?.length ?? 0;
  const latinMatches = text.match(/[a-zA-Z]/g)?.length ?? 0;
  return arabicMatches >= latinMatches;
}

export function summarizeTextLocally(text: string, lang: AppLanguage): string {
  const clean = text.trim();
  if (!clean) return '';

  const lines = clean
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length <= 3) {
    return lines.map((l) => `• ${l}`).join('\n');
  }

  const wordFreq = new Map<string, number>();
  const tokens = clean.toLowerCase().split(/[\s.,!?؟،؛:()[\]"]+/).filter((w) => w.length > 2);
  for (const tok of tokens) {
    wordFreq.set(tok, (wordFreq.get(tok) || 0) + 1);
  }

  const scored = lines.map((line, index) => {
    const words = line.toLowerCase().split(/[\s.,!?؟،؛:()[\]"]+/).filter(Boolean);
    const freqScore = words.reduce((acc, w) => acc + (wordFreq.get(w) || 0), 0);
    const recencyBoost = index >= lines.length - 3 ? 2 : 0;
    return { line, index, score: freqScore / Math.max(1, words.length) + recencyBoost };
  });

  const top = scored
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .sort((a, b) => a.index - b.index);

  const header =
    lang === 'ar'
      ? 'ملخص محلي سريع (دون إرسال أي بيانات للخارج):'
      : 'Local Offline Summary (Zero data sent externally):';

  return `${header}\n${top.map((item) => `• ${item.line}`).join('\n')}`;
}

export function cleanAndFormatTextLocally(text: string): string {
  let out = text.trim().replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n');
  if (isMostlyArabic(out)) {
    // Normalize tatweel & extra spaces before Arabic punctuation
    out = out
      .replace(/ـ+/g, '')
      .replace(/\s+([،؛؟.!])/g, '$1');
  } else {
    // Capitalize first letter of sentences
    out = out.replace(/(^\s*[a-z])|([.!?]\s+[a-z])/g, (m) => m.toUpperCase());
  }
  return out;
}

export function suggestRepliesLocally(text: string, fallbackLang: AppLanguage): string[] {
  const clean = text.trim().toLowerCase();
  const arabic = clean ? isMostlyArabic(clean) : fallbackLang === 'ar';

  if (arabic) {
    if (clean.includes('؟') || clean.includes('متى') || clean.includes('أين') || clean.includes('كيف')) {
      return ['سأتحقق من ذلك وأرد عليك فوراً.', 'مناسب تماماً، دعنا نؤكد الموعد.', 'حسناً، أرسل لي التفاصيل عندما تجهز.'];
    }
    if (clean.includes('شكر') || clean.includes('ممتاز') || clean.includes('رائع')) {
      return ['على الرحب والسعة!', 'يسعدني ذلك، بالتوفيق دائماً.', 'لا شكر على واجب، أخبرني إذا احتجت أي شيء.'];
    }
    if (clean.includes('سلام') || clean.includes('مرحبا') || clean.includes('أهلا')) {
      return ['وعليكم السلام ورحمة الله، أهلاً بك!', 'أهلاً! كيف يمكنني مساعدتك اليوم؟', 'مرحباً، أتمنى لك يوماً سعيداً.'];
    }
    return ['تم الاستلام، شكراً لك.', 'مفهوم تماماً، سأتابع معك قريباً.', 'فكرة ممتازة، موافق!'];
  }

  if (clean.includes('?') || clean.includes('when') || clean.includes('where') || clean.includes('how')) {
    return ['Let me check and get back to you shortly.', 'Sounds good—let us confirm the details.', 'Sure, send over the details whenever ready.'];
  }
  if (clean.includes('thank') || clean.includes('great') || clean.includes('awesome')) {
    return ['You are very welcome!', 'Glad to help anytime.', 'Happy to hear that—let me know if you need anything else.'];
  }
  if (clean.includes('hello') || clean.includes('hi ') || clean === 'hi' || clean.includes('hey')) {
    return ['Hello! How are you doing today?', 'Hey there! Ready whenever you are.', 'Hi! Good to hear from you.'];
  }
  return ['Received, thank you!', 'Got it—I will follow up soon.', 'Sounds great, works for me.'];
}

export function analyzeTextStatsLocally(text: string, lang: AppLanguage): string {
  const clean = text.trim();
  const words = clean ? clean.split(/\s+/).length : 0;
  const chars = clean.length;
  const lines = clean ? clean.split(/\n+/).length : 0;
  const readMin = Math.max(1, Math.ceil(words / 180));
  if (lang === 'ar') {
    return `الإحصائيات المحلية:\n• الكلمات: ${words}\n• الأحرف: ${chars}\n• الأسطر: ${lines}\n• وقت القراءة التقديري: ~${readMin} دقيقة`;
  }
  return `Local Text Metrics:\n• Words: ${words}\n• Characters: ${chars}\n• Lines: ${lines}\n• Est. Read Time: ~${readMin} min`;
}

export function runLocalTextAssistant(
  action: LocalAssistAction,
  text: string,
  lang: AppLanguage,
): { result?: string; suggestions?: string[] } {
  if (action === 'suggest_replies') {
    return { suggestions: suggestRepliesLocally(text, lang) };
  }
  if (action === 'clean_format') {
    return { result: cleanAndFormatTextLocally(text) };
  }
  if (action === 'stats') {
    return { result: analyzeTextStatsLocally(text, lang) };
  }
  return { result: summarizeTextLocally(text, lang) };
}
