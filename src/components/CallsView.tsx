import React, { useEffect, useRef } from 'react';
import {
  Mic,
  MicOff,
  Phone,
  PhoneCall,
  PhoneIncoming,
  PhoneOff,
  PhoneOutgoing,
  Radio,
  Video,
  VideoOff,
  Volume2,
} from 'lucide-react';
import { AppLanguage, CallLogEntry, CustomizationConfig, PrivacyPlusConfig, PublicUser } from '../types/charisma';
import { TRANSLATIONS, formatLocalizedDate } from '../i18n/translations';
import { getPageCardStyle, getPageShellStyle } from '../utils/themeEngine';
import { UserAvatar } from './UserAvatar';

export interface ActiveCallSession {
  callId: string;
  peer: PublicUser;
  kind: 'audio' | 'video';
  direction: 'incoming' | 'outgoing';
  state: 'ringing' | 'connecting' | 'connected';
  startedAt: number;
  micMuted: boolean;
  cameraEnabled: boolean;
  speakerEnabled: boolean;
}

interface CallsViewProps {
  language: AppLanguage;
  customization: CustomizationConfig;
  privacy: PrivacyPlusConfig;
  connectedRelayCount: number;
  directoryUsers: PublicUser[];
  callLogs: CallLogEntry[];
  activeCall: ActiveCallSession | null;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  onStartCall: (peer: PublicUser, kind: 'audio' | 'video') => void;
  onAcceptIncomingCall: () => void;
  onEndCall: () => void;
  onToggleMic: () => void;
  onToggleCamera: () => void;
  onToggleSpeaker: () => void;
}

