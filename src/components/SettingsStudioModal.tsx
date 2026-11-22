import React, { useEffect, useState } from 'react';
import {
  Activity,
  Camera,
  Copy,
  Download,
  Eye,
  EyeOff,
  Fingerprint,
  KeyRound,
  Lock,
  Palette,
  Radio,
  RefreshCw,
  Server,
  Shield,
  Trash2,
  User,
  X,
} from 'lucide-react';
import {
  AppLanguage,
  CustomizationConfig,
  PrivacyPlusConfig,
  PublicUser,
  RelayConfig,
} from '../types/charisma';
import { TRANSLATIONS } from '../i18n/translations';
import { hashPin } from '../crypto/charismaCrypto';
import { exportNip49EncryptedBackup } from '../nostr/nostrIdentity';
import { RelayPingResult } from '../nostr/nostrRelayPool';
import { isBiometricAvailable, registerBiometricLock } from '../utils/biometricLock';
import { getPageCardStyle, getPageShellStyle, resizeGalleryImageToDataUrl } from '../utils/themeEngine';
import { PWAInstallButton } from './PWAInstallButton';
import { UserAvatar } from './UserAvatar';

interface SettingsStudioModalProps {
  language: AppLanguage;
  currentUser: PublicUser;
  nostrPrivateKeyHex?: string;
  nsec?: string;
  relays: RelayConfig[];
  connectedRelayCount: number;
  totalRelayCount: number;
  customization: CustomizationConfig;
  privacy: PrivacyPlusConfig;
  blockedUserIds: string[];
  onClose: () => void;
  onOpenThemeStudio: () => void;
  onOpenRelaysModal: () => void;
  onPingRelay: (relayUrl: string) => Promise<RelayPingResult>;
  onPublishProfileAndRelays: () => Promise<{ publishedRelays: string[]; failedRelays: string[] }>;
  onVerifyAccountPassword: (password: string) => Promise<boolean>;
  onChangeLanguage: (lang: AppLanguage) => void;
  onUpdateCustomization: (patch: Partial<CustomizationConfig>) => void;
  onUpdatePrivacy: (patch: Partial<PrivacyPlusConfig>) => void;
  onUpdateProfile: (patch: {
    displayName?: string;
    bio?: string;
    username?: string;
    avatarDataUrl?: string;
    hideOnline?: boolean;
    hideLastSeen?: boolean;
    allowSearchByDisplayName?: boolean;
  }) => Promise<void>;
  onChangePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  onUnblockUser: (userId: string) => void;
  onDeleteAccount: () => Promise<void>;
  onWipeAllDeviceData: () => Promise<void>;
  onSignOut: () => void;
}

