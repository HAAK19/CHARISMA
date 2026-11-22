import React, { useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Plus,
  RefreshCw,
  Search,
  Server,
  Trash2,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import { AppLanguage, CustomizationConfig, RelayConfig } from '../types/charisma';
import { TRANSLATIONS } from '../i18n/translations';
import { DEFAULT_NOSTR_RELAYS, normalizeRelayUrl } from '../nostr/nostrRelayPool';
import { getPageCardStyle, getPageShellStyle } from '../utils/themeEngine';

interface RelaysModalProps {
  language: AppLanguage;
  relays: RelayConfig[];
  customization: CustomizationConfig;
  outboxCount: number;
  onUpdateRelays: (nextRelays: RelayConfig[]) => void;
  onReconnectAll: () => void;
  onClose: () => void;
}

export const RelaysModal: React.FC<RelaysModalProps> = ({
  language,
  relays,
  customization,
  outboxCount,
  onUpdateRelays,
  onReconnectAll,
  onClose,
}) => {
  const t = TRANSLATIONS[language];
  const [newRelayUrl, setNewRelayUrl] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const shellStyle = getPageShellStyle(customization, 'settings');
  const cardStyle = getPageCardStyle(customization, 'settings');
  const connectedCount = relays.filter((r) => r.status === 'connected').length;
  const searchCapableCount = relays.filter(
    (r) => r.status === 'connected' && (r.isSearch || r.supportedNips?.includes(50)),
  ).length;

  function handleAddRelay(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg(null);
    const normalized = normalizeRelayUrl(newRelayUrl);
    if (!normalized || !normalized.startsWith('wss://')) {
      setErrorMsg(
        language === 'ar'
          ? 'أدخل عنوان Relay آمن يبدأ بـ wss://'
          : 'Enter a valid secure WebSocket URL starting with wss://',
      );
      return;
    }
    if (relays.some((r) => r.url === normalized)) {
      setErrorMsg(language === 'ar' ? 'هذا الـ Relay مضاف بالفعل' : 'Relay is already configured');
      return;
    }
    onUpdateRelays([
      ...relays,
      { url: normalized, read: true, write: true, isSearch: false, status: 'connecting' },
    ]);
    setNewRelayUrl('');
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/65 backdrop-blur-xs flex items-center justify-center p-4">
      <div
        className="max-w-3xl w-full max-h-[90vh] bg-white dark:bg-[#0C1222] border border-slate-200 dark:border-white/15 rounded-3xl overflow-hidden flex flex-col"
        style={shellStyle}
      >
        <header
          className="px-6 py-4 border-b border-slate-200 dark:border-white/10 flex items-center justify-between gap-3"
          style={cardStyle}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <Server className="w-5 h-5 shrink-0" style={{ color: customization.primaryAccent }} />
            <div className="min-w-0">
              <h2 className="font-display text-base font-bold truncate">{t.relaysTitle}</h2>
              <p className="text-xs text-slate-500 dark:text-[#9AA8C7] truncate">
                {language === 'ar'
                  ? `متصل: ${connectedCount}/${relays.length} · بحث NIP-50: ${searchCapableCount} · معلّق: ${outboxCount}`
                  : `Connected: ${connectedCount}/${relays.length} · NIP-50 Search: ${searchCapableCount} · Queued: ${outboxCount}`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onReconnectAll}
              className="min-h-[36px] px-3 rounded-xl border border-slate-200 dark:border-white/15 text-xs font-semibold flex items-center gap-1.5 hover:border-cyan-500"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>{t.reconnectRelaysBtn}</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-white/10"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Honest Third-Party Relay & Metadata Notice */}
          <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/25 text-xs space-y-1.5">
            <div className="font-semibold flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{language === 'ar' ? 'شفافية الشبكة اللامركزية والخصوصية' : 'Decentralized Relay & Metadata Disclosure'}</span>
            </div>
            <p className="opacity-90 leading-relaxed">{t.relayPrivacyNotice}</p>
          </div>

          {/* Add Custom Relay */}
          <form onSubmit={handleAddRelay} className="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              dir="ltr"
              value={newRelayUrl}
              onChange={(e) => setNewRelayUrl(e.target.value)}
              placeholder="wss://relay.example.com"
              className="flex-1 min-h-[42px] px-3.5 rounded-xl bg-slate-100 dark:bg-[#05070D] border border-slate-200 dark:border-white/10 text-xs font-mono-tabular focus:outline-none focus:border-cyan-500"
            />
            <button
              type="submit"
              className="min-h-[42px] px-4 rounded-xl text-[#041018] text-xs font-semibold flex items-center justify-center gap-1.5 shrink-0"
              style={{ backgroundColor: customization.primaryAccent }}
            >
              <Plus className="w-4 h-4" />
              <span>{t.addRelayBtn}</span>
            </button>
            <button
              type="button"
              onClick={() => onUpdateRelays(DEFAULT_NOSTR_RELAYS.map((r) => ({ ...r })))}
              className="min-h-[42px] px-3.5 rounded-xl border border-slate-200 dark:border-white/15 text-xs font-semibold shrink-0"
            >
              {language === 'ar' ? 'استعادة الافتراضي' : 'Reset Defaults'}
            </button>
          </form>

          {errorMsg && (
            <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/25 text-xs text-red-500">
              {errorMsg}
            </div>
          )}

          {/* Configured Relays */}
          <div className="space-y-3">
            {relays.map((relay) => {
              const isConnected = relay.status === 'connected';
              const isConnecting = relay.status === 'connecting';
              const supportsNip50 = Boolean(relay.isSearch || relay.supportedNips?.includes(50));
              const supportsNip17 = relay.supportedNips?.includes(59) || relay.supportedNips?.includes(17);

              return (
                <div
                  key={relay.url}
                  className="p-4 rounded-2xl bg-slate-50 dark:bg-[#05070D] border border-slate-200 dark:border-white/10 space-y-3"
                  style={cardStyle}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      {isConnected ? (
                        <Wifi className="w-4 h-4 text-emerald-500 shrink-0" />
                      ) : isConnecting ? (
                        <Activity className="w-4 h-4 text-amber-400 animate-pulse shrink-0" />
                      ) : (
                        <WifiOff className="w-4 h-4 text-rose-500 shrink-0" />
                      )}
                      <div className="min-w-0">
                        <div className="text-xs font-mono-tabular font-semibold truncate" dir="ltr">
                          {relay.url}
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-[#9AA8C7] flex flex-wrap items-center gap-2 mt-0.5">
                          <span>
                            {isConnected
                              ? language === 'ar' ? 'متصل' : 'Connected'
                              : isConnecting
                              ? language === 'ar' ? 'جارٍ الاتصال...' : 'Connecting...'
                              : language === 'ar' ? 'غير متصل' : 'Disconnected'}
                          </span>
                          {typeof relay.latencyMs === 'number' && isConnected && (
                            <span className="font-mono-tabular">· {relay.latencyMs}ms</span>
                          )}
                          {relay.name && <span>· {relay.name}</span>}
                          {relay.lastError && !isConnected && (
                            <span className="text-rose-400">· {relay.lastError}</span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 flex-wrap">
                      {supportsNip50 && (
                        <span className="px-2 py-0.5 rounded-md bg-cyan-500/15 text-cyan-600 dark:text-[#00E5FF] text-[10px] font-semibold flex items-center gap-1">
                          <Search className="w-3 h-3" />
                          NIP-50
                        </span>
                      )}
                      {supportsNip17 && (
                        <span className="px-2 py-0.5 rounded-md bg-emerald-500/15 text-emerald-500 text-[10px] font-semibold">
                          NIP-59
                        </span>
                      )}
                      {relay.paymentRequired && (
                        <span className="px-2 py-0.5 rounded-md bg-amber-500/15 text-amber-500 text-[10px] font-semibold">
                          {language === 'ar' ? 'يتطلب رسوماً' : 'Paid Relay'}
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => onUpdateRelays(relays.filter((r) => r.url !== relay.url))}
                        disabled={relays.length <= 1}
                        title={language === 'ar' ? 'حذف Relay' : 'Remove relay'}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-rose-500 disabled:opacity-30"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-4 text-xs pt-1 border-t border-slate-200 dark:border-white/5">
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={relay.read}
                        onChange={(e) =>
                          onUpdateRelays(
                            relays.map((r) =>
                              r.url === relay.url ? { ...r, read: e.target.checked } : r,
                            ),
                          )
                        }
                      />
                      <span>{language === 'ar' ? 'قراءة (استقبال)' : 'Read'}</span>
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={relay.write}
                        onChange={(e) =>
                          onUpdateRelays(
                            relays.map((r) =>
                              r.url === relay.url ? { ...r, write: e.target.checked } : r,
                            ),
                          )
                        }
                      />
                      <span>{language === 'ar' ? 'كتابة (نشر)' : 'Write'}</span>
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={Boolean(relay.isSearch)}
                        onChange={(e) =>
                          onUpdateRelays(
                            relays.map((r) =>
                              r.url === relay.url ? { ...r, isSearch: e.target.checked } : r,
                            ),
                          )
                        }
                      />
                      <span>{language === 'ar' ? 'بحث NIP-50' : 'NIP-50 Search'}</span>
                    </label>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
