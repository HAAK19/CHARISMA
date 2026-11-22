import React, { useState } from 'react';
import { Download, Smartphone, X } from 'lucide-react';
import { AppLanguage } from '../types/charisma';
import { usePWAInstall } from '../hooks/usePWAInstall';

interface PWAInstallButtonProps {
  language: AppLanguage;
  accentColor?: string;
  showGuideWhenUnavailable?: boolean;
  compact?: boolean;
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({
  language,
  accentColor = '#00E5FF',
  showGuideWhenUnavailable = false,
  compact = false,
}) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showGuideModal, setShowGuideModal] = useState(false);

  if (isInstalled) {
    return null;
  }

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={() => {
          install();
        }}
        title={language === 'ar' ? 'تثبيت CHARISMA على جهازك' : 'Install CHARISMA App'}
        className={`flex items-center justify-center gap-1.5 rounded-xl font-semibold text-[#041018] shadow-sm transition hover:opacity-90 ${
          compact ? 'min-h-[38px] px-3 text-xs' : 'min-h-[40px] px-4 text-xs'
        }`}
        style={{ backgroundColor: accentColor }}
      >
        <Download className="w-4 h-4 shrink-0" />
        <span>{language === 'ar' ? 'تثبيت التطبيق' : 'Install App'}</span>
      </button>
    );
  }

  if (isIOS || showGuideWhenUnavailable) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowGuideModal(true)}
          className={`flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 dark:border-white/15 font-semibold transition hover:bg-slate-100 dark:hover:bg-white/10 ${
            compact ? 'min-h-[38px] px-3 text-xs' : 'min-h-[40px] px-4 text-xs'
          }`}
        >
          <Smartphone className="w-4 h-4 shrink-0 text-cyan-500" />
          <span>
            {isIOS
              ? language === 'ar'
                ? 'تثبيت على iPhone'
                : 'Install on iOS'
              : language === 'ar'
              ? 'تثبيت على الهاتف'
              : 'Install on Phone'}
          </span>
        </button>

        {showGuideModal && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/65 backdrop-blur-xs p-4">
            <div className="w-full max-w-sm rounded-3xl bg-white dark:bg-[#0C1222] border border-slate-200 dark:border-white/15 p-6 space-y-4 shadow-2xl text-start">
              <div className="flex items-center justify-between">
                <h3 className="font-display text-sm font-bold flex items-center gap-2">
                  <Smartphone className="w-4 h-4 text-cyan-500" />
                  <span>
                    {isIOS
                      ? language === 'ar'
                        ? 'تثبيت CHARISMA على iPhone / iPad'
                        : 'Install CHARISMA on iPhone / iPad'
                      : language === 'ar'
                      ? 'تثبيت CHARISMA على Android / Desktop'
                      : 'Install CHARISMA on Android / Desktop'}
                  </span>
                </h3>
                <button
                  type="button"
                  onClick={() => setShowGuideModal(false)}
                  className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-white/10"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {isIOS ? (
                <ol className="space-y-2 text-xs text-slate-600 dark:text-[#9AA8C7] list-decimal list-inside leading-relaxed">
                  <li>
                    {language === 'ar'
                      ? 'اضغط زر المشاركة (Share) في شريط Safari.'
                      : 'Tap the Share button in the Safari toolbar.'}
                  </li>
                  <li>
                    {language === 'ar'
                      ? 'مرر للأسفل واختر «إضافة إلى الشاشة الرئيسية» (Add to Home Screen).'
                      : 'Scroll down and tap "Add to Home Screen".'}
                  </li>
                  <li>
                    {language === 'ar'
                      ? 'اضغط «إضافة» ليظهر التطبيق بأيقونته المستقلة.'
                      : 'Tap Add to launch CHARISMA in standalone app mode.'}
                  </li>
                </ol>
              ) : (
                <ol className="space-y-2 text-xs text-slate-600 dark:text-[#9AA8C7] list-decimal list-inside leading-relaxed">
                  <li>
                    {language === 'ar'
                      ? 'افتح التطبيق مباشرة في متصفح Chrome على الهاتف (وليس داخل إطار المعاينة).'
                      : 'Open the app URL directly in Chrome on your phone (outside iframe preview).'}
                  </li>
                  <li>
                    {language === 'ar'
                      ? 'اضغط قائمة (⋮) في متصفح Chrome واختر «تثبيت التطبيق» أو «الإضافة إلى الشاشة الرئيسية».'
                      : 'Tap the Chrome menu (⋮) and choose "Install App" or "Add to Home Screen".'}
                  </li>
                  <li>
                    {language === 'ar'
                      ? 'يعمل التطبيق بعدها بنافذة مستقلة دون شريط متصفح وبكامل المزايا اللامركزية.'
                      : 'CHARISMA then launches as a standalone app with offline shell caching.'}
                  </li>
                </ol>
              )}

              <button
                type="button"
                onClick={() => setShowGuideModal(false)}
                className="w-full min-h-[40px] rounded-xl text-xs font-semibold text-[#041018]"
                style={{ backgroundColor: accentColor }}
              >
                {language === 'ar' ? 'حسناً' : 'Got it'}
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
};