export const SettingsStudioModal: React.FC<SettingsStudioModalProps> = ({
  language,
  currentUser,
  nostrPrivateKeyHex,
  nsec,
  relays,
  connectedRelayCount,
  totalRelayCount,
  customization,
  privacy,
  blockedUserIds,
  onClose,
  onOpenThemeStudio,
  onOpenRelaysModal,
  onPingRelay,
  onPublishProfileAndRelays,
  onVerifyAccountPassword,
  onChangeLanguage,
  onUpdateCustomization,
  onUpdatePrivacy,
  onUpdateProfile,
  onChangePassword,
  onUnblockUser,
  onDeleteAccount,
  onWipeAllDeviceData,
  onSignOut,
}) => {
  const t = TRANSLATIONS[language];
  const [tab, setTab] = useState<'theme' | 'privacy' | 'account' | 'diagnostics'>('theme');

  // Relay Ping Diagnostics State
  const [pingResults, setPingResults] = useState<Record<string, RelayPingResult>>({});
  const [pingingUrls, setPingingUrls] = useState<Record<string, boolean>>({});
  const [pingingAll, setPingingAll] = useState(false);
  const [customProbeUrl, setCustomProbeUrl] = useState('');
  const [customProbeResult, setCustomProbeResult] = useState<RelayPingResult | null>(null);
  const [pingingCustom, setPingingCustom] = useState(false);

  const [displayName, setDisplayName] = useState(currentUser.displayName);
  const [bio, setBio] = useState(currentUser.bio);
  const [username, setUsername] = useState(currentUser.username);
  const [avatarDataUrl, setAvatarDataUrl] = useState<string | undefined>(currentUser.avatarDataUrl);
  const [allowSearchDisplayName, setAllowSearchDisplayName] = useState<boolean>(
    currentUser.allowSearchByDisplayName ?? true,
  );
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Nostr Backup & Key Reveal
  const [backupPwd, setBackupPwd] = useState('');
  const [ncryptsecOut, setNcryptsecOut] = useState<string | null>(null);
  const [revealPwd, setRevealPwd] = useState('');
  const [nsecRevealed, setNsecRevealed] = useState(false);
  const [publishingProfile, setPublishingProfile] = useState(false);

  // Biometric WebAuthn availability
  const [bioSupported, setBioSupported] = useState(false);
  useEffect(() => {
    isBiometricAvailable().then(setBioSupported);
  }, []);

  // Change Password
  const [currentPwd, setCurrentPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [confirmNewPwd, setConfirmNewPwd] = useState('');

  // Confirmations (no window.confirm/window.alert per iFrame constraints)
  const [confirmDeleteStep, setConfirmDeleteStep] = useState<'none' | 'account' | 'wipe'>('none');
  const [showPinSetup, setShowPinSetup] = useState(false);
  const [pinInput, setPinInput] = useState('');

  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  function handleCopyText(val: string, label: string) {
    navigator.clipboard?.writeText(val).catch(() => {});
    setCopiedKey(label);
    window.setTimeout(() => setCopiedKey(null), 1600);
  }

  function handleGenerateNip49Backup(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg(null);
    setStatusMsg(null);
    if (!nostrPrivateKeyHex) {
      setErrorMsg('Nostr key unavailable in active session');
      return;
    }
    try {
      const enc = exportNip49EncryptedBackup(nostrPrivateKeyHex, backupPwd);
      setNcryptsecOut(enc);
      setStatusMsg(
        language === 'ar'
          ? 'تم إنشاء نسخة احتياطية مشفرة بصيغة NIP-49 (ncryptsec1)'
          : 'NIP-49 encrypted backup (ncryptsec1) generated locally',
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to encrypt backup');
    }
  }

  function handleDownloadNostrBackupJson() {
    if (!ncryptsecOut) return;
    const doc = {
      app: 'CHARISMA',
      format: 'nostr-nip49-v1',
      username: currentUser.username,
      npub: currentUser.npub,
      ncryptsec: ncryptsecOut,
      relays: currentUser.relayHints || [],
      exportedAt: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${currentUser.username}.charisma-nostr-backup.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleRevealNsec(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg(null);
    const ok = await onVerifyAccountPassword(revealPwd);
    if (!ok) {
      setErrorMsg(language === 'ar' ? 'كلمة مرور الحساب غير صحيحة' : 'Account password is incorrect');
      return;
    }
    setNsecRevealed(true);
    setRevealPwd('');
  }

  async function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      await onUpdateProfile({
        displayName: displayName.trim() || username.trim(),
        bio,
        username,
        avatarDataUrl,
        allowSearchByDisplayName: allowSearchDisplayName,
      });
      setStatusMsg(language === 'ar' ? 'تم تحديث الملف الشخصي محلياً' : 'Local profile updated');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to update profile');
    }
  }

  async function handleChangePasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg(null);
    setStatusMsg(null);
    if (newPwd.length < 6) {
      setErrorMsg(
        language === 'ar'
          ? 'يجب أن تتكون كلمة المرور الجديدة من 6 أحرف على الأقل'
          : 'New password must be at least 6 characters',
      );
      return;
    }
    if (newPwd !== confirmNewPwd) {
      setErrorMsg(
        language === 'ar'
          ? 'كلمة المرور الجديدة وتأكيدها غير متطابقتين'
          : 'New passwords do not match',
      );
      return;
    }
    try {
      await onChangePassword(currentPwd, newPwd);
      setCurrentPwd('');
      setNewPwd('');
      setConfirmNewPwd('');
      setStatusMsg(
        language === 'ar'
          ? 'تم تغيير كلمة المرور وإعادة تشفير مفاتيحك المحلية بنجاح'
          : 'Password changed & local encryption keys re-wrapped',
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not change password');
    }
  }

  async function handleSaveAppLockPin(e: React.FormEvent) {
    e.preventDefault();
    if (!pinInput.trim()) return;
    const hashed = await hashPin(pinInput.trim());
    onUpdatePrivacy({ appLockEnabled: true, appLockPinHash: hashed });
    setPinInput('');
    setShowPinSetup(false);
  }

  async function handlePingSingleRelay(url: string) {
    setPingingUrls((prev) => ({ ...prev, [url]: true }));
    try {
      const res = await onPingRelay(url);
      setPingResults((prev) => ({ ...prev, [url]: res }));
    } finally {
      setPingingUrls((prev) => ({ ...prev, [url]: false }));
    }
  }

  async function handlePingAllRelays() {
    if (relays.length === 0) return;
    setPingingAll(true);
    try {
      await Promise.all(relays.map((r) => handlePingSingleRelay(r.url)));
    } finally {
      setPingingAll(false);
    }
  }

  async function handlePingCustomUrl(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = customProbeUrl.trim();
    if (!trimmed) return;
    setPingingCustom(true);
    try {
      const res = await onPingRelay(trimmed);
      setCustomProbeResult(res);
    } finally {
      setPingingCustom(false);
    }
  }

  function renderLatencyQuality(latencyMs: number | null, ok: boolean) {
    if (!ok || latencyMs === null) {
      return {
        label: language === 'ar' ? 'فشل الاتصال' : 'Unreachable',
        badgeClass: 'bg-rose-500/15 text-rose-500 border-rose-500/30',
      };
    }
    if (latencyMs <= 150) {
      return {
        label: language === 'ar' ? 'ممتاز' : 'Excellent',
        badgeClass: 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30',
      };
    }
    if (latencyMs <= 400) {
      return {
        label: language === 'ar' ? 'جيد' : 'Good',
        badgeClass: 'bg-cyan-500/15 text-cyan-500 border-cyan-500/30',
      };
    }
    return {
      label: language === 'ar' ? 'بطيء' : 'High Latency',
      badgeClass: 'bg-amber-500/15 text-amber-500 border-amber-500/30',
    };
  }

  const settingsShellStyle = getPageShellStyle(customization, 'settings');
  const settingsCardStyle = getPageCardStyle(customization, 'settings');

  return (
    <div className="fixed inset-0 z-50 bg-black/65 backdrop-blur-xs flex items-center justify-center p-4">
      <div
        className="max-w-4xl w-full max-h-[90vh] bg-white dark:bg-[#0C1222] border border-slate-200 dark:border-white/15 rounded-3xl overflow-hidden flex flex-col"
        style={settingsShellStyle}
      >
        <header className="px-6 py-4 border-b border-slate-200 dark:border-white/10 flex items-center justify-between" style={settingsCardStyle}>
          <h2 className="font-display text-lg font-bold">{t.settingsTitle}</h2>
          <button type="button" onClick={onClose} className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-white/10">
            <X className="w-5 h-5" />
          </button>
        </header>

        <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
          <nav className="md:w-56 border-b md:border-b-0 md:border-e border-slate-200 dark:border-white/10 p-3 flex md:flex-col gap-1 overflow-x-auto">
            {[
              { id: 'theme', label: t.navCustomize, icon: Palette },
              { id: 'privacy', label: t.privacyPlusTitle, icon: Shield },
              { id: 'account', label: t.accountActionsTitle, icon: User },
              {
                id: 'diagnostics',
                label: language === 'ar' ? 'تشخيص الـ Relays' : 'Relay Diagnostics',
                icon: Activity,
              },
            ].map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setTab(item.id as typeof tab)}
                  className={`px-3.5 py-2.5 rounded-xl text-xs font-semibold flex items-center gap-2.5 whitespace-nowrap ${
                    tab === item.id
                      ? 'bg-cyan-500/15 text-cyan-700 dark:text-[#00E5FF]'
                      : 'text-slate-600 dark:text-[#9AA8C7] hover:bg-slate-100 dark:hover:bg-white/5'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>

          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {statusMsg && <div className="p-3 rounded-xl bg-emerald-500/10 text-emerald-500 text-xs">{statusMsg}</div>}
            {errorMsg && <div className="p-3 rounded-xl bg-red-500/10 text-red-500 text-xs">{errorMsg}</div>}

            {tab === 'theme' && (
              <div className="space-y-6">
                <div
                  className="p-4 rounded-2xl border border-cyan-500/35 bg-cyan-500/10 flex flex-wrap items-center justify-between gap-3"
                  style={settingsCardStyle}
                >
                  <div className="space-y-0.5">
                    <h3 className="text-sm font-bold">{t.themeStudioTitle}</h3>
                    <p className="text-xs opacity-75">{t.themeStudioSubtitle}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onOpenThemeStudio();
                    }}
                    className="min-h-[40px] px-4 rounded-xl text-xs font-semibold text-[#041018]"
                    style={{ backgroundColor: customization.primaryAccent }}
                  >
                    {language === 'ar' ? 'فتح استوديو التصميم الكامل' : 'Open Theme Studio'}
                  </button>
                </div>

                <div
                  className="p-4 rounded-2xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#05070D]/60 flex flex-wrap items-center justify-between gap-3"
                  style={settingsCardStyle}
                >
                  <div className="space-y-0.5 max-w-md">
                    <h3 className="text-sm font-bold">
                      {language === 'ar' ? 'تثبيت التطبيق على جهازك (PWA)' : 'Install CHARISMA App (PWA)'}
                    </h3>
                    <p className="text-xs opacity-75">
                      {language === 'ar'
                        ? 'ثبّت CHARISMA كتطبيق مستقل بدون شريط متصفح مع تشغيل كامل لخزنة البيانات المحلية دون إنترنت.'
                        : 'Install CHARISMA as a standalone app with offline shell caching and local encrypted vault support.'}
                    </p>
                  </div>
                  <PWAInstallButton
                    language={language}
                    accentColor={customization.primaryAccent}
                    showGuideWhenUnavailable
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-semibold text-slate-500">{t.themeLabel}</label>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => onUpdateCustomization({ themeMode: 'dark', wallpaper: 'silk_dark' })}
                      className={`p-3 rounded-xl border text-xs font-semibold ${
                        customization.themeMode === 'dark' ? 'border-cyan-500 bg-cyan-500/10' : 'border-slate-200 dark:border-white/10'
                      }`}
                    >
                      {t.themeDark}
                    </button>
                    <button
                      type="button"
                      onClick={() => onUpdateCustomization({ themeMode: 'light', wallpaper: 'clean_light' })}
                      className={`p-3 rounded-xl border text-xs font-semibold ${
                        customization.themeMode === 'light' ? 'border-cyan-500 bg-cyan-500/10' : 'border-slate-200 dark:border-white/10'
                      }`}
                    >
                      {t.themeLight}
                    </button>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-semibold text-slate-500">{t.languageLabel}</label>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => onChangeLanguage('en')}
                      className={`p-3 rounded-xl border text-xs font-semibold ${
                        language === 'en' ? 'border-cyan-500 bg-cyan-500/10' : 'border-slate-200 dark:border-white/10'
                      }`}
                    >
                      English (LTR)
                    </button>
                    <button
                      type="button"
                      onClick={() => onChangeLanguage('ar')}
                      className={`p-3 rounded-xl border text-xs font-semibold ${
                        language === 'ar' ? 'border-cyan-500 bg-cyan-500/10' : 'border-slate-200 dark:border-white/10'
                      }`}
                    >
                      العربية (RTL)
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <label className="space-y-1 text-xs">
                    <span>{language === 'ar' ? 'اللون الأساسي' : 'Primary Accent'}</span>
                    <input
                      type="color"
                      value={customization.primaryAccent}
                      onChange={(e) => onUpdateCustomization({ primaryAccent: e.target.value })}
                      className="w-full h-10 rounded-lg cursor-pointer"
                    />
                  </label>
                  <label className="space-y-1 text-xs">
                    <span>{language === 'ar' ? 'اللون الثانوي' : 'Secondary Accent'}</span>
                    <input
                      type="color"
                      value={customization.secondaryAccent}
                      onChange={(e) => onUpdateCustomization({ secondaryAccent: e.target.value })}
                      className="w-full h-10 rounded-lg cursor-pointer"
                    />
                  </label>
                  <label className="space-y-1 text-xs">
                    <span>{language === 'ar' ? 'فقاعة المرسل' : 'Outgoing Bubble'}</span>
                    <input
                      type="color"
                      value={customization.outgoingBubbleColor}
                      onChange={(e) => onUpdateCustomization({ outgoingBubbleColor: e.target.value })}
                      className="w-full h-10 rounded-lg cursor-pointer"
                    />
                  </label>
                  <label className="space-y-1 text-xs">
                    <span>{language === 'ar' ? 'فقاعة المستلم' : 'Incoming Bubble'}</span>
                    <input
                      type="color"
                      value={customization.incomingBubbleColor}
                      onChange={(e) => onUpdateCustomization({ incomingBubbleColor: e.target.value })}
                      className="w-full h-10 rounded-lg cursor-pointer"
                    />
                  </label>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1.5">{t.bubbleStyleLabel}</label>
                    <select
                      value={customization.bubbleStyle}
                      onChange={(e) => onUpdateCustomization({ bubbleStyle: e.target.value as CustomizationConfig['bubbleStyle'] })}
                      className="w-full min-h-[40px] px-3 rounded-xl bg-slate-100 dark:bg-[#05070D] text-xs"
                    >
                      <option value="futuristic">Futuristic Cut</option>
                      <option value="balanced">Balanced</option>
                      <option value="classic">Classic</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1.5">{t.densityLabel}</label>
                    <select
                      value={customization.density}
                      onChange={(e) => onUpdateCustomization({ density: e.target.value as CustomizationConfig['density'] })}
                      className="w-full min-h-[40px] px-3 rounded-xl bg-slate-100 dark:bg-[#05070D] text-xs"
                    >
                      <option value="compact">Compact</option>
                      <option value="comfortable">Comfortable</option>
                      <option value="spacious">Spacious</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1.5">Font Scale ({customization.fontScale.toFixed(1)}x)</label>
                    <input
                      type="range"
                      min={0.85}
                      max={1.3}
                      step={0.05}
                      value={customization.fontScale}
                      onChange={(e) => onUpdateCustomization({ fontScale: Number(e.target.value) })}
                      className="w-full mt-2"
                    />
                  </div>
                </div>
              </div>
            )}

            {tab === 'privacy' && (
              <div className="space-y-4">
                {[
                  {
                    key: 'hideOnlineStatus' as const,
                    label: language === 'ar' ? 'إخفاء حالة النشاط المحلي' : 'Hide Local Active Status',
                    onChange: (v: boolean) => {
                      onUpdatePrivacy({ hideOnlineStatus: v });
                      onUpdateProfile({ hideOnline: v });
                    },
                  },
                  {
                    key: 'hideLastSeen' as const,
                    label: language === 'ar' ? 'إخفاء آخر ظهور' : 'Hide Last Seen',
                    onChange: (v: boolean) => {
                      onUpdatePrivacy({ hideLastSeen: v });
                      onUpdateProfile({ hideLastSeen: v });
                    },
                  },
                  {
                    key: 'sendReadReceipts' as const,
                    label: language === 'ar' ? 'إرسال مؤشرات القراءة' : 'Send Read Receipts',
                    onChange: (v: boolean) => onUpdatePrivacy({ sendReadReceipts: v }),
                  },
                  {
                    key: 'sendTypingIndicators' as const,
                    label: language === 'ar' ? 'إظهار مؤشر الكتابة' : 'Send Typing Indicators',
                    onChange: (v: boolean) => onUpdatePrivacy({ sendTypingIndicators: v }),
                  },
                  {
                    key: 'sendRecordingIndicators' as const,
                    label: language === 'ar' ? 'إظهار مؤشر التسجيل الصوتي' : 'Send Recording Indicators',
                    onChange: (v: boolean) => onUpdatePrivacy({ sendRecordingIndicators: v }),
                  },
                  {
                    key: 'hideNotificationPreviews' as const,
                    label: language === 'ar' ? 'إخفاء محتوى الرسالة في الإشعارات' : 'Hide Notification Message Previews',
                    onChange: (v: boolean) => onUpdatePrivacy({ hideNotificationPreviews: v }),
                  },
                ].map((item) => (
                  <label key={item.key} className="flex items-center justify-between p-3 rounded-xl bg-slate-50 dark:bg-[#05070D] text-sm cursor-pointer">
                    <span>{item.label}</span>
                    <input
                      type="checkbox"
                      checked={privacy[item.key]}
                      onChange={(e) => item.onChange(e.target.checked)}
                    />
                  </label>
                ))}

                <label className="flex items-center justify-between p-3 rounded-xl bg-slate-50 dark:bg-[#05070D] text-sm cursor-pointer">
                  <span>{t.allowSearchDisplayNameLabel}</span>
                  <input
                    type="checkbox"
                    checked={allowSearchDisplayName}
                    onChange={(e) => {
                      const val = e.target.checked;
                      setAllowSearchDisplayName(val);
                      onUpdateProfile({ allowSearchByDisplayName: val });
                    }}
                  />
                </label>

                <div className="p-4 rounded-xl bg-slate-50 dark:bg-[#05070D] space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium flex items-center gap-2">
                      <Lock className="w-4 h-4 text-cyan-500" />
                      {language === 'ar' ? 'قفل التطبيق برمز PIN' : 'App Lock PIN'}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        if (privacy.appLockEnabled) {
                          onUpdatePrivacy({ appLockEnabled: false, appLockPinHash: undefined });
                        } else {
                          setShowPinSetup((s) => !s);
                        }
                      }}
                      className="px-3 py-1.5 rounded-lg bg-cyan-600 text-white text-xs font-semibold"
                    >
                      {privacy.appLockEnabled
                        ? language === 'ar' ? 'تعطيل' : 'Disable'
                        : language === 'ar' ? 'تفعيل' : 'Enable'}
                    </button>
                  </div>
                  {showPinSetup && (
                    <form onSubmit={handleSaveAppLockPin} className="flex gap-2">
                      <input
                        type="password"
                        value={pinInput}
                        onChange={(e) => setPinInput(e.target.value)}
                        placeholder={language === 'ar' ? 'أدخل رمز PIN...' : 'Enter new PIN...'}
                        className="flex-1 min-h-[38px] px-3 rounded-lg bg-white dark:bg-[#0C1222] text-xs font-mono-tabular"
                      />
                      <button type="submit" className="px-4 rounded-lg bg-cyan-600 text-white text-xs font-semibold">
                        {t.save}
                      </button>
                    </form>
                  )}
                </div>

                <div className="p-4 rounded-xl bg-slate-50 dark:bg-[#05070D] space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium flex items-center gap-2">
                      <Fingerprint className="w-4 h-4 text-violet-500" />
                      {t.biometricLockLabel}
                    </span>
                    <button
                      type="button"
                      disabled={!bioSupported && !privacy.biometricCredentialId}
                      onClick={async () => {
                        setErrorMsg(null);
                        setStatusMsg(null);
                        if (privacy.biometricCredentialId) {
                          onUpdatePrivacy({ biometricCredentialId: undefined });
                          setStatusMsg(language === 'ar' ? 'تم إزالة قفل البصمة' : 'Biometric lock removed');
                          return;
                        }
                        try {
                          const credId = await registerBiometricLock(currentUser.username);
                          onUpdatePrivacy({ appLockEnabled: true, biometricCredentialId: credId });
                          setStatusMsg(
                            language === 'ar'
                              ? 'تم تفعيل قفل البصمة / WebAuthn بنجاح'
                              : 'Biometric / WebAuthn app lock enabled',
                          );
                        } catch (err) {
                          setErrorMsg(err instanceof Error ? err.message : 'Biometric setup failed');
                        }
                      }}
                      className="px-3 py-1.5 rounded-lg bg-violet-600 text-white text-xs font-semibold disabled:opacity-40"
                    >
                      {privacy.biometricCredentialId
                        ? language === 'ar' ? 'إزالة البصمة' : 'Remove'
                        : language === 'ar' ? 'تسجيل البصمة' : 'Enable'}
                    </button>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-[#9AA8C7]">
                    {bioSupported
                      ? language === 'ar'
                        ? 'متاح على هذا الجهاز. يُنصح بتفعيل رمز PIN كخيار احتياطي أيضاً.'
                        : 'Platform authenticator detected. Keep a PIN enabled as fallback.'
                      : language === 'ar'
                      ? 'مستشعر البصمة عبر المتصفح غير متاح في هذه الجلسة — على تطبيق أندرويد الأصلي يعمل عبر Android BiometricPrompt.'
                      : 'Browser WebAuthn platform authenticator unavailable here — on native Android this uses Android BiometricPrompt.'}
                  </p>
                </div>

                {/* WebRTC STUN & Optional TURN */}
                <div className="p-4 rounded-xl bg-slate-50 dark:bg-[#05070D] space-y-3">
                  <div className="text-sm font-semibold flex items-center gap-2">
                    <Radio className="w-4 h-4 text-cyan-500" />
                    <span>{language === 'ar' ? 'إعدادات شبكة المكالمات WebRTC (STUN / TURN)' : 'WebRTC Call Networking (Free STUN / Optional TURN)'}</span>
                  </div>
                  <div className="space-y-2 text-xs">
                    <div>
                      <label className="block text-slate-500 mb-1">
                        {language === 'ar' ? 'خادم STUN المجاني (اتركه فارغاً لوضع الشبكة المحلية فقط):' : 'Free STUN URL (leave empty for local-only ICE candidates):'}
                      </label>
                      <input
                        type="text"
                        dir="ltr"
                        value={privacy.stunServerUrl ?? ''}
                        onChange={(e) => onUpdatePrivacy({ stunServerUrl: e.target.value.trim() })}
                        placeholder="stun:stun.cloudflare.com:3478"
                        className="w-full min-h-[38px] px-3 rounded-lg bg-white dark:bg-[#0C1222] font-mono-tabular text-xs"
                      />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <input
                        type="text"
                        dir="ltr"
                        value={privacy.customTurnUrl ?? ''}
                        onChange={(e) => onUpdatePrivacy({ customTurnUrl: e.target.value.trim() })}
                        placeholder="Optional turn:your-vps:3478"
                        className="min-h-[38px] px-3 rounded-lg bg-white dark:bg-[#0C1222] font-mono-tabular text-xs"
                      />
                      <input
                        type="text"
                        dir="ltr"
                        value={privacy.customTurnUsername ?? ''}
                        onChange={(e) => onUpdatePrivacy({ customTurnUsername: e.target.value })}
                        placeholder="TURN username"
                        className="min-h-[38px] px-3 rounded-lg bg-white dark:bg-[#0C1222] text-xs"
                      />
                      <input
                        type="password"
                        dir="ltr"
                        value={privacy.customTurnCredential ?? ''}
                        onChange={(e) => onUpdatePrivacy({ customTurnCredential: e.target.value })}
                        placeholder="TURN credential"
                        className="min-h-[38px] px-3 rounded-lg bg-white dark:bg-[#0C1222] text-xs"
                      />
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-[#9AA8C7]">
                      {language === 'ar'
                        ? 'الإشارات مشفرة عبر Nostr NIP-59 مجاناً. خادم STUN المجاني ينجح مع ~80% من الشبكات، بينما الشبكات المؤسسية المقيدة (Symmetric NAT) قد تتطلب خادم TURN ذاتي الاستضافة (coturn).'
                        : 'Signaling is free & encrypted inside Nostr NIP-59. Free STUN handles ~80% of NATs; strict Symmetric NAT networks may require an optional self-hosted coturn TURN server.'}
                    </p>
                  </div>
                </div>

                {/* Encrypted Media Blossom Host & Consent */}
                <div className="p-4 rounded-xl bg-slate-50 dark:bg-[#05070D] space-y-2.5 text-xs">
                  <div className="text-sm font-semibold">
                    {language === 'ar' ? 'خادم الوسائط المشفرة (Blossom BUD-02)' : 'Encrypted Media Host (Blossom BUD-02)'}
                  </div>
                  <input
                    type="text"
                    dir="ltr"
                    value={privacy.freeMediaServerUrl ?? ''}
                    onChange={(e) =>
                      onUpdatePrivacy({
                        freeMediaServerUrl: e.target.value.trim(),
                        mediaServerConsentGranted: false,
                      })
                    }
                    placeholder="https://blossom.primal.net (or your self-hosted Blossom URL)"
                    className="w-full min-h-[38px] px-3 rounded-lg bg-white dark:bg-[#0C1222] font-mono-tabular text-xs"
                  />
                  <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500">
                    <span>
                      {privacy.mediaServerConsentGranted
                        ? language === 'ar'
                          ? 'تمت الموافقة على رفع الملفات المشفرة بـ AES-256-GCM إلى هذا الخادم.'
                          : 'User consent granted for AES-256-GCM encrypted uploads to this host.'
                        : language === 'ar'
                        ? 'يُطلب منك التأكيد الصريح قبل رفع أي ملف مشفر لخادم خارجي.'
                        : 'Explicit consent will be requested before uploading any AES-encrypted file.'}
                    </span>
                    {privacy.mediaServerConsentGranted && (
                      <button
                        type="button"
                        onClick={() => onUpdatePrivacy({ mediaServerConsentGranted: false })}
                        className="text-amber-500 font-semibold shrink-0"
                      >
                        {language === 'ar' ? 'إلغاء الموافقة' : 'Revoke'}
                      </button>
                    )}
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-slate-50 dark:bg-[#05070D] space-y-2">
                  <label className="flex items-center justify-between text-sm font-medium">
                    <span>{language === 'ar' ? 'الرد التلقائي (Auto-Reply)' : 'Auto-Reply'}</span>
                    <input
                      type="checkbox"
                      checked={privacy.autoReplyEnabled}
                      onChange={(e) => onUpdatePrivacy({ autoReplyEnabled: e.target.checked })}
                    />
                  </label>
                  <input
                    type="text"
                    value={privacy.autoReplyText}
                    onChange={(e) => onUpdatePrivacy({ autoReplyText: e.target.value })}
                    className="w-full min-h-[38px] px-3 rounded-lg bg-white dark:bg-[#0C1222] text-xs"
                  />
                </div>

                <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/25 text-xs text-slate-600 dark:text-[#9AA8C7]">
                  {t.relayPrivacyNotice}
                </div>
              </div>
            )}

            {tab === 'account' && (
              <div className="space-y-6">
                <form onSubmit={handleSaveProfile} className="space-y-4">
                  {/* Profile Photo + Unique User ID */}
                  <div className="flex flex-wrap items-center gap-4 p-4 rounded-2xl bg-slate-50 dark:bg-[#05070D]">
                    <div className="relative">
                      <UserAvatar
                        avatarColor={currentUser.avatarColor}
                        avatarEmoji={currentUser.avatarEmoji}
                        avatarDataUrl={avatarDataUrl}
                        alt={displayName}
                        sizeClass="w-16 h-16"
                        textClass="text-2xl"
                      />
                      {avatarDataUrl && (
                        <button
                          type="button"
                          onClick={() => setAvatarDataUrl(undefined)}
                          aria-label={t.removePhotoBtn}
                          className="w-6 h-6 rounded-full bg-red-500 text-white flex items-center justify-center absolute -top-1.5 -end-1.5"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                    <div className="flex-1 min-w-0 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <label className="min-h-[34px] px-3 rounded-lg border border-slate-200 dark:border-white/15 bg-white dark:bg-[#0C1222] text-xs font-semibold flex items-center gap-1.5 cursor-pointer">
                          <Camera className="w-3.5 h-3.5 text-cyan-500" />
                          <span>{t.uploadPhotoBtn}</span>
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={async (ev) => {
                              const file = ev.target.files?.[0];
                              ev.target.value = '';
                              if (!file) return;
                              try {
                                const url = await resizeGalleryImageToDataUrl(file, 320);
                                setAvatarDataUrl(url);
                              } catch {
                                setErrorMsg(language === 'ar' ? 'تعذر معالجة الصورة' : 'Could not process photo');
                              }
                            }}
                          />
                        </label>
                      </div>
                      <div className="flex items-center justify-between gap-2 text-[11px] bg-white dark:bg-[#0C1222] px-3 py-1.5 rounded-lg border border-slate-200 dark:border-white/10">
                        <span className="font-mono-tabular truncate" dir="ltr">
                          npub: {currentUser.npub || currentUser.userId}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleCopyText(currentUser.npub || currentUser.userId, 'npub')}
                          className="text-cyan-500 font-semibold flex items-center gap-1 shrink-0"
                        >
                          <Copy className="w-3 h-3" />
                          <span>{copiedKey === 'npub' ? (language === 'ar' ? 'نُسخ' : 'Copied') : (language === 'ar' ? 'نسخ' : 'Copy')}</span>
                        </button>
                      </div>
                      <div className="flex items-center justify-between gap-2 text-[11px] bg-white dark:bg-[#0C1222] px-3 py-1.5 rounded-lg border border-slate-200 dark:border-white/10">
                        <span className="font-mono-tabular truncate" dir="ltr">
                          hex: {currentUser.nostrPubkeyHex || currentUser.userId}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleCopyText(currentUser.nostrPubkeyHex || currentUser.userId, 'hex')}
                          className="text-cyan-500 font-semibold flex items-center gap-1 shrink-0"
                        >
                          <Copy className="w-3 h-3" />
                          <span>{copiedKey === 'hex' ? (language === 'ar' ? 'نُسخ' : 'Copied') : (language === 'ar' ? 'نسخ' : 'Copy')}</span>
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-slate-500 mb-1">{t.displayNameOptionalLabel}</label>
                      <input
                        type="text"
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                        className="w-full min-h-[40px] px-3 rounded-xl bg-slate-100 dark:bg-[#05070D] text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-500 mb-1">{t.usernameLabel}</label>
                      <input
                        type="text"
                        value={username}
                        onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                        className="w-full min-h-[40px] px-3 rounded-xl bg-slate-100 dark:bg-[#05070D] text-sm font-mono-tabular"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">{t.bioLabel}</label>
                    <input
                      type="text"
                      value={bio}
                      onChange={(e) => setBio(e.target.value)}
                      className="w-full min-h-[40px] px-3 rounded-xl bg-slate-100 dark:bg-[#05070D] text-sm"
                    />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="submit"
                      className="min-h-[40px] px-5 rounded-xl bg-cyan-600 text-white text-xs font-semibold"
                    >
                      {t.save}
                    </button>
                    <button
                      type="button"
                      disabled={publishingProfile}
                      onClick={async () => {
                        setErrorMsg(null);
                        setStatusMsg(null);
                        setPublishingProfile(true);
                        try {
                          const res = await onPublishProfileAndRelays();
                          if (res.publishedRelays.length > 0) {
                            setStatusMsg(
                              language === 'ar'
                                ? `تم نشر الهوية (kind:0 + kind:10002) على ${res.publishedRelays.length} Relays`
                                : `Published kind:0 & kind:10002 to ${res.publishedRelays.length} Relay(s)`,
                            );
                          } else {
                            setErrorMsg(
                              language === 'ar'
                                ? 'لا يوجد Relay متصل للكتابة حالياً — افتح إدارة الـ Relays.'
                                : 'No write Relay connected right now — open Relays Manager.',
                            );
                          }
                        } finally {
                          setPublishingProfile(false);
                        }
                      }}
                      className="min-h-[40px] px-4 rounded-xl border border-cyan-500/40 bg-cyan-500/10 text-cyan-600 dark:text-[#00E5FF] text-xs font-semibold flex items-center gap-1.5"
                    >
                      <Radio className="w-3.5 h-3.5" />
                      <span>{t.syncProfileRelaysBtn}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        onOpenRelaysModal();
                      }}
                      className="min-h-[40px] px-4 rounded-xl border border-slate-200 dark:border-white/15 text-xs font-semibold flex items-center gap-1.5"
                    >
                      <Server className="w-3.5 h-3.5 text-cyan-500" />
                      <span>{t.navRelays} ({connectedRelayCount}/{totalRelayCount})</span>
                    </button>
                  </div>
                </form>

                {/* Nostr NIP-49 Encrypted Backup & Key Custody */}
                <div className="pt-4 border-t border-slate-200 dark:border-white/10 space-y-3">
                  <h4 className="text-xs font-semibold flex items-center gap-2 text-violet-500">
                    <Shield className="w-4 h-4" />
                    <span>{t.nostrBackupTitle}</span>
                  </h4>
                  <p className="text-[11px] text-slate-500 dark:text-[#9AA8C7]">
                    {language === 'ar'
                      ? 'المفتاح الخاص nsec لا يُرسل أبداً إلى أي Relay. احفظ نسخة مشفرة بـ NIP-49 (ncryptsec1) لاستعادة حسابك على أي جهاز.'
                      : 'Your private nsec key is never transmitted to any Relay. Export a password-protected NIP-49 (ncryptsec1) backup to restore on another device.'}
                  </p>
                  <form onSubmit={handleGenerateNip49Backup} className="flex flex-col sm:flex-row gap-2">
                    <input
                      type="password"
                      required
                      minLength={4}
                      value={backupPwd}
                      onChange={(e) => setBackupPwd(e.target.value)}
                      placeholder={language === 'ar' ? 'كلمة مرور تشفير النسخة الاحتياطية...' : 'Backup encryption passphrase (min 4 chars)...'}
                      className="flex-1 min-h-[40px] px-3 rounded-xl bg-slate-100 dark:bg-[#05070D] text-xs"
                    />
                    <button
                      type="submit"
                      className="min-h-[40px] px-4 rounded-xl bg-violet-600 text-white text-xs font-semibold shrink-0"
                    >
                      {t.exportNip49Btn}
                    </button>
                  </form>
                  {ncryptsecOut && (
                    <div className="p-3 rounded-xl bg-slate-100 dark:bg-[#05070D] border border-violet-500/30 space-y-2">
                      <div className="text-[11px] font-mono-tabular break-all select-all" dir="ltr">
                        {ncryptsecOut}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => handleCopyText(ncryptsecOut, 'ncryptsec')}
                          className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-white/15 text-[11px] font-semibold flex items-center gap-1"
                        >
                          <Copy className="w-3 h-3" />
                          <span>{copiedKey === 'ncryptsec' ? (language === 'ar' ? 'نُسخ!' : 'Copied!') : 'Copy ncryptsec1'}</span>
                        </button>
                        <button
                          type="button"
                          onClick={handleDownloadNostrBackupJson}
                          className="px-3 py-1.5 rounded-lg bg-cyan-600 text-white text-[11px] font-semibold flex items-center gap-1"
                        >
                          <Download className="w-3 h-3" />
                          <span>{language === 'ar' ? 'تحميل ملف .json' : 'Download .json Backup'}</span>
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Password-gated raw nsec reveal */}
                  {nsec && (
                    <div className="p-3 rounded-xl bg-slate-50 dark:bg-[#05070D] border border-slate-200 dark:border-white/10 space-y-2">
                      {!nsecRevealed ? (
                        <form onSubmit={handleRevealNsec} className="flex flex-col sm:flex-row gap-2">
                          <input
                            type="password"
                            required
                            value={revealPwd}
                            onChange={(e) => setRevealPwd(e.target.value)}
                            placeholder={language === 'ar' ? 'أدخل كلمة مرور حسابك لكشف nsec1...' : 'Enter account password to reveal raw nsec1...'}
                            className="flex-1 min-h-[38px] px-3 rounded-lg bg-white dark:bg-[#0C1222] text-xs"
                          />
                          <button
                            type="submit"
                            className="min-h-[38px] px-3.5 rounded-lg border border-amber-500/40 text-amber-500 text-xs font-semibold flex items-center justify-center gap-1.5"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            <span>{language === 'ar' ? 'كشف nsec1' : 'Reveal nsec1'}</span>
                          </button>
                        </form>
                      ) : (
                        <div className="space-y-2">
                          <div className="flex items-center justify-between text-[11px] text-amber-500 font-semibold">
                            <span>{language === 'ar' ? 'تحذير: لا تشارك مفتاح nsec مع أي شخص!' : 'WARNING: Never share your nsec1 private key!'}</span>
                            <button
                              type="button"
                              onClick={() => setNsecRevealed(false)}
                              className="flex items-center gap-1 underline"
                            >
                              <EyeOff className="w-3 h-3" />
                              <span>{language === 'ar' ? 'إخفاء' : 'Hide'}</span>
                            </button>
                          </div>
                          <div className="text-[11px] font-mono-tabular break-all bg-white dark:bg-[#0C1222] p-2 rounded-lg" dir="ltr">
                            {nsec}
                          </div>
                          <button
                            type="button"
                            onClick={() => handleCopyText(nsec, 'raw_nsec')}
                            className="px-3 py-1 rounded-lg border border-slate-200 dark:border-white/15 text-[11px] font-semibold"
                          >
                            {copiedKey === 'raw_nsec' ? (language === 'ar' ? 'نُسخ' : 'Copied') : 'Copy nsec1'}
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Change Password */}
                <form onSubmit={handleChangePasswordSubmit} className="pt-4 border-t border-slate-200 dark:border-white/10 space-y-3">
                  <h4 className="text-xs font-semibold flex items-center gap-2 text-cyan-600 dark:text-[#00E5FF]">
                    <KeyRound className="w-4 h-4" />
                    <span>{t.changePasswordTitle}</span>
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <input
                      type="password"
                      required
                      value={currentPwd}
                      onChange={(e) => setCurrentPwd(e.target.value)}
                      placeholder={t.currentPasswordLabel}
                      className="min-h-[40px] px-3 rounded-xl bg-slate-100 dark:bg-[#05070D] text-xs"
                    />
                    <input
                      type="password"
                      required
                      minLength={6}
                      value={newPwd}
                      onChange={(e) => setNewPwd(e.target.value)}
                      placeholder={t.newPasswordLabel}
                      className="min-h-[40px] px-3 rounded-xl bg-slate-100 dark:bg-[#05070D] text-xs"
                    />
                    <input
                      type="password"
                      required
                      minLength={6}
                      value={confirmNewPwd}
                      onChange={(e) => setConfirmNewPwd(e.target.value)}
                      placeholder={t.confirmNewPasswordLabel}
                      className="min-h-[40px] px-3 rounded-xl bg-slate-100 dark:bg-[#05070D] text-xs"
                    />
                  </div>
                  <button
                    type="submit"
                    className="min-h-[40px] px-4 rounded-xl border border-cyan-500/40 bg-cyan-500/10 text-cyan-700 dark:text-[#00E5FF] text-xs font-semibold"
                  >
                    {t.changePasswordBtn}
                  </button>
                </form>

                {blockedUserIds.length > 0 && (
                  <div className="pt-4 border-t border-slate-200 dark:border-white/10 space-y-2">
                    <h4 className="text-xs font-semibold text-slate-500">Blocked Users ({blockedUserIds.length})</h4>
                    {blockedUserIds.map((uid) => (
                      <div key={uid} className="flex items-center justify-between text-xs p-2 rounded-lg bg-slate-100 dark:bg-[#05070D]">
                        <span className="font-mono-tabular">{uid}</span>
                        <button type="button" onClick={() => onUnblockUser(uid)} className="text-cyan-500 underline">
                          {language === 'ar' ? 'إلغاء الحظر' : 'Unblock'}
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <div className="pt-4 border-t border-slate-200 dark:border-white/10 space-y-3">
                  <div className="flex flex-wrap gap-3">
                    <button
                      type="button"
                      onClick={onSignOut}
                      className="min-h-[42px] px-4 rounded-xl border border-slate-200 dark:border-white/15 text-xs font-semibold"
                    >
                      {t.signOutBtn}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteStep('account')}
                      className="min-h-[42px] px-4 rounded-xl bg-red-600/15 text-red-500 border border-red-500/30 text-xs font-semibold flex items-center gap-1.5"
                    >
                      <Trash2 className="w-4 h-4" />
                      <span>{t.deleteAccountBtn}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteStep('wipe')}
                      className="min-h-[42px] px-4 rounded-xl bg-red-600/10 text-red-400 border border-red-500/20 text-xs font-semibold"
                    >
                      {t.wipeAllDeviceBtn}
                    </button>
                  </div>

                  {confirmDeleteStep !== 'none' && (
                    <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/30 space-y-3">
                      <p className="text-xs text-red-400">
                        {confirmDeleteStep === 'wipe'
                          ? (language === 'ar'
                              ? 'تحذير: سيتم مسح جميع الحسابات والرسائل والملفات المشفرة على هذا الجهاز نهائياً!'
                              : 'Warning: This will permanently erase ALL local accounts, messages, and vault files on this device!')
                          : (language === 'ar'
                              ? 'تحذير: سيتم حذف هذا الحساب وجميع محادثاته وملفاته المشفرة نهائياً!'
                              : 'Warning: This will permanently delete this local account and all its encrypted chats and vault items!')}
                      </p>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={async () => {
                            if (confirmDeleteStep === 'wipe') await onWipeAllDeviceData();
                            else await onDeleteAccount();
                            setConfirmDeleteStep('none');
                          }}
                          className="px-4 py-2 rounded-lg bg-red-600 text-white text-xs font-semibold"
                        >
                          {t.confirm}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteStep('none')}
                          className="px-4 py-2 rounded-lg border border-white/15 text-xs"
                        >
                          {t.cancel}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
            {tab === 'diagnostics' && (
              <div className="space-y-5">
                <div
                  className="p-4 rounded-2xl border border-cyan-500/30 bg-cyan-500/10 flex flex-wrap items-center justify-between gap-3"
                  style={settingsCardStyle}
                >
                  <div className="space-y-1">
                    <h3 className="text-sm font-bold flex items-center gap-2">
                      <Activity className="w-4 h-4 text-cyan-500" />
                      <span>
                        {language === 'ar'
                          ? 'أداة فحص زمن الاستجابة (Ping) للـ Relays'
                          : 'Decentralized Relay Ping & Latency Diagnostics'}
                      </span>
                    </h3>
                    <p className="text-xs text-slate-600 dark:text-[#9AA8C7]">
                      {language === 'ar'
                        ? `العُقد المتصلة حالياً: ${connectedRelayCount} / ${totalRelayCount} · يتم قياس زمن الاستجابة الفعلي بالمللي ثانية (ms) عبر WebSocket وEOSE.`
                        : `Connected nodes: ${connectedRelayCount} / ${totalRelayCount} · Measures real WebSocket + Nostr EOSE round-trip latency in milliseconds (ms).`}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={pingingAll || relays.length === 0}
                      onClick={handlePingAllRelays}
                      className="min-h-[38px] px-4 rounded-xl text-xs font-semibold text-[#041018] flex items-center gap-1.5 disabled:opacity-50"
                      style={{ backgroundColor: customization.primaryAccent }}
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${pingingAll ? 'animate-spin' : ''}`} />
                      <span>
                        {pingingAll
                          ? language === 'ar' ? 'جارٍ الفحص...' : 'Pinging All...'
                          : language === 'ar' ? 'فحص جميع الـ Relays' : 'Ping All Relays'}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        onOpenRelaysModal();
                      }}
                      className="min-h-[38px] px-3.5 rounded-xl border border-slate-200 dark:border-white/15 bg-white dark:bg-[#0C1222] text-xs font-semibold flex items-center gap-1.5"
                    >
                      <Server className="w-3.5 h-3.5 text-cyan-500" />
                      <span>{t.navRelays}</span>
                    </button>
                  </div>
                </div>

                {/* Individual Relay Diagnostic Rows */}
                <div className="space-y-2.5">
                  {relays.length === 0 ? (
                    <div className="p-6 rounded-2xl bg-slate-50 dark:bg-[#05070D] text-center text-xs text-slate-500">
                      {language === 'ar'
                        ? 'لا توجد Relays مضافة حالياً. افتح إدارة الـ Relays لإضافة عقدة.'
                        : 'No relays configured. Open the Relays Manager to add a node.'}
                    </div>
                  ) : (
                    relays.map((relay) => {
                      const isPinging = Boolean(pingingUrls[relay.url]);
                      const ping = pingResults[relay.url];
                      const effectiveLatency = ping ? ping.latencyMs : relay.latencyMs ?? null;
                      const hasMeasured = Boolean(ping) || typeof relay.latencyMs === 'number';
                      const quality = ping
                        ? renderLatencyQuality(ping.latencyMs, ping.ok)
                        : typeof relay.latencyMs === 'number'
                        ? renderLatencyQuality(relay.latencyMs, true)
                        : null;

                      return (
                        <div
                          key={relay.url}
                          className="p-3.5 rounded-2xl bg-slate-50 dark:bg-[#05070D] border border-slate-200 dark:border-white/10 flex flex-wrap items-center justify-between gap-3"
                        >
                          <div className="min-w-0 flex-1 space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span
                                className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                                  relay.status === 'connected'
                                    ? 'bg-emerald-500'
                                    : relay.status === 'connecting'
                                    ? 'bg-amber-400 animate-pulse'
                                    : 'bg-rose-500'
                                }`}
                              />
                              <span className="text-xs font-bold truncate">
                                {relay.name || relay.url}
                              </span>
                              {relay.read && (
                                <span className="px-1.5 py-0.5 rounded bg-slate-200 dark:bg-white/10 text-[10px] font-mono-tabular">
                                  R
                                </span>
                              )}
                              {relay.write && (
                                <span className="px-1.5 py-0.5 rounded bg-slate-200 dark:bg-white/10 text-[10px] font-mono-tabular">
                                  W
                                </span>
                              )}
                              {(relay.isSearch || relay.supportedNips?.includes(50)) && (
                                <span className="px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-600 dark:text-[#00E5FF] text-[10px] font-mono-tabular">
                                  NIP-50
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] font-mono-tabular text-slate-500 dark:text-[#9AA8C7] truncate" dir="ltr">
                              {relay.url}
                            </div>
                            {ping && !ping.ok && ping.error && (
                              <div className="text-[11px] text-rose-500">{ping.error}</div>
                            )}
                          </div>

                          <div className="flex items-center gap-2.5 shrink-0">
                            {hasMeasured && quality ? (
                              <div className="text-end space-y-0.5">
                                <div
                                  className={`px-2.5 py-1 rounded-lg border text-xs font-mono-tabular font-bold ${quality.badgeClass}`}
                                  dir="ltr"
                                >
                                  {effectiveLatency !== null ? `${effectiveLatency} ms` : 'ERR'}
                                  <span className="ms-1.5 font-sans font-semibold text-[10px]">
                                    · {quality.label}
                                  </span>
                                </div>
                                {ping && (
                                  <div className="text-[10px] text-slate-400 font-mono-tabular">
                                    {ping.mode === 'eose-rtt'
                                      ? 'EOSE RTT'
                                      : ping.mode === 'ws-open'
                                      ? 'WS Handshake'
                                      : 'Failed'}
                                  </div>
                                )}
                              </div>
                            ) : (
                              <span className="text-[11px] text-slate-400">
                                {language === 'ar' ? 'لم يُفحص بعد' : 'Not tested'}
                              </span>
                            )}

                            <button
                              type="button"
                              disabled={isPinging}
                              onClick={() => handlePingSingleRelay(relay.url)}
                              className="min-h-[36px] px-3.5 rounded-xl border border-cyan-500/35 bg-cyan-500/10 text-cyan-700 dark:text-[#00E5FF] text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50"
                            >
                              <Activity className={`w-3.5 h-3.5 ${isPinging ? 'animate-pulse' : ''}`} />
                              <span>
                                {isPinging
                                  ? language === 'ar' ? 'جاري...' : 'Pinging...'
                                  : 'Ping'}
                              </span>
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

                {/* Custom wss:// Relay Probe */}
                <div className="p-4 rounded-2xl bg-slate-50 dark:bg-[#05070D] border border-slate-200 dark:border-white/10 space-y-3">
                  <div className="text-xs font-bold">
                    {language === 'ar'
                      ? 'اختبار عقدة Relay مخصصة (قبل إضافتها)'
                      : 'Probe a Custom Relay URL (Before Adding)'}
                  </div>
                  <form onSubmit={handlePingCustomUrl} className="flex flex-col sm:flex-row gap-2">
                    <input
                      type="text"
                      dir="ltr"
                      value={customProbeUrl}
                      onChange={(e) => setCustomProbeUrl(e.target.value)}
                      placeholder="wss://relay.snort.social"
                      className="flex-1 min-h-[40px] px-3 rounded-xl bg-white dark:bg-[#0C1222] border border-slate-200 dark:border-white/10 font-mono-tabular text-xs"
                    />
                    <button
                      type="submit"
                      disabled={pingingCustom || !customProbeUrl.trim()}
                      className="min-h-[40px] px-4 rounded-xl bg-cyan-600 text-white text-xs font-semibold flex items-center justify-center gap-1.5 disabled:opacity-50 shrink-0"
                    >
                      <Activity className={`w-3.5 h-3.5 ${pingingCustom ? 'animate-pulse' : ''}`} />
                      <span>{pingingCustom ? (language === 'ar' ? 'جارٍ القياس...' : 'Pinging...') : 'Ping URL'}</span>
                    </button>
                  </form>
                  {customProbeResult && (
                    <div className="p-3 rounded-xl bg-white dark:bg-[#0C1222] border border-slate-200 dark:border-white/10 flex flex-wrap items-center justify-between gap-2 text-xs">
                      <span className="font-mono-tabular truncate" dir="ltr">
                        {customProbeResult.url}
                      </span>
                      {customProbeResult.ok && customProbeResult.latencyMs !== null ? (
                        <span
                          className={`px-2.5 py-1 rounded-lg border font-mono-tabular font-bold ${
                            renderLatencyQuality(customProbeResult.latencyMs, true).badgeClass
                          }`}
                          dir="ltr"
                        >
                          {customProbeResult.latencyMs} ms ({customProbeResult.mode})
                        </span>
                      ) : (
                        <span className="text-rose-500 font-semibold">
                          {customProbeResult.error || (language === 'ar' ? 'تعذر الوصول للعقدة' : 'Unreachable')}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
