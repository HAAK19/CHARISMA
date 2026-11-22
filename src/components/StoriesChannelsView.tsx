import React, { useEffect, useRef, useState } from 'react';
import {
  Download,
  Eye,
  Image as ImageIcon,
  Layers,
  Lock,
  Megaphone,
  Plus,
  Send,
  Type,
  VolumeX,
  X,
} from 'lucide-react';
import { AppLanguage, ChannelItem, CustomizationConfig, PublicUser, StorySlide } from '../types/charisma';
import { TRANSLATIONS, formatLocalizedTime } from '../i18n/translations';
import { localDb } from '../storage/localDb';
import { getPageCardStyle, getPageShellStyle } from '../utils/themeEngine';

interface StoriesChannelsViewProps {
  language: AppLanguage;
  customization: CustomizationConfig;
  currentUser: PublicUser;
  stories: StorySlide[];
  onAddStory: (slide: StorySlide) => void;
  onReactStory: (storyId: string, emoji: string) => void;
  onMuteStory: (storyId: string) => void;
  onReplyStoryToChat: (authorId: string, storyText: string) => void;
}

const STORY_BG_COLORS = ['#0C1222', '#132A4A', '#2B144A', '#0A332C', '#3F1426'];
const STICKERS = ['⚡', '◈', '🛡️', '✨', '🔥', '💜'];

