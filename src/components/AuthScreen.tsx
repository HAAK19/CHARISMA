import React, { useEffect, useState } from 'react';
import {
  Camera,
  Eye,
  EyeOff,
  Globe,
  KeyRound,
  Lock,
  Moon,
  ShieldCheck,
  Sun,
  UserCheck,
  UserPlus,
  WifiOff,
  X,
} from 'lucide-react';
import {
  AppLanguage,
  DecryptedAccountSecrets,
  LocalAccountRecord,
  PublicUser,
  ThemeMode,
} from '../types/charisma';
import { TRANSLATIONS } from '../i18n/translations';
import { localDb } from '../storage/localDb';
import { resizeGalleryImageToDataUrl } from '../utils/themeEngine';
import { PWAInstallButton } from './PWAInstallButton';
import { UserAvatar } from './UserAvatar';

const AVATAR_COLORS = ['#00E5FF', '#9D4EDD', '#10B981', '#F59E0B', '#EC4899', '#3B82F6'];
const AVATAR_EMOJIS = ['◈', '✦', '⬡', '✧', '◉', '⌘'];

interface AuthScreenProps {
  language: AppLanguage;
  themeMode: ThemeMode;
  onToggleLanguage: () => void;
  onToggleTheme: () => void;
  onAuthenticated: (payload: {
    user: PublicUser;
    secrets: DecryptedAccountSecrets;
  }) => void;
}