export const CallsView: React.FC<CallsViewProps> = ({
  language,
  customization,
  privacy,
  connectedRelayCount,
  directoryUsers,
  callLogs,
  activeCall,
  localStream,
  remoteStream,
  onStartCall,
  onAcceptIncomingCall,
  onEndCall,
  onToggleMic,
  onToggleCamera,
  onToggleSpeaker,
}) => {
  const t = TRANSLATIONS[language];
  const callsShellStyle = getPageShellStyle(customization, 'calls');
  const callsCardStyle = getPageCardStyle(customization, 'calls');
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream;
    }
  }, [remoteStream]);

  return (
    <div className="flex-1 overflow-y-auto p-6 bg-[#F4F7FC] dark:bg-[#05070D]" style={callsShellStyle}>
      <div className="max-w-5xl mx-auto space-y-8">
        <header className="space-y-1">
          <h2 className="font-display text-2xl font-bold">{t.callsTitle}</h2>
          <p className="text-sm text-slate-500 dark:text-[#9AA8C7]">{t.callsSubtitle}</p>
        </header>

        {/* Honest WebRTC Signaling / STUN / TURN Architecture Panel */}
        <section
          className="p-4 rounded-2xl bg-white dark:bg-[#0C1222] border border-slate-200 dark:border-white/10 text-xs space-y-1.5"
          style={callsCardStyle}
        >
          <div className="font-semibold flex items-center gap-2 text-cyan-600 dark:text-[#00E5FF]">
            <Radio className="w-4 h-4 shrink-0" />
            <span>
              {language === 'ar'
                ? `إشارات المكالمات: Nostr NIP-59 (${connectedRelayCount} Relays) + BroadcastChannel`
                : `Call Signaling: Encrypted Nostr NIP-59 (${connectedRelayCount} Relays) + Local Mesh`}
            </span>
          </div>
          <p className="text-slate-600 dark:text-[#9AA8C7] leading-relaxed" dir="ltr">
            STUN: {privacy.stunServerUrl ? privacy.stunServerUrl : 'Host-only local ICE (no STUN)'} · TURN:{' '}
            {privacy.customTurnUrl ? privacy.customTurnUrl : 'None (optional self-hosted coturn can be set in Settings)'}
          </p>
        </section>

        {/* Active WebRTC Call Surface */}
        {activeCall && (
          <section className="rounded-3xl bg-[#080C18] text-white border border-cyan-500/30 p-6 space-y-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <UserAvatar
                  avatarColor={activeCall.peer.avatarColor}
                  avatarEmoji={activeCall.peer.avatarEmoji}
                  avatarDataUrl={activeCall.peer.avatarDataUrl}
                  alt={activeCall.peer.displayName}
                  sizeClass="w-12 h-12"
                  textClass="text-lg"
                />
                <div>
                  <h3 className="font-semibold text-base">{activeCall.peer.displayName}</h3>
                  <p className="text-xs text-cyan-400">
                    {activeCall.state === 'ringing'
                      ? activeCall.direction === 'incoming'
                        ? t.incomingCall
                        : language === 'ar'
                        ? 'جارٍ الرنين عبر إشارات WebRTC...'
                        : 'Ringing via WebRTC signaling...'
                      : activeCall.state === 'connecting'
                      ? language === 'ar'
                        ? 'جارٍ التفاوض المحلي عبر WebRTC ICE...'
                        : 'Negotiating local WebRTC ICE...'
                      : language === 'ar'
                      ? 'متصل (WebRTC P2P)'
                      : 'Connected (WebRTC P2P)'}
                  </p>
                </div>
              </div>
              <span className="text-xs font-mono-tabular text-slate-400">
                {activeCall.kind.toUpperCase()}
              </span>
            </div>

            {activeCall.kind === 'video' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="aspect-video rounded-2xl bg-[#05070D] border border-white/10 overflow-hidden relative flex items-center justify-center">
                  <video ref={remoteVideoRef} autoPlay playsInline className="w-full h-full object-cover" />
                  {!remoteStream && (
                    <span className="text-xs text-slate-400 absolute">
                      {language === 'ar' ? 'في انتظار بث الطرف الآخر' : 'Waiting for remote media stream'}
                    </span>
                  )}
                </div>
                <div className="aspect-video rounded-2xl bg-[#05070D] border border-white/10 overflow-hidden relative flex items-center justify-center">
                  <video ref={localVideoRef} autoPlay muted playsInline className="w-full h-full object-cover" />
                  {!localStream && (
                    <span className="text-xs text-slate-400 absolute">
                      {language === 'ar' ? 'الكاميرا غير متاحة أو مغلقة' : 'Local camera preview'}
                    </span>
                  )}
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
              {activeCall.state === 'ringing' && activeCall.direction === 'incoming' ? (
                <>
                  <button
                    type="button"
                    onClick={onAcceptIncomingCall}
                    className="min-h-[46px] px-6 rounded-xl bg-emerald-500 text-white font-semibold text-sm flex items-center gap-2"
                  >
                    <PhoneCall className="w-4 h-4" />
                    <span>{t.acceptCall}</span>
                  </button>
                  <button
                    type="button"
                    onClick={onEndCall}
                    className="min-h-[46px] px-6 rounded-xl bg-red-500 text-white font-semibold text-sm flex items-center gap-2"
                  >
                    <PhoneOff className="w-4 h-4" />
                    <span>{t.declineCall}</span>
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={onToggleMic}
                    className={`min-h-[46px] min-w-[46px] px-4 rounded-xl border ${
                      activeCall.micMuted ? 'bg-red-500/20 border-red-500 text-red-300' : 'border-white/15 bg-white/5'
                    }`}
                  >
                    {activeCall.micMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                  </button>
                  {activeCall.kind === 'video' && (
                    <button
                      type="button"
                      onClick={onToggleCamera}
                      className={`min-h-[46px] min-w-[46px] px-4 rounded-xl border ${
                        !activeCall.cameraEnabled ? 'bg-red-500/20 border-red-500 text-red-300' : 'border-white/15 bg-white/5'
                      }`}
                    >
                      {activeCall.cameraEnabled ? <Video className="w-4 h-4" /> : <VideoOff className="w-4 h-4" />}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={onToggleSpeaker}
                    className={`min-h-[46px] min-w-[46px] px-4 rounded-xl border ${
                      activeCall.speakerEnabled ? 'border-cyan-400 text-cyan-400 bg-cyan-500/10' : 'border-white/15 bg-white/5'
                    }`}
                  >
                    <Volume2 className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={onEndCall}
                    className="min-h-[46px] px-6 rounded-xl bg-red-600 hover:bg-red-500 text-white font-semibold text-sm flex items-center gap-2"
                  >
                    <PhoneOff className="w-4 h-4" />
                    <span>{t.endCall}</span>
                  </button>
                </>
              )}
            </div>
          </section>
        )}

        {/* Quick Call Directory */}
        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-slate-600 dark:text-[#9AA8C7]">
            {language === 'ar' ? 'جهات الاتصال المتاحة للمكالمات' : 'Available Peers for WebRTC Calling'}
          </h3>
          {directoryUsers.length === 0 ? (
            <div className="p-6 rounded-2xl bg-white dark:bg-[#0C1222] border border-slate-200 dark:border-white/10 text-sm text-slate-500" style={callsCardStyle}>
              {language === 'ar'
                ? 'أضف صديقاً عبر مفتاح npub أو رمز QR في قسم جهات الاتصال، أو سجّل الدخول بحساب ثانٍ لبدء مكالمة WebRTC مشفرة.'
                : 'Add a peer via npub/QR in Contacts or sign into a second account to initiate encrypted WebRTC calls.'}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {directoryUsers.map((u) => (
                <div
                  key={u.userId}
                  className="p-4 rounded-2xl bg-white dark:bg-[#0C1222] border border-slate-200 dark:border-white/10 flex items-center justify-between gap-3"
                  style={callsCardStyle}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <UserAvatar
                      avatarColor={u.avatarColor}
                      avatarEmoji={u.avatarEmoji}
                      avatarDataUrl={u.avatarDataUrl}
                      alt={u.displayName}
                      sizeClass="w-10 h-10"
                      textClass="text-sm"
                      roundedClass="rounded-xl"
                    />
                    <div className="min-w-0">
                      <div className="text-sm font-semibold truncate">{u.displayName}</div>
                      <div className="text-xs text-slate-500 font-mono-tabular">@{u.username}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => onStartCall(u, 'audio')}
                      className="min-h-[40px] min-w-[40px] rounded-xl bg-cyan-500/10 text-cyan-600 dark:text-[#00E5FF] flex items-center justify-center"
                      title={t.startAudioCall}
                    >
                      <Phone className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onStartCall(u, 'video')}
                      className="min-h-[40px] min-w-[40px] rounded-xl bg-violet-500/10 text-violet-600 dark:text-[#9D4EDD] flex items-center justify-center"
                      title={t.startVideoCall}
                    >
                      <Video className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Call History */}
        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-slate-600 dark:text-[#9AA8C7]">{t.callHistory}</h3>
          {callLogs.length === 0 ? (
            <p className="text-sm text-slate-500">{t.noCalls}</p>
          ) : (
            <div className="rounded-2xl bg-white dark:bg-[#0C1222] border border-slate-200 dark:border-white/10 divide-y divide-slate-100 dark:divide-white/5">
              {callLogs.map((log) => (
                <div key={log.callId} className="p-4 flex items-center justify-between text-sm">
                  <div className="flex items-center gap-3">
                    {log.direction === 'incoming' ? (
                      <PhoneIncoming className="w-4 h-4 text-emerald-500" />
                    ) : (
                      <PhoneOutgoing className="w-4 h-4 text-cyan-500" />
                    )}
                    <div>
                      <div className="font-medium">{log.peerName}</div>
                      <div className="text-xs text-slate-500 font-mono-tabular">
                        {log.kind.toUpperCase()} · {formatLocalizedDate(log.startedAt, language)}
                      </div>
                    </div>
                  </div>
                  <span className="text-xs font-mono-tabular text-slate-500">
                    {log.durationSec}s · {log.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
};