export const StoriesChannelsView: React.FC<StoriesChannelsViewProps> = ({
  language,
  customization,
  currentUser,
  stories,
  onAddStory,
  onReactStory,
  onMuteStory,
  onReplyStoryToChat,
}) => {
  const t = TRANSLATIONS[language];
  const storiesShellStyle = getPageShellStyle(customization, 'stories');
  const storiesCardStyle = getPageCardStyle(customization, 'stories');
  const [subTab, setSubTab] = useState<'stories' | 'channels'>('stories');

  // Story Studio
  const [showStudio, setShowStudio] = useState(false);
  const [activeStory, setActiveStory] = useState<StorySlide | null>(null);
  const [storyReplyText, setStoryReplyText] = useState('');
  const [studioKind, setStudioKind] = useState<'text' | 'image'>('text');
  const [studioText, setStudioText] = useState('');
  const [studioOverlay, setStudioOverlay] = useState('');
  const [studioSticker, setStudioSticker] = useState('');
  const [studioBg, setStudioBg] = useState(STORY_BG_COLORS[0]);
  const [studioImageUrl, setStudioImageUrl] = useState<string>('/src/assets/images/charisma_story_sample_1795329660387.jpg');
  const [studioFilter, setStudioFilter] = useState<'none' | 'contrast(1.2) saturate(1.2)' | 'grayscale(1)' | 'sepia(0.5)'>('none');
  const [allowDownload, setAllowDownload] = useState(false);
  const [privacyMode, setPrivacyMode] = useState<'all' | 'custom'>('all');
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const isDrawingRef = useRef(false);

  // Local Channels & Communities (100% IndexedDB)
  const [channels, setChannels] = useState<ChannelItem[]>([]);
  const [channelSearch, setChannelSearch] = useState('');
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);
  const [showCreateChannel, setShowCreateChannel] = useState(false);
  const [newChName, setNewChName] = useState('');
  const [newChDesc, setNewChDesc] = useState('');
  const [newChKind, setNewChKind] = useState<'channel' | 'community'>('channel');
  const [newChPublic, setNewChPublic] = useState(true);
  const [newPostText, setNewPostText] = useState('');

  useEffect(() => {
    localDb.getChannels().then((list) => {
      setChannels(list);
      if (!selectedChannelId && list.length > 0) {
        setSelectedChannelId(list[0].channelId);
      }
    });
  }, []);

  function handleCanvasDrawStart(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    isDrawingRef.current = true;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    ctx.strokeStyle = '#00E5FF';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(((e.clientX - rect.left) / rect.width) * canvas.width, ((e.clientY - rect.top) / rect.height) * canvas.height);
  }

  function handleCanvasDrawMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!isDrawingRef.current || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    ctx.lineTo(((e.clientX - rect.left) / rect.width) * canvas.width, ((e.clientY - rect.top) / rect.height) * canvas.height);
    ctx.stroke();
  }

  function handleCanvasDrawEnd() {
    isDrawingRef.current = false;
  }

  function handlePublishStory() {
    const mediaDataUrl = studioKind === 'image' ? studioImageUrl : undefined;
    const slide: StorySlide = {
      storyId: `st_${crypto.randomUUID()}`,
      authorId: currentUser.userId,
      authorName: currentUser.displayName,
      authorEmoji: currentUser.avatarEmoji,
      authorColor: currentUser.avatarColor,
      kind: studioKind,
      text: studioText.trim() || undefined,
      overlayText: studioOverlay.trim() || undefined,
      sticker: studioSticker || undefined,
      bgColor: studioBg,
      mediaDataUrl,
      filterCss: studioFilter,
      allowDownload,
      privacyMode,
      allowedViewerIds: [],
      muted: false,
      reactions: [],
      createdAt: Date.now(),
      expiresAt: Date.now() + 24 * 60 * 60 * 1000,
    };

    onAddStory(slide);
    setStudioText('');
    setStudioOverlay('');
    setStudioSticker('');
    setShowStudio(false);
  }

  async function handleCreateChannel(e: React.FormEvent) {
    e.preventDefault();
    if (!newChName.trim()) return;
    const ch: ChannelItem = {
      channelId: `${newChKind === 'community' ? 'comm' : 'ch'}_${crypto.randomUUID()}`,
      name: newChName.trim().slice(0, 64),
      description: newChDesc.trim().slice(0, 240),
      kind: newChKind,
      isPublic: newChPublic,
      adminUserIds: [currentUser.userId],
      subscriberUserIds: [currentUser.userId],
      memberGroupNames: newChKind === 'community' ? ['General Announcements', 'Local Notes'] : [],
      posts: [],
      createdAt: Date.now(),
    };
    await localDb.saveChannel(ch);
    setChannels((prev) => [ch, ...prev]);
    setSelectedChannelId(ch.channelId);
    setNewChName('');
    setNewChDesc('');
    setShowCreateChannel(false);
  }

  async function handleToggleSubscribe(channel: ChannelItem) {
    const isSub = channel.subscriberUserIds.includes(currentUser.userId);
    const nextSubs = isSub
      ? channel.subscriberUserIds.filter((id) => id !== currentUser.userId)
      : [...channel.subscriberUserIds, currentUser.userId];
    const updated: ChannelItem = { ...channel, subscriberUserIds: nextSubs };
    await localDb.saveChannel(updated);
    setChannels((prev) => prev.map((c) => (c.channelId === channel.channelId ? updated : c)));
  }

  async function handlePublishChannelPost(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedChannelId || !newPostText.trim()) return;
    const post = {
      postId: `post_${crypto.randomUUID()}`,
      authorUserId: currentUser.userId,
      authorUsername: currentUser.username,
      authorDisplayName: currentUser.displayName,
      text: newPostText.trim().slice(0, 2000),
      reactions: { '⚡': [], '💜': [], '👍': [] },
      createdAt: Date.now(),
    };
    const updated = await localDb.publishChannelPost(selectedChannelId, post);
    if (updated) {
      setChannels((prev) => prev.map((c) => (c.channelId === selectedChannelId ? updated : c)));
    }
    setNewPostText('');
  }

  async function handleReactChannelPost(channelId: string, postId: string, emoji: string) {
    const ch = channels.find((c) => c.channelId === channelId);
    if (!ch) return;
    const updated: ChannelItem = {
      ...ch,
      posts: ch.posts.map((p) => {
        if (p.postId !== postId) return p;
        const list = p.reactions[emoji] || [];
        const nextList = list.includes(currentUser.userId)
          ? list.filter((id) => id !== currentUser.userId)
          : [...list, currentUser.userId];
        return { ...p, reactions: { ...p.reactions, [emoji]: nextList } };
      }),
    };
    await localDb.saveChannel(updated);
    setChannels((prev) => prev.map((c) => (c.channelId === channelId ? updated : c)));
  }

  const visibleStories = stories.filter((s) => !s.muted && s.expiresAt > Date.now());
  const selectedChannel = channels.find((c) => c.channelId === selectedChannelId) || null;
  const filteredChannels = channels.filter(
    (c) => !channelSearch.trim() || c.name.toLowerCase().includes(channelSearch.toLowerCase()),
  );

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-[#F4F7FC] dark:bg-[#05070D]" style={storiesShellStyle}>
      <header className="px-6 py-4 border-b border-slate-200 dark:border-white/10 bg-white dark:bg-[#0C1222] flex flex-wrap items-center justify-between gap-4" style={storiesCardStyle}>
        <div className="flex items-center gap-2 p-1 rounded-xl bg-slate-100 dark:bg-[#05070D]">
          <button
            type="button"
            onClick={() => setSubTab('stories')}
            className={`px-4 py-2 rounded-lg text-xs font-semibold transition-colors ${
              subTab === 'stories'
                ? 'bg-white dark:bg-[#141E36] text-slate-900 dark:text-[#00E5FF] shadow-xs'
                : 'text-slate-500 dark:text-[#9AA8C7]'
            }`}
          >
            {t.storiesTitle}
          </button>
          <button
            type="button"
            onClick={() => setSubTab('channels')}
            className={`px-4 py-2 rounded-lg text-xs font-semibold transition-colors ${
              subTab === 'channels'
                ? 'bg-white dark:bg-[#141E36] text-slate-900 dark:text-[#00E5FF] shadow-xs'
                : 'text-slate-500 dark:text-[#9AA8C7]'
            }`}
          >
            {t.channelsTitle}
          </button>
        </div>

        {subTab === 'stories' ? (
          <button
            type="button"
            onClick={() => setShowStudio(true)}
            className="min-h-[40px] px-4 rounded-xl bg-cyan-600 dark:bg-[#00E5FF] text-white dark:text-[#041018] text-xs font-semibold flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            <span>{t.createStoryBtn}</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setShowCreateChannel(true)}
            className="min-h-[40px] px-4 rounded-xl bg-cyan-600 dark:bg-[#00E5FF] text-white dark:text-[#041018] text-xs font-semibold flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            <span>{t.createChannelBtn}</span>
          </button>
        )}
      </header>

      {subTab === 'stories' ? (
        <div className="flex-1 overflow-y-auto p-6 max-w-6xl w-full mx-auto space-y-8">
          <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {visibleStories.map((slide) => (
              <div
                key={slide.storyId}
                onClick={() => setActiveStory(slide)}
                className="cursor-pointer rounded-2xl overflow-hidden border border-slate-200 dark:border-white/10 bg-white dark:bg-[#0C1222] hover:border-cyan-500 transition-colors flex flex-col"
              >
                <div
                  className="h-56 relative flex items-center justify-center p-5 text-center"
                  style={{ backgroundColor: slide.bgColor || '#0C1222' }}
                >
                  {slide.kind === 'image' && slide.mediaDataUrl && (
                    <img
                      src={slide.mediaDataUrl}
                      alt={slide.text || 'Story slide'}
                      className="absolute inset-0 w-full h-full object-cover"
                      style={{ filter: slide.filterCss }}
                    />
                  )}
                  <div className="relative z-10 bg-black/40 backdrop-blur-xs px-4 py-2 rounded-xl text-white">
                    {slide.sticker && <div className="text-3xl mb-1">{slide.sticker}</div>}
                    <p className="text-sm font-medium">{slide.overlayText || slide.text}</p>
                  </div>
                </div>
                <div className="p-4 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div
                      className="w-8 h-8 rounded-xl flex items-center justify-center font-bold text-[#041018] shrink-0"
                      style={{ backgroundColor: slide.authorColor }}
                    >
                      {slide.authorEmoji}
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{slide.authorName}</div>
                      <div className="text-[11px] text-slate-500 font-mono-tabular">
                        {formatLocalizedTime(slide.createdAt, language)}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    {slide.allowDownload && slide.mediaDataUrl && (
                      <a
                        href={slide.mediaDataUrl}
                        download={`story_${slide.storyId}.jpg`}
                        onClick={(e) => e.stopPropagation()}
                        title="Download permitted by author"
                        className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-white/10"
                      >
                        <Download className="w-4 h-4 text-cyan-500" />
                      </a>
                    )}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onMuteStory(slide.storyId);
                      }}
                      title="Mute story"
                      className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-white/10 text-slate-400"
                    >
                      <VolumeX className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </section>
        </div>
      ) : (
        <div className="flex-1 flex overflow-hidden">
          <aside className="w-full md:w-80 border-e border-slate-200 dark:border-white/10 bg-white dark:bg-[#080C18] flex flex-col">
            <div className="p-4 border-b border-slate-200 dark:border-white/10 space-y-3">
              <p className="text-xs text-slate-500 dark:text-[#9AA8C7] leading-relaxed">
                {t.channelArchitectureNote}
              </p>
              <input
                type="text"
                value={channelSearch}
                onChange={(e) => setChannelSearch(e.target.value)}
                placeholder={language === 'ar' ? 'ابحث في القنوات والمجتمعات...' : 'Search channels & communities...'}
                className="w-full min-h-[40px] px-3.5 rounded-xl bg-slate-100 dark:bg-[#0C1222] text-xs focus:outline-none"
              />
            </div>
            <div className="flex-1 overflow-y-auto divide-y divide-slate-100 dark:divide-white/5">
              {filteredChannels.map((ch) => (
                <button
                  key={ch.channelId}
                  type="button"
                  onClick={() => setSelectedChannelId(ch.channelId)}
                  className={`w-full p-4 text-start hover:bg-slate-50 dark:hover:bg-white/5 ${
                    selectedChannelId === ch.channelId ? 'bg-cyan-500/10' : ''
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-sm flex items-center gap-1.5">
                      {ch.kind === 'community' ? <Layers className="w-4 h-4 text-violet-400" /> : <Megaphone className="w-4 h-4 text-cyan-500" />}
                      {ch.name}
                    </span>
                    {!ch.isPublic && <Lock className="w-3.5 h-3.5 text-slate-400" />}
                  </div>
                  <p className="text-xs text-slate-500 dark:text-[#9AA8C7] line-clamp-2 mt-1">{ch.description}</p>
                  <div className="text-[11px] text-slate-400 mt-1.5 font-mono-tabular">
                    {ch.subscriberUserIds.length} {language === 'ar' ? 'مشترك' : 'subscribers'} · {ch.posts.length} {language === 'ar' ? 'منشور' : 'posts'}
                  </div>
                </button>
              ))}
            </div>
          </aside>

          <section className="flex-1 flex flex-col overflow-hidden">
            {selectedChannel ? (
              <>
                <div className="p-5 border-b border-slate-200 dark:border-white/10 bg-white dark:bg-[#0C1222] flex items-center justify-between gap-4">
                  <div>
                    <h3 className="font-display text-lg font-bold">{selectedChannel.name}</h3>
                    <p className="text-xs text-slate-500 dark:text-[#9AA8C7]">{selectedChannel.description}</p>
                    {selectedChannel.memberGroupNames.length > 0 && (
                      <p className="text-xs text-cyan-600 dark:text-[#00E5FF] mt-1">
                        {language === 'ar' ? 'المجموعات المرتبطة: ' : 'Linked Groups: '}
                        {selectedChannel.memberGroupNames.join(' · ')}
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => handleToggleSubscribe(selectedChannel)}
                    className={`min-h-[40px] px-4 rounded-xl text-xs font-semibold border ${
                      selectedChannel.subscriberUserIds.includes(currentUser.userId)
                        ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                        : 'border-cyan-500 bg-cyan-600 text-white'
                    }`}
                  >
                    {selectedChannel.subscriberUserIds.includes(currentUser.userId) ? t.subscribed : t.subscribe}
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto p-6 space-y-4 max-w-3xl w-full mx-auto">
                  {selectedChannel.posts.map((post) => (
                    <article
                      key={post.postId}
                      className="p-5 rounded-2xl bg-white dark:bg-[#0C1222] border border-slate-200 dark:border-white/10 space-y-3"
                    >
                      <div className="flex items-center justify-between text-xs text-slate-500">
                        <span className="font-semibold text-slate-900 dark:text-white">
                          {post.authorDisplayName} (@{post.authorUsername})
                        </span>
                        <span className="font-mono-tabular">{formatLocalizedTime(post.createdAt, language)}</span>
                      </div>
                      <p className="text-sm leading-relaxed whitespace-pre-wrap">{post.text}</p>
                      <div className="flex items-center gap-2 pt-1">
                        {Object.entries(post.reactions).map(([em, uids]) => (
                          <button
                            key={em}
                            type="button"
                            onClick={() => handleReactChannelPost(selectedChannel.channelId, post.postId, em)}
                            className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-white/5 text-xs hover:bg-cyan-500/15"
                          >
                            {em} {uids.length}
                          </button>
                        ))}
                      </div>
                    </article>
                  ))}
                </div>

                {selectedChannel.adminUserIds.includes(currentUser.userId) && (
                  <form
                    onSubmit={handlePublishChannelPost}
                    className="p-4 border-t border-slate-200 dark:border-white/10 bg-white dark:bg-[#0C1222] flex gap-2"
                  >
                    <input
                      type="text"
                      value={newPostText}
                      onChange={(e) => setNewPostText(e.target.value)}
                      placeholder={t.publishPost}
                      className="flex-1 min-h-[44px] px-4 rounded-xl bg-slate-100 dark:bg-[#05070D] text-sm focus:outline-none"
                    />
                    <button
                      type="submit"
                      className="min-h-[44px] px-5 rounded-xl bg-cyan-600 dark:bg-[#00E5FF] text-white dark:text-[#041018] text-xs font-semibold"
                    >
                      <Send className="w-4 h-4" />
                    </button>
                  </form>
                )}
              </>
            ) : null}
          </section>
        </div>
      )}

      {/* Modal: Smart Stories & Media Studio */}
      {showStudio && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="max-w-lg w-full bg-white dark:bg-[#0C1222] border border-slate-200 dark:border-white/15 rounded-2xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg font-semibold">
                {language === 'ar' ? 'استوديو القصص والوسائط المحلي' : 'Local Stories & Media Studio'}
              </h3>
              <button type="button" onClick={() => setShowStudio(false)}>
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2 p-1 rounded-xl bg-slate-100 dark:bg-[#05070D]">
              <button
                type="button"
                onClick={() => setStudioKind('text')}
                className={`py-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 ${
                  studioKind === 'text' ? 'bg-white dark:bg-[#141E36] text-cyan-500' : ''
                }`}
              >
                <Type className="w-3.5 h-3.5" />
                <span>{language === 'ar' ? 'قصة نصية' : 'Text Template'}</span>
              </button>
              <button
                type="button"
                onClick={() => setStudioKind('image')}
                className={`py-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 ${
                  studioKind === 'image' ? 'bg-white dark:bg-[#141E36] text-cyan-500' : ''
                }`}
              >
                <ImageIcon className="w-3.5 h-3.5" />
                <span>{language === 'ar' ? 'محرر الصور والرسم' : 'Image & Draw'}</span>
              </button>
            </div>

            {studioKind === 'image' && (
              <div className="space-y-2">
                <div className="relative h-48 rounded-xl overflow-hidden border border-slate-200 dark:border-white/10">
                  <img
                    src={studioImageUrl}
                    alt="Studio preview"
                    className="w-full h-full object-cover"
                    style={{ filter: studioFilter }}
                  />
                  <canvas
                    ref={canvasRef}
                    width={480}
                    height={240}
                    onPointerDown={handleCanvasDrawStart}
                    onPointerMove={handleCanvasDrawMove}
                    onPointerUp={handleCanvasDrawEnd}
                    className="absolute inset-0 w-full h-full touch-none cursor-crosshair"
                  />
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <label className="px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-white/10 cursor-pointer">
                    {language === 'ar' ? 'رفع صورة' : 'Upload Image'}
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (!f) return;
                        const r = new FileReader();
                        r.onload = () => setStudioImageUrl(r.result as string);
                        r.readAsDataURL(f);
                      }}
                    />
                  </label>
                  {(['none', 'contrast(1.2) saturate(1.2)', 'grayscale(1)', 'sepia(0.5)'] as const).map((f, idx) => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => setStudioFilter(f)}
                      className={`px-2.5 py-1 rounded-lg border text-xs ${
                        studioFilter === f ? 'border-cyan-500 text-cyan-500' : 'border-slate-200 dark:border-white/10'
                      }`}
                    >
                      {['Original', 'Vivid', 'Mono', 'Warm'][idx]}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <textarea
              rows={2}
              value={studioKind === 'text' ? studioText : studioOverlay}
              onChange={(e) => (studioKind === 'text' ? setStudioText(e.target.value) : setStudioOverlay(e.target.value))}
              placeholder={language === 'ar' ? 'أضف نصاً أو تعليقاً...' : 'Write caption or overlay text...'}
              className="w-full p-3 rounded-xl bg-slate-100 dark:bg-[#05070D] text-sm focus:outline-none"
            />

            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                {STORY_BG_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setStudioBg(c)}
                    className={`w-6 h-6 rounded-full border-2 ${studioBg === c ? 'border-cyan-400' : 'border-transparent'}`}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
              <div className="flex items-center gap-1">
                {STICKERS.map((st) => (
                  <button
                    key={st}
                    type="button"
                    onClick={() => setStudioSticker((prev) => (prev === st ? '' : st))}
                    className={`w-7 h-7 rounded-lg text-sm ${studioSticker === st ? 'bg-cyan-500/20' : ''}`}
                  >
                    {st}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2 text-xs">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={allowDownload}
                  onChange={(e) => setAllowDownload(e.target.checked)}
                />
                <span>{language === 'ar' ? 'السماح بتنزيل الوسائط' : 'Allow downloading story media'}</span>
              </label>

              <div className="flex items-center gap-3">
                <Eye className="w-4 h-4 text-cyan-500" />
                <select
                  value={privacyMode}
                  onChange={(e) => setPrivacyMode(e.target.value as 'all' | 'custom')}
                  className="px-2.5 py-1.5 rounded-lg bg-slate-100 dark:bg-[#05070D]"
                >
                  <option value="all">{language === 'ar' ? 'محفوظ محلياً' : 'Local Only'}</option>
                  <option value="custom">{language === 'ar' ? 'قائمة مخصصة' : 'Custom List'}</option>
                </select>
              </div>
            </div>

            <button
              type="button"
              onClick={handlePublishStory}
              className="w-full min-h-[44px] rounded-xl bg-cyan-600 dark:bg-[#00E5FF] text-white dark:text-[#041018] text-sm font-semibold"
            >
              {t.createStoryBtn}
            </button>
          </div>
        </div>
      )}

      {/* Modal: Story Viewer */}
      {activeStory && (
        <div className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-4">
          <div className="max-w-md w-full rounded-3xl overflow-hidden bg-[#0C1222] border border-white/15 text-white">
            <div className="p-4 flex items-center justify-between border-b border-white/10">
              <span className="font-semibold text-sm">{activeStory.authorName}</span>
              <button type="button" onClick={() => setActiveStory(null)}>
                <X className="w-5 h-5" />
              </button>
            </div>
            <div
              className="h-80 relative flex items-center justify-center p-6 text-center"
              style={{ backgroundColor: activeStory.bgColor || '#0C1222' }}
            >
              {activeStory.kind === 'image' && activeStory.mediaDataUrl && (
                <img
                  src={activeStory.mediaDataUrl}
                  alt="Story"
                  className="absolute inset-0 w-full h-full object-cover"
                  style={{ filter: activeStory.filterCss }}
                />
              )}
              <div className="relative z-10 bg-black/45 px-4 py-3 rounded-xl">
                {activeStory.sticker && <div className="text-4xl mb-2">{activeStory.sticker}</div>}
                <p className="text-base">{activeStory.overlayText || activeStory.text}</p>
              </div>
            </div>
            <div className="p-4 space-y-3">
              <div className="flex items-center gap-2">
                {['❤️', '🔥', '⚡'].map((em) => (
                  <button
                    key={em}
                    type="button"
                    onClick={() => onReactStory(activeStory.storyId, em)}
                    className="px-3 py-1.5 rounded-lg bg-white/10 text-xs hover:bg-white/20"
                  >
                    {em}
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={storyReplyText}
                  onChange={(e) => setStoryReplyText(e.target.value)}
                  placeholder={language === 'ar' ? 'رد على القصة...' : 'Reply to story...'}
                  className="flex-1 min-h-[40px] px-3 rounded-xl bg-white/10 text-sm focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => {
                    if (!storyReplyText.trim()) return;
                    onReplyStoryToChat(activeStory.authorId, storyReplyText.trim());
                    setStoryReplyText('');
                    setActiveStory(null);
                  }}
                  className="px-4 rounded-xl bg-[#00E5FF] text-[#041018] text-xs font-semibold"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Create Channel / Community */}
      {showCreateChannel && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <form
            onSubmit={handleCreateChannel}
            className="max-w-md w-full bg-white dark:bg-[#0C1222] border border-slate-200 dark:border-white/15 rounded-2xl p-6 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg font-semibold">{t.createChannelBtn}</h3>
              <button type="button" onClick={() => setShowCreateChannel(false)}>
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setNewChKind('channel')}
                className={`py-2 rounded-xl text-xs font-semibold border ${
                  newChKind === 'channel' ? 'border-cyan-500 bg-cyan-500/10' : 'border-slate-200 dark:border-white/10'
                }`}
              >
                {language === 'ar' ? 'قناة محلية' : 'Local Channel'}
              </button>
              <button
                type="button"
                onClick={() => setNewChKind('community')}
                className={`py-2 rounded-xl text-xs font-semibold border ${
                  newChKind === 'community' ? 'border-cyan-500 bg-cyan-500/10' : 'border-slate-200 dark:border-white/10'
                }`}
              >
                {language === 'ar' ? 'مجتمع محلي' : 'Local Community'}
              </button>
            </div>
            <input
              type="text"
              required
              value={newChName}
              onChange={(e) => setNewChName(e.target.value)}
              placeholder={language === 'ar' ? 'الاسم' : 'Channel / Community Name'}
              className="w-full min-h-[42px] px-3.5 rounded-xl bg-slate-100 dark:bg-[#05070D] text-sm"
            />
            <textarea
              rows={2}
              value={newChDesc}
              onChange={(e) => setNewChDesc(e.target.value)}
              placeholder={language === 'ar' ? 'الوصف' : 'Description'}
              className="w-full p-3.5 rounded-xl bg-slate-100 dark:bg-[#05070D] text-sm"
            />
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={newChPublic} onChange={(e) => setNewChPublic(e.target.checked)} />
              <span>{language === 'ar' ? 'مرئي لجميع الحسابات المحلية' : 'Visible to local accounts'}</span>
            </label>
            <button
              type="submit"
              className="w-full min-h-[44px] rounded-xl bg-cyan-600 dark:bg-[#00E5FF] text-white dark:text-[#041018] text-sm font-semibold"
            >
              {t.createChannelBtn}
            </button>
          </form>
        </div>
      )}
    </div>
  );
};
