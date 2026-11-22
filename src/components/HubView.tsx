import React, { useEffect, useState } from 'react';
import {
  Activity,
  Download,
  FileLock2,
  FolderLock,
  HardDrive,
  KeyRound,
  Lock,
  Send,
  ShieldCheck,
  Sparkles,
  Trash2,
  Unlock,
  Upload,
  Wifi,
} from 'lucide-react';
import {
  AppLanguage,
  CallLogEntry,
  ChatMessage,
  Conversation,
  PrivacyPlusConfig,
  PublicUser,
  VaultItem,
} from '../types/charisma';
import { TRANSLATIONS, formatBytes, formatLocalizedNumber } from '../i18n/translations';
import {
  decryptWithPassphrase,
  encryptWithPassphrase,
  sha256Hex,
} from '../crypto/charismaCrypto';
import { LocalAssistAction, runLocalTextAssistant } from '../utils/localTextAssistant';
import { QrCodeDisplay } from './QrCodeDisplay';

export interface TransferProgressState {
  transferId: string;
  peerName: string;
  fileName: string;
  sizeBytes: number;
  transferredBytes: number;
  direction: 'send' | 'receive';
  status: 'negotiating' | 'transferring' | 'verified' | 'error';
  sha256Hex?: string;
}

interface HubViewProps {
  language: AppLanguage;
  currentUser: PublicUser;
  directoryUsers: PublicUser[];
  conversations: Conversation[];
  messages: ChatMessage[];
  callLogs: CallLogEntry[];
  vaultItems: VaultItem[];
  privacy: PrivacyPlusConfig;
  transferState: TransferProgressState | null;
  onAddVaultItem: (item: VaultItem) => void;
  onDeleteVaultItem: (vaultId: string) => void;
  onStartDirectTransfer: (peer: PublicUser, file: File) => void;
}