export const AuthScreen: React.FC<AuthScreenProps> = ({
  language,
  themeMode,
  onToggleLanguage,
  onToggleTheme,
  onAuthenticated,
}) => {
  const t = TRANSLATIONS[language];
  const [savedAccounts, setSavedAccounts] = useState<LocalAccountRecord[]>([]);
  const [mode, setMode] = useState<'signup' | 'signin'>('signup');

  // Shared credentials
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Signup profile fields
  const [usernameStatus, setUsernameStatus] = useState<{
    checking: boolean;
    available: boolean | null;
    reason: string | null;
  }>({ checking: false, available: null, reason: null });
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [avatarColor, setAvatarColor] = useState(AVATAR_COLORS[0]);
  const [avatarEmoji, setAvatarEmoji] = useState(AVATAR_EMOJIS[0]);
  const [avatarDataUrl, setAvatarDataUrl] = useState<string | undefined>(undefined);
  const [restoreNostrMode, setRestoreNostrMode] = useState(false);
  const [importedNostrSecret, setImportedNostrSecret] = useState('');
  const [importedBackupPassword, setImportedBackupPassword] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    localDb
      .listLocalAccounts()
      .then((accounts) => {
        setSavedAccounts(accounts);
        if (accounts.length > 0) {
          setMode('signin');
          setUsername(accounts[0].username);
        }
      })
      .catch(() => {
        // Ignore storage read error so signup form stays accessible
      });
  }, []);

  useEffect(() => {
    if (mode !== 'signup') return;
    const cleaned = username.trim().toLowerCase().replace(/^@/, '');
    if (!cleaned) {
      setUsernameStatus({ checking: false, available: null, reason: null });
      return;
    }
    const timer = setTimeout(async () => {
      setUsernameStatus({ checking: true, available: null, reason: null });
      const res = await localDb.isUsernameAvailable(cleaned);
      setUsernameStatus({ checking: false, available: res.available, reason: res.reason });
    }, 150);
    return () => clearTimeout(timer);
  }, [username, mode]);

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < 6) {
      setError(
        language === 'ar'
          ? 'يجب أن تتكون كلمة المرور من 6 أحرف على الأقل'
          : 'Password must be at least 6 characters',
      );
      return;
    }
    if (password !== confirmPassword) {
      setError(
        language === 'ar'
          ? 'كلمة المرور وتأكيدها غير متطابقتين'
          : 'Passwords do not match',
      );
      return;
    }

    setLoading(true);
    try {
      const { user, secrets } = await localDb.registerLocalAccount({
        username,
        password,
        displayName: displayName.trim() || undefined,
        bio: bio.trim(),
        avatarColor,
        avatarEmoji,
        avatarDataUrl,
        allowSearchByDisplayName: true,
        importedNostrSecret: restoreNostrMode ? importedNostrSecret.trim() : undefined,
        importedBackupPassword: restoreNostrMode ? importedBackupPassword : undefined,
      });
      onAuthenticated({ user, secrets });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create local account');
    } finally {
      setLoading(false);
    }
  }

  async function handleSignin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { user, secrets } = await localDb.signInLocalAccount(username, password);
      onAuthenticated({ user, secrets });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid username or password');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#F4F7FC] dark:bg-[#05070D] text-slate-900 dark:text-[#F2F6FF] flex flex-col">
      {/* Clean top bar */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-white/10">
        <div className="flex items-center gap-3">
          <img
            src="/src/assets/images/charisma_app_icon_1795329659625.jpg"
            alt="CHARISMA emblem"
            className="w-9 h-9 rounded-xl object-cover border border-slate-300 dark:border-cyan-400/30"
          />
          <span className="font-display text-lg font-bold tracking-wide text-slate-900 dark:text-[#00E5FF] whitespace-nowrap">
            {t.appName}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <PWAInstallButton language={language} compact />
          <button
            type="button"
            onClick={onToggleLanguage}
            className="min-h-[40px] px-3 py-1.5 rounded-lg border border-slate-200 dark:border-white/15 bg-white dark:bg-[#0C1222] text-xs font-medium flex items-center gap-2 hover:border-cyan-500 transition-colors"
          >
            <Globe className="w-4 h-4 text-cyan-600 dark:text-[#00E5FF]" />
            <span>{language === 'en' ? 'العربية' : 'English'}</span>
          </button>
          <button
            type="button"
            onClick={onToggleTheme}
            aria-label="Toggle theme"
            className="min-h-[40px] min-w-[40px] rounded-lg border border-slate-200 dark:border-white/15 bg-white dark:bg-[#0C1222] flex items-center justify-center hover:border-cyan-500 transition-colors"
          >
            {themeMode === 'dark' ? (
              <Sun className="w-4 h-4 text-amber-400" />
            ) : (
              <Moon className="w-4 h-4 text-slate-700" />
            )}
          </button>
        </div>
      </header>

      {/* Main 2-column architectural split */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-6 py-10 grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
        {/* Brand Identity & Local Security Summary */}
        <section className="lg:col-span-6 space-y-6">
          <p className="text-xs font-semibold tracking-[0.2em] text-cyan-700 dark:text-[#00E5FF]">
            {t.tagline}
          </p>
          <h1 className="font-display text-4xl sm:text-5xl font-bold tracking-tight leading-tight text-balance">
            {t.authTitle}
          </h1>
          <p className="text-base text-slate-600 dark:text-[#9AA8C7] leading-relaxed max-w-xl">
            {t.authSubtitle}
          </p>

          <div className="pt-4 border-t border-slate-200 dark:border-white/10 space-y-3 text-sm text-slate-600 dark:text-[#9AA8C7]">
            <div className="flex items-start gap-3">
              <ShieldCheck className="w-5 h-5 text-cyan-600 dark:text-[#00E5FF] shrink-0 mt-0.5" />
              <span>
                {language === 'ar'
                  ? 'هوية Nostr (secp256k1) ومفاتيحك الخاصة تبقى مشفرة على جهازك بـ PBKDF2-SHA256 وAES-256-GCM ولا تُرسل أبداً إلى أي Relay'
                  : 'Your Nostr secp256k1 private key stays encrypted on-device with PBKDF2-SHA256 & AES-256-GCM — never sent to any Relay'}
              </span>
            </div>
            <div className="flex items-start gap-3">
              <Lock className="w-5 h-5 text-violet-600 dark:text-[#9D4EDD] shrink-0 mt-0.5" />
              <span>
                {language === 'ar'
                  ? 'مراسلة NIP-17 + NIP-44 + NIP-59 Gift Wrap عالمية دون رقم هاتف أو بريد إلكتروني أو خادم مركزي'
                  : 'Decentralized NIP-17 / NIP-44 / NIP-59 Gift-Wrapped messaging with zero phone numbers, email, or central backend'}
              </span>
            </div>
            <div className="flex items-start gap-3">
              <WifiOff className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
              <span>
                {language === 'ar'
                  ? 'دعم كامل للعمل دون اتصال بالإنترنت (طابور رسائل محلي ومزامنة تلقائية عند عودة الـ Relays)'
                  : 'Offline-capable local vault & signed NIP-17 outbox queue that syncs automatically when Relays reconnect'}
              </span>
            </div>
          </div>
        </section>

        {/* Local Account Form */}
        <section className="lg:col-span-6 bg-white dark:bg-[#0C1222]/90 border border-slate-200 dark:border-white/10 rounded-2xl p-6 sm:p-8 shadow-sm space-y-5">
          {/* Mode Switcher */}
          <div className="grid grid-cols-2 gap-2 p-1 rounded-xl bg-slate-100 dark:bg-[#05070D]">
            <button
              type="button"
              onClick={() => {
                setMode('signin');
                setError(null);
              }}
              className={`min-h-[40px] rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors ${
                mode === 'signin'
                  ? 'bg-white dark:bg-[#141E36] text-cyan-700 dark:text-[#00E5FF] shadow-xs'
                  : 'text-slate-500 dark:text-[#9AA8C7]'
              }`}
            >
              <UserCheck className="w-4 h-4" />
              <span>{t.modeSignIn}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('signup');
                setError(null);
                if (savedAccounts.length > 0 && savedAccounts.some((a) => a.username === username)) {
                  setUsername('');
                }
              }}
              className={`min-h-[40px] rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors ${
                mode === 'signup'
                  ? 'bg-white dark:bg-[#141E36] text-cyan-700 dark:text-[#00E5FF] shadow-xs'
                  : 'text-slate-500 dark:text-[#9AA8C7]'
              }`}
            >
              <UserPlus className="w-4 h-4" />
              <span>{t.modeCreateAccount}</span>
            </button>
          </div>

          {error && (
            <div className="p-3.5 rounded-xl bg-red-500/10 border border-red-500/30 text-sm text-red-600 dark:text-red-300">
              {error}
            </div>
          )}

          {mode === 'signin' ? (
            <form onSubmit={handleSignin} className="space-y-4">
              {savedAccounts.length > 0 && (
                <div className="space-y-2">
                  <div className="text-xs font-medium text-slate-500 dark:text-[#9AA8C7]">
                    {t.savedAccountsTitle}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {savedAccounts.map((acc) => {
                      const selected = acc.username === username.toLowerCase();
                      return (
                        <button
                          key={acc.userId}
                          type="button"
                          onClick={() => {
                            setUsername(acc.username);
                            setError(null);
                          }}
                          className={`p-2.5 rounded-xl border text-start flex items-center gap-2.5 transition-colors ${
                            selected
                              ? 'border-cyan-500 bg-cyan-500/10'
                              : 'border-slate-200 dark:border-white/10 hover:border-cyan-500/50'
                          }`}
                        >
                          <UserAvatar
                            avatarColor={acc.avatarColor}
                            avatarEmoji={acc.avatarEmoji}
                            avatarDataUrl={acc.avatarDataUrl}
                            alt={acc.displayName}
                            sizeClass="w-9 h-9"
                            textClass="text-sm"
                            roundedClass="rounded-lg"
                          />
                          <div className="min-w-0">
                            <div className="text-xs font-semibold truncate">{acc.displayName}</div>
                            <div className="text-[11px] font-mono-tabular text-slate-500 truncate">
                              @{acc.username}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-[#9AA8C7] mb-1">
                  {t.usernameLabel}
                </label>
                <div className="relative" dir="ltr">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-sm">@</span>
                  <input
                    type="text"
                    required
                    value={username}
                    onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                    placeholder="layla_sec"
                    className="w-full min-h-[44px] pl-8 pr-4 rounded-xl bg-slate-50 dark:bg-[#05070D] border border-slate-200 dark:border-white/15 text-sm font-mono-tabular focus:outline-none focus:border-cyan-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-[#9AA8C7] mb-1">
                  {t.passwordLabel}
                </label>
                <div className="relative" dir="ltr">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full min-h-[44px] pl-3.5 pr-11 rounded-xl bg-slate-50 dark:bg-[#05070D] border border-slate-200 dark:border-white/15 text-sm focus:outline-none focus:border-cyan-500"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((s) => !s)}
                    aria-label="Toggle password visibility"
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-cyan-500"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading || !username.trim() || !password}
                className="w-full min-h-[46px] px-5 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 dark:bg-[#00E5FF] dark:hover:bg-[#33ECFF] text-white dark:text-[#041018] font-semibold text-sm flex items-center justify-center gap-2 disabled:opacity-50 transition-colors"
              >
                <Lock className="w-4 h-4" />
                <span>{t.signInBtn}</span>
              </button>
            </form>
          ) : (
            <form onSubmit={handleSignup} className="space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                <div className="relative">
                  <UserAvatar
                    avatarColor={avatarColor}
                    avatarEmoji={avatarEmoji}
                    avatarDataUrl={avatarDataUrl}
                    alt="Profile preview"
                    sizeClass="w-16 h-16"
                    textClass="text-2xl"
                    roundedClass="rounded-2xl"
                  />
                  {avatarDataUrl && (
                    <button
                      type="button"
                      onClick={() => setAvatarDataUrl(undefined)}
                      aria-label={t.removePhotoBtn}
                      className="w-6 h-6 rounded-full bg-red-500 text-white flex items-center justify-center absolute -top-1.5 -end-1.5 shadow-sm"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
                <div className="space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <label className="min-h-[34px] px-3 rounded-lg border border-slate-200 dark:border-white/15 bg-slate-50 dark:bg-[#05070D] text-xs font-medium flex items-center gap-1.5 cursor-pointer hover:border-cyan-500">
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
                            setError(language === 'ar' ? 'تعذر معالجة الصورة المختارة' : 'Could not process selected photo');
                          }
                        }}
                      />
                    </label>
                    <div className="flex items-center gap-1.5">
                      {AVATAR_COLORS.map((c) => (
                        <button
                          key={c}
                          type="button"
                          onClick={() => setAvatarColor(c)}
                          aria-label={`Select color ${c}`}
                          className={`w-5 h-5 rounded-full border-2 ${avatarColor === c ? 'border-white scale-110' : 'border-transparent'}`}
                          style={{ backgroundColor: c }}
                        />
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {AVATAR_EMOJIS.map((em) => (
                      <button
                        key={em}
                        type="button"
                        onClick={() => setAvatarEmoji(em)}
                        className={`w-7 h-7 rounded-lg text-xs border ${
                          avatarEmoji === em
                            ? 'border-cyan-500 bg-cyan-500/10'
                            : 'border-slate-200 dark:border-white/10'
                        }`}
                      >
                        {em}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-medium text-slate-600 dark:text-[#9AA8C7]">
                    {t.usernameLabel}
                  </label>
                  {usernameStatus.available !== null && (
                    <span
                      className={`text-xs font-medium ${
                        usernameStatus.available ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500'
                      }`}
                    >
                      {usernameStatus.available ? t.usernameAvailable : usernameStatus.reason || t.usernameTaken}
                    </span>
                  )}
                </div>
                <div className="relative" dir="ltr">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-sm">@</span>
                  <input
                    type="text"
                    required
                    value={username}
                    onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                    placeholder="layla_sec"
                    className="w-full min-h-[44px] pl-8 pr-4 rounded-xl bg-slate-50 dark:bg-[#05070D] border border-slate-200 dark:border-white/15 text-sm font-mono-tabular focus:outline-none focus:border-cyan-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-[#9AA8C7] mb-1">
                    {t.displayNameOptionalLabel}
                  </label>
                  <input
                    type="text"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder={language === 'ar' ? 'ليلى حسن (اختياري)' : 'Layla Hassan (optional)'}
                    className="w-full min-h-[44px] px-3.5 rounded-xl bg-slate-50 dark:bg-[#05070D] border border-slate-200 dark:border-white/15 text-sm focus:outline-none focus:border-cyan-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-[#9AA8C7] mb-1">
                    {t.bioLabel}
                  </label>
                  <input
                    type="text"
                    value={bio}
                    onChange={(e) => setBio(e.target.value)}
                    placeholder={language === 'ar' ? 'حساب محلي آمن' : 'Offline encrypted identity'}
                    className="w-full min-h-[44px] px-3.5 rounded-xl bg-slate-50 dark:bg-[#05070D] border border-slate-200 dark:border-white/15 text-sm focus:outline-none focus:border-cyan-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-[#9AA8C7] mb-1">
                    {t.passwordLabel}
                  </label>
                  <div className="relative" dir="ltr">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      required
                      minLength={6}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••"
                      className="w-full min-h-[44px] pl-3.5 pr-10 rounded-xl bg-slate-50 dark:bg-[#05070D] border border-slate-200 dark:border-white/15 text-sm focus:outline-none focus:border-cyan-500"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((s) => !s)}
                      aria-label="Toggle password visibility"
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-cyan-500"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-[#9AA8C7] mb-1">
                    {t.confirmPasswordLabel}
                  </label>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    minLength={6}
                    dir="ltr"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="••••••"
                    className="w-full min-h-[44px] px-3.5 rounded-xl bg-slate-50 dark:bg-[#05070D] border border-slate-200 dark:border-white/15 text-sm focus:outline-none focus:border-cyan-500"
                  />
                </div>
              </div>

              {/* Optional Restore Existing Nostr Key (NIP-49 ncryptsec1 / nsec1 / hex) */}
              <div className="p-3 rounded-xl bg-slate-50 dark:bg-[#05070D] border border-slate-200 dark:border-white/10 space-y-2.5">
                <label className="flex items-center gap-2 text-xs font-medium cursor-pointer">
                  <input
                    type="checkbox"
                    checked={restoreNostrMode}
                    onChange={(e) => setRestoreNostrMode(e.target.checked)}
                  />
                  <span>{t.restoreKeyToggle}</span>
                </label>
                {restoreNostrMode && (
                  <div className="space-y-2 pt-1" dir="ltr">
                    <input
                      type="password"
                      required={restoreNostrMode}
                      value={importedNostrSecret}
                      onChange={(e) => setImportedNostrSecret(e.target.value)}
                      placeholder="ncryptsec1... or nsec1... or 64-hex key"
                      className="w-full min-h-[40px] px-3 rounded-lg bg-white dark:bg-[#0C1222] border border-slate-200 dark:border-white/15 text-xs font-mono-tabular focus:outline-none focus:border-cyan-500"
                    />
                    {importedNostrSecret.trim().startsWith('ncryptsec1') && (
                      <input
                        type="password"
                        required
                        value={importedBackupPassword}
                        onChange={(e) => setImportedBackupPassword(e.target.value)}
                        placeholder={language === 'ar' ? 'كلمة مرور فك تشفير ncryptsec1...' : 'Passphrase to decrypt ncryptsec1...'}
                        className="w-full min-h-[40px] px-3 rounded-lg bg-white dark:bg-[#0C1222] border border-slate-200 dark:border-white/15 text-xs focus:outline-none focus:border-cyan-500"
                      />
                    )}
                  </div>
                )}
              </div>

              <button
                type="submit"
                disabled={loading || usernameStatus.available === false}
                className="w-full min-h-[46px] px-5 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 dark:bg-[#00E5FF] dark:hover:bg-[#33ECFF] text-white dark:text-[#041018] font-semibold text-sm flex items-center justify-center gap-2 disabled:opacity-50 transition-colors"
              >
                <KeyRound className="w-4 h-4" />
                <span>{t.createAccountBtn}</span>
              </button>
            </form>
          )}
        </section>
      </main>
    </div>
  );
};