export const HubView: React.FC<HubViewProps> = ({
  language,
  currentUser,
  directoryUsers,
  conversations,
  messages,
  callLogs,
  vaultItems,
  privacy,
  transferState,
  onAddVaultItem,
  onDeleteVaultItem,
  onStartDirectTransfer,
}) => {
  const t = TRANSLATIONS[language];
  const [section, setSection] = useState<'vault' | 'transfer' | 'dashboard' | 'tools'>('vault');

  // Vault state
  const [vaultPassphrase, setVaultPassphrase] = useState('');
  const [vaultUnlocked, setVaultUnlocked] = useState(false);
  const [vaultFolder, setVaultFolder] = useState('Private Docs');
  const [vaultError, setVaultError] = useState<string | null>(null);

  // Direct transfer
  const [selectedPeerId, setSelectedPeerId] = useState<string>('');
  const [transferFile, setTransferFile] = useState<File | null>(null);

  // Dashboard storage estimation
  const [quotaEstimate, setQuotaEstimate] = useState<{ usage: number; quota: number } | null>(null);

  // Offline local text workbench
  const [toolAction, setToolAction] = useState<LocalAssistAction>('summarize');
  const [toolInput, setToolInput] = useState('');
  const [toolOutput, setToolOutput] = useState('');

  useEffect(() => {
    if (navigator.storage?.estimate) {
      navigator.storage.estimate().then((est) => {
        setQuotaEstimate({ usage: est.usage || 0, quota: est.quota || 0 });
      });
    }
  }, [messages.length, vaultItems.length]);

  useEffect(() => {
    if (!vaultUnlocked) return;
    const timer = setTimeout(() => {
      setVaultUnlocked(false);
    }, 5 * 60_000);
    return () => clearTimeout(timer);
  }, [vaultUnlocked]);

  async function handleVaultUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !vaultPassphrase) return;
    setVaultError(null);
    const buffer = await file.arrayBuffer();
    const digestHex = await sha256Hex(buffer);
    const encrypted = await encryptWithPassphrase(vaultPassphrase, buffer);
    const item: VaultItem = {
      vaultId: `vlt_${crypto.randomUUID()}`,
      ownerUserId: currentUser.userId,
      folder: vaultFolder,
      fileName: file.name,
      mimeType: file.type || 'application/octet-stream',
      sizeBytes: file.size,
      ivB64: encrypted.ivB64,
      saltB64: encrypted.saltB64,
      encryptedDataB64: encrypted.encryptedDataB64,
      sha256Hex: digestHex,
      createdAt: Date.now(),
    };
    onAddVaultItem(item);
    e.target.value = '';
  }

  async function handleVaultDecryptDownload(item: VaultItem) {
    setVaultError(null);
    try {
      const plainBuf = await decryptWithPassphrase(
        vaultPassphrase,
        item.ivB64,
        item.saltB64,
        item.encryptedDataB64,
      );
      const blob = new Blob([plainBuf], { type: item.mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = item.fileName;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setVaultError(
        language === 'ar'
          ? 'فشل فك التشفير: كلمة مرور الخزنة لا تطابق الملف.'
          : 'Decryption failed: passphrase does not match this encrypted item.',
      );
    }
  }

  function handleRunLocalTool(e: React.FormEvent) {
    e.preventDefault();
    if (!toolInput.trim()) return;
    const res = runLocalTextAssistant(toolAction, toolInput, language);
    if (res.suggestions) {
      setToolOutput(res.suggestions.map((s) => `• ${s}`).join('\n'));
    } else {
      setToolOutput(res.result || '');
    }
  }

  const mediaBytes = messages.reduce((acc, m) => acc + (m.attachment?.sizeBytes || 0), 0);
  const vaultBytes = vaultItems.reduce((acc, v) => acc + v.sizeBytes, 0);
  const totalCallSec = callLogs.reduce((acc, c) => acc + c.durationSec, 0);

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-[#F4F7FC] dark:bg-[#05070D]">
      <header className="px-6 py-4 border-b border-slate-200 dark:border-white/10 bg-white dark:bg-[#0C1222]">
        <div className="max-w-6xl mx-auto flex flex-wrap items-center gap-2">
          {[
            { id: 'vault', label: t.vaultTitle, icon: FolderLock },
            { id: 'transfer', label: t.directTransferTitle, icon: Wifi },
            { id: 'dashboard', label: t.dashboardTitle, icon: Activity },
            { id: 'tools', label: t.aiCenterTitle, icon: Sparkles },
          ].map((tab) => {
            const Icon = tab.icon;
            const active = section === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setSection(tab.id as typeof section)}
                className={`min-h-[40px] px-4 rounded-xl text-xs font-semibold flex items-center gap-2 transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-cyan-600 dark:bg-[#00E5FF] text-white dark:text-[#041018]'
                    : 'bg-slate-100 dark:bg-[#05070D] text-slate-600 dark:text-[#9AA8C7]'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-5xl mx-auto space-y-6">
          {/* 1. Digital Vault */}
          {section === 'vault' && (
            <section className="space-y-6">
              <div>
                <h2 className="font-display text-2xl font-bold">{t.vaultTitle}</h2>
                <p className="text-sm text-slate-500 dark:text-[#9AA8C7] mt-1">{t.vaultSubtitle}</p>
              </div>

              {!vaultUnlocked ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (vaultPassphrase.length >= 4) setVaultUnlocked(true);
                  }}
                  className="max-w-md bg-white dark:bg-[#0C1222] border border-slate-200 dark:border-white/10 rounded-2xl p-6 space-y-4"
                >
                  <div className="flex items-center gap-2.5 text-cyan-600 dark:text-[#00E5FF]">
                    <Lock className="w-5 h-5" />
                    <span className="font-semibold text-sm">
                      {language === 'ar' ? 'فتح الخزنة المشفرة محلياً' : 'Unlock Local Encrypted Vault'}
                    </span>
                  </div>
                  <input
                    type="password"
                    required
                    minLength={4}
                    value={vaultPassphrase}
                    onChange={(e) => setVaultPassphrase(e.target.value)}
                    placeholder={language === 'ar' ? 'كلمة مرور الخزنة (4 أحرف على الأقل)' : 'Vault encryption passphrase (min 4 chars)'}
                    className="w-full min-h-[44px] px-4 rounded-xl bg-slate-100 dark:bg-[#05070D] text-sm focus:outline-none"
                  />
                  <button
                    type="submit"
                    className="w-full min-h-[44px] rounded-xl bg-cyan-600 dark:bg-[#00E5FF] text-white dark:text-[#041018] text-sm font-semibold flex items-center justify-center gap-2"
                  >
                    <Unlock className="w-4 h-4" />
                    <span>{language === 'ar' ? 'فتح الخزنة' : 'Unlock Vault'}</span>
                  </button>
                </form>
              ) : (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3 p-4 rounded-2xl bg-white dark:bg-[#0C1222] border border-slate-200 dark:border-white/10">
                    <div className="flex items-center gap-3">
                      <select
                        value={vaultFolder}
                        onChange={(e) => setVaultFolder(e.target.value)}
                        className="min-h-[40px] px-3 rounded-xl bg-slate-100 dark:bg-[#05070D] text-xs"
                      >
                        <option value="Private Docs">Private Docs</option>
                        <option value="Identity & Keys">Identity & Keys</option>
                        <option value="Media Archive">Media Archive</option>
                      </select>
                      <label className="min-h-[40px] px-4 rounded-xl bg-cyan-600 dark:bg-[#00E5FF] text-white dark:text-[#041018] text-xs font-semibold flex items-center gap-2 cursor-pointer">
                        <Upload className="w-4 h-4" />
                        <span>{language === 'ar' ? 'تشفير وحفظ ملف' : 'Encrypt & Store File'}</span>
                        <input type="file" onChange={handleVaultUpload} className="hidden" />
                      </label>
                    </div>
                    <button
                      type="button"
                      onClick={() => setVaultUnlocked(false)}
                      className="min-h-[40px] px-3 rounded-xl border border-slate-200 dark:border-white/15 text-xs flex items-center gap-1.5"
                    >
                      <Lock className="w-3.5 h-3.5" />
                      <span>{language === 'ar' ? 'قفل الآن' : 'Lock Vault'}</span>
                    </button>
                  </div>

                  {vaultError && (
                    <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-xs text-red-500">
                      {vaultError}
                    </div>
                  )}

                  <div className="rounded-2xl bg-white dark:bg-[#0C1222] border border-slate-200 dark:border-white/10 divide-y divide-slate-100 dark:divide-white/5">
                    {vaultItems.length === 0 ? (
                      <p className="p-8 text-center text-sm text-slate-500">
                        {language === 'ar' ? 'لا توجد ملفات مشفرة في الخزنة بعد.' : 'No encrypted vault files yet.'}
                      </p>
                    ) : (
                      vaultItems.map((item) => (
                        <div key={item.vaultId} className="p-4 flex items-center justify-between gap-3">
                          <div className="flex items-center gap-3 min-w-0">
                            <FileLock2 className="w-5 h-5 text-cyan-500 shrink-0" />
                            <div className="min-w-0">
                              <div className="text-sm font-medium truncate">{item.fileName}</div>
                              <div className="text-xs text-slate-500 font-mono-tabular">
                                {item.folder} · {formatBytes(item.sizeBytes, language)} · SHA-256: {item.sha256Hex.slice(0, 12)}...
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              type="button"
                              onClick={() => handleVaultDecryptDownload(item)}
                              className="min-h-[38px] px-3 rounded-lg bg-slate-100 dark:bg-white/10 text-xs flex items-center gap-1.5"
                            >
                              <Download className="w-3.5 h-3.5" />
                              <span>{language === 'ar' ? 'فك وتنزيل' : 'Decrypt'}</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => onDeleteVaultItem(item.vaultId)}
                              className="min-h-[38px] min-w-[38px] rounded-lg hover:bg-red-500/10 text-red-500 flex items-center justify-center"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </section>
          )}

          {/* 2. Local Direct Transfer */}
          {section === 'transfer' && (
            <section className="space-y-6">
              <div>
                <h2 className="font-display text-2xl font-bold">{t.directTransferTitle}</h2>
                <p className="text-sm text-slate-500 dark:text-[#9AA8C7] mt-1">{t.directTransferSubtitle}</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="p-6 rounded-2xl bg-white dark:bg-[#0C1222] border border-slate-200 dark:border-white/10 space-y-4">
                  <h3 className="font-semibold text-sm">
                    {language === 'ar' ? 'إرسال ملف مباشر عبر WebRTC المحلي' : 'Send File via Local Peer WebRTC'}
                  </h3>
                  <select
                    value={selectedPeerId}
                    onChange={(e) => setSelectedPeerId(e.target.value)}
                    className="w-full min-h-[42px] px-3.5 rounded-xl bg-slate-100 dark:bg-[#05070D] text-sm"
                  >
                    <option value="">{language === 'ar' ? 'اختر حساباً محلياً...' : 'Select local account/tab peer...'}</option>
                    {directoryUsers.map((u) => (
                      <option key={u.userId} value={u.userId}>
                        {u.displayName} (@{u.username})
                      </option>
                    ))}
                  </select>
                  <input
                    type="file"
                    onChange={(e) => setTransferFile(e.target.files?.[0] || null)}
                    className="block w-full text-xs text-slate-500 file:me-3 file:py-2 file:px-4 file:rounded-xl file:border-0 file:bg-cyan-500/10 file:text-cyan-600 dark:file:text-[#00E5FF]"
                  />
                  <button
                    type="button"
                    disabled={!selectedPeerId || !transferFile}
                    onClick={() => {
                      const peer = directoryUsers.find((u) => u.userId === selectedPeerId);
                      if (peer && transferFile) onStartDirectTransfer(peer, transferFile);
                    }}
                    className="w-full min-h-[44px] rounded-xl bg-cyan-600 dark:bg-[#00E5FF] text-white dark:text-[#041018] text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    <Send className="w-4 h-4" />
                    <span>{language === 'ar' ? 'بدء النقل المباشر المشفر' : 'Start P2P Encrypted Transfer'}</span>
                  </button>

                  {transferState && (
                    <div className="p-4 rounded-xl bg-slate-100 dark:bg-[#05070D] space-y-2 text-xs">
                      <div className="flex justify-between font-medium">
                        <span>{transferState.fileName}</span>
                        <span className="font-mono-tabular">
                          {Math.round((transferState.transferredBytes / Math.max(1, transferState.sizeBytes)) * 100)}%
                        </span>
                      </div>
                      <div className="h-2 rounded-full bg-slate-200 dark:bg-white/10 overflow-hidden">
                        <div
                          className="h-full bg-cyan-500 transition-all"
                          style={{
                            width: `${Math.min(100, (transferState.transferredBytes / Math.max(1, transferState.sizeBytes)) * 100)}%`,
                          }}
                        />
                      </div>
                      <div className="text-slate-500 font-mono-tabular">
                        {transferState.status.toUpperCase()}
                        {transferState.sha256Hex && ` · SHA-256: ${transferState.sha256Hex.slice(0, 16)}...`}
                      </div>
                    </div>
                  )}
                </div>

                <div className="p-6 rounded-2xl bg-white dark:bg-[#0C1222] border border-slate-200 dark:border-white/10 flex flex-col items-center justify-center text-center space-y-3">
                  <QrCodeDisplay
                    value={JSON.stringify({
                      charismaDirectTransfer: true,
                      userId: currentUser.userId,
                      username: currentUser.username,
                    })}
                    size={160}
                    label={`@${currentUser.username}`}
                  />
                  <p className="text-xs text-slate-500 dark:text-[#9AA8C7]">
                    {language === 'ar'
                      ? 'رمز هوية محلي — لا تمر الملفات عبر أي خادم سحابي أو إنترنت.'
                      : 'Local identity QR — files transfer locally with SHA-256 verification and zero cloud storage.'}
                  </p>
                </div>
              </div>
            </section>
          )}

          {/* 3. Communication Dashboard */}
          {section === 'dashboard' && (
            <section className="space-y-6">
              <div>
                <h2 className="font-display text-2xl font-bold">{t.dashboardTitle}</h2>
                <p className="text-sm text-slate-500 dark:text-[#9AA8C7] mt-1">{t.dashboardSubtitle}</p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {[
                  {
                    label: language === 'ar' ? 'المحادثات المحلية' : 'Conversations',
                    value: formatLocalizedNumber(conversations.length, language),
                    sub: `${conversations.filter((c) => c.isLocked).length} locked`,
                  },
                  {
                    label: language === 'ar' ? 'عدد الرسائل المخزنة' : 'Message Count',
                    value: formatLocalizedNumber(messages.length, language),
                    sub: language === 'ar' ? 'مشفرة محلياً' : 'Encrypted locally',
                  },
                  {
                    label: language === 'ar' ? 'حجم الوسائط والخزنة' : 'Media & Vault Storage',
                    value: formatBytes(mediaBytes + vaultBytes, language),
                    sub: quotaEstimate ? `Device storage: ${formatBytes(quotaEstimate.usage, language)}` : 'IndexedDB',
                  },
                  {
                    label: language === 'ar' ? 'مدة المكالمات' : 'Call Duration',
                    value: `${formatLocalizedNumber(totalCallSec, language)}s`,
                    sub: `${callLogs.length} calls`,
                  },
                ].map((stat) => (
                  <div
                    key={stat.label}
                    className="p-5 rounded-2xl bg-white dark:bg-[#0C1222] border border-slate-200 dark:border-white/10 space-y-1.5"
                  >
                    <p className="text-xs text-slate-500 dark:text-[#9AA8C7]">{stat.label}</p>
                    <p className="font-display text-2xl font-bold font-mono-tabular">{stat.value}</p>
                    <p className="text-xs text-slate-400 font-mono-tabular">{stat.sub}</p>
                  </div>
                ))}
              </div>

              <div className="p-6 rounded-2xl bg-white dark:bg-[#0C1222] border border-slate-200 dark:border-white/10 space-y-3">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <ShieldCheck className="w-5 h-5 text-cyan-500" />
                  <span>{language === 'ar' ? 'وضعية الأمان والخصوصية المحلية' : 'Local Security & Independence Posture'}</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs text-slate-600 dark:text-[#9AA8C7] pt-2">
                  <div>
                    <HardDrive className="w-4 h-4 text-cyan-500 mb-1" />
                    <div className="font-medium text-slate-900 dark:text-white">
                      {language === 'ar' ? 'الاستقلال عن الخوادم' : 'Offline Independence'}
                    </div>
                    <div className="font-mono-tabular">
                      {language === 'ar' ? '0 خوادم · تخزين محلي فقط' : 'Zero Cloud · Single Device Only'}
                    </div>
                  </div>
                  <div>
                    <KeyRound className="w-4 h-4 text-violet-400 mb-1" />
                    <div className="font-medium text-slate-900 dark:text-white">
                      {language === 'ar' ? 'خوارزمية التشفير' : 'Cipher & KDF Suite'}
                    </div>
                    <div className="font-mono-tabular">PBKDF2-310k · AES-256-GCM</div>
                  </div>
                  <div>
                    <Lock className="w-4 h-4 text-emerald-500 mb-1" />
                    <div className="font-medium text-slate-900 dark:text-white">
                      {language === 'ar' ? 'قفل التطبيق' : 'App Lock Status'}
                    </div>
                    <div>
                      {privacy.appLockEnabled
                        ? language === 'ar' ? 'قفل التطبيق مفعل' : 'App Lock ON'
                        : language === 'ar' ? 'قفل التطبيق معطل' : 'App Lock OFF'}
                    </div>
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* 4. Offline Local Text Tools (Zero API keys, zero network) */}
          {section === 'tools' && (
            <section className="space-y-6">
              <div>
                <h2 className="font-display text-2xl font-bold">{t.aiCenterTitle}</h2>
                <p className="text-sm text-slate-500 dark:text-[#9AA8C7] mt-1">{t.aiCenterSubtitle}</p>
              </div>

              <div className="p-6 rounded-2xl bg-white dark:bg-[#0C1222] border border-slate-200 dark:border-white/10 space-y-4">
                <form onSubmit={handleRunLocalTool} className="space-y-3">
                  <div className="flex flex-wrap gap-2">
                    {[
                      { id: 'summarize', label: language === 'ar' ? 'تلخيص محلي' : 'Local Summary' },
                      { id: 'clean_format', label: language === 'ar' ? 'تنسيق وتنظيف النص' : 'Clean & Format' },
                      { id: 'suggest_replies', label: language === 'ar' ? 'اقتراح ردود سريعة' : 'Quick Replies' },
                      { id: 'stats', label: language === 'ar' ? 'إحصائيات النص' : 'Text Metrics' },
                    ].map((act) => (
                      <button
                        key={act.id}
                        type="button"
                        onClick={() => setToolAction(act.id as LocalAssistAction)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${
                          toolAction === act.id
                            ? 'border-cyan-500 bg-cyan-500/10 text-cyan-600 dark:text-[#00E5FF]'
                            : 'border-slate-200 dark:border-white/10'
                        }`}
                      >
                        {act.label}
                      </button>
                    ))}
                  </div>
                  <textarea
                    rows={4}
                    value={toolInput}
                    onChange={(e) => setToolInput(e.target.value)}
                    placeholder={language === 'ar' ? 'أدخل النص للمعالجة محلياً دون اتصال...' : 'Enter text to process locally offline...'}
                    className="w-full p-3.5 rounded-xl bg-slate-100 dark:bg-[#05070D] text-sm focus:outline-none"
                  />
                  <button
                    type="submit"
                    className="min-h-[42px] px-5 rounded-xl bg-cyan-600 dark:bg-[#00E5FF] text-white dark:text-[#041018] text-xs font-semibold"
                  >
                    {language === 'ar' ? 'تشغيل محلياً الآن' : 'Process Locally Offline'}
                  </button>
                  {toolOutput && (
                    <div className="p-4 rounded-xl bg-slate-50 dark:bg-[#05070D] border border-slate-200 dark:border-white/10 text-sm whitespace-pre-wrap">
                      {toolOutput}
                    </div>
                  )}
                </form>
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
};
