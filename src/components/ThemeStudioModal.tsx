import React, { useEffect, useRef, useState } from 'react';
import {
  ArchiveRestore,
  Bell,
  Check,
  Copy,
  Download,
  Eye,
  Image as ImageIcon,
  Layers,
  MessageSquare,
  Minimize2,
  Palette,
  Phone,
  Pipette,
  Radio,
  Redo2,
  RotateCcw,
  Save,
  Settings as SettingsIcon,
  Sliders,
  Sparkles,
  Trash2,
  Type,
  Undo2,
  Upload,
  Users,
  X,
} from 'lucide-react';
import {
  AppLanguage,
  Conversation,
  CustomizationConfig,
  DeletedThemeBackup,
  PageThemeOverride,
  SavedThemePreset,
  ShadowLevel,
  StudioFontFamily,
  StudioPageKey,
} from '../types/charisma';
import { TRANSLATIONS, formatLocalizedDate } from '../i18n/translations';
import { localDb } from '../storage/localDb';
import {
  BUILTIN_THEME_PRESETS,
  DEFAULT_CUSTOMIZATION_CONFIG,
  EMPTY_PAGE_OVERRIDE,
  STUDIO_PAGE_KEYS,
  extractPaletteFromImageDataUrl,
  getBubbleCornerStyle,
  getFontStack,
  getPageCardStyle,
  getPageShellStyle,
  getShadowCss,
  hexToRgba,
  normalizeCustomization,
  parseImportedThemeJson,
  resizeGalleryImageToDataUrl,
} from '../utils/themeEngine';
import { ColorWheelPicker } from './ColorWheelPicker';

interface ThemeStudioModalProps {
  language: AppLanguage;
  userId: string;
  activeCustomization: CustomizationConfig;
  conversations: Conversation[];
  savedThemes: SavedThemePreset[];
  onRefreshThemes: () => Promise<void>;
  onLivePreviewChange: (cfg: CustomizationConfig) => void;
  onApplyCustomization: (cfg: CustomizationConfig) => void;
  onAssignChatTheme: (convId: string, themeId: string | undefined) => void;
  onTriggerTestNotification: (overrideCfg?: CustomizationConfig) => void;
  onCloseRestoreOriginal: () => void;
}

type StudioTab = 'look' | 'colors' | 'components' | 'pages' | 'library';
type ColorTarget =
  | 'primaryAccent'
  | 'secondaryAccent'
  | 'outgoingBubbleColor'
  | 'incomingBubbleColor'
  | 'pageBg'
  | 'pageSurface'
  | 'pageAccent'
  | 'pageText'
  | 'pageGradFrom'
  | 'pageGradTo';

const PAGE_LABELS: Record<StudioPageKey, { en: string; ar: string; icon: React.ComponentType<{ className?: string }> }> = {
  home: { en: 'Home Shell & Nav', ar: 'الصفحة الرئيسية', icon: Layers },
  chatsList: { en: 'Chats List', ar: 'قائمة المحادثات', icon: MessageSquare },
  chatScreen: { en: 'Chat Screen', ar: 'شاشة المحادثة', icon: Sparkles },
  calls: { en: 'Calls Page', ar: 'صفحة المكالمات', icon: Phone },
  stories: { en: 'Stories & Status', ar: 'صفحة القصص والحالات', icon: Radio },
  contacts: { en: 'Contacts Page', ar: 'صفحة جهات الاتصال', icon: Users },
  settings: { en: 'Settings Modal', ar: 'الإعدادات', icon: SettingsIcon },
  notifications: { en: 'In-App Notifications', ar: 'الإشعارات داخل التطبيق', icon: Bell },
};

export const ThemeStudioModal: React.FC<ThemeStudioModalProps> = ({
  language,
  userId,
  activeCustomization,
  conversations,
  savedThemes,
  onRefreshThemes,
  onLivePreviewChange,
  onApplyCustomization,
  onAssignChatTheme,
  onTriggerTestNotification,
  onCloseRestoreOriginal,
}) => {
  const t = TRANSLATIONS[language];
  const isAr = language === 'ar';

  // History Stack for Undo / Redo
  const [draft, setDraft] = useState<CustomizationConfig>(() => normalizeCustomization(activeCustomization));
  const [past, setPast] = useState<CustomizationConfig[]>([]);
  const [future, setFuture] = useState<CustomizationConfig[]>([]);
  const [draftNotice, setDraftNotice] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  // Studio UI navigation & preview state
  const [studioTab, setStudioTab] = useState<StudioTab>('look');
  const [previewPage, setPreviewPage] = useState<StudioPageKey>('chatScreen');
  const [floatingPreviewMode, setFloatingPreviewMode] = useState(false);
  const [mobileShowPreview, setMobileShowPreview] = useState(false);

  // Color designer state
  const [colorTarget, setColorTarget] = useState<ColorTarget>('primaryAccent');
  const [extractedPalette, setExtractedPalette] = useState<string[]>([]);
  const [extractingPalette, setExtractingPalette] = useState(false);

  // Library & Trash backups
  const [newThemeName, setNewThemeName] = useState('');
  const [newThemeDesc, setNewThemeDesc] = useState('');
  const [deletedBackups, setDeletedBackups] = useState<DeletedThemeBackup[]>([]);

  const wallpaperFileRef = useRef<HTMLInputElement | null>(null);
  const pageWallpaperFileRef = useRef<HTMLInputElement | null>(null);
  const paletteImageRef = useRef<HTMLInputElement | null>(null);
  const importThemeRef = useRef<HTMLInputElement | null>(null);

  // Check if a saved auto-draft exists locally
  useEffect(() => {
    (async () => {
      const [existingDraft, trash] = await Promise.all([
        localDb.getThemeDraft(userId),
        localDb.listDeletedThemeBackups(userId),
      ]);
      setDeletedBackups(trash);
      if (existingDraft) {
        setDraft(existingDraft.config);
        onLivePreviewChange(existingDraft.config);
        setDraftNotice(
          isAr
            ? `تمت استعادة مسودة غير مطبقة (${formatLocalizedDate(existingDraft.savedAt, language)})`
            : `Restored unsaved local draft (${formatLocalizedDate(existingDraft.savedAt, language)})`,
        );
      }
    })();
  }, [userId]);

  // Auto-save draft locally + propagate live preview immediately
  useEffect(() => {
    onLivePreviewChange(draft);
    const timer = window.setTimeout(() => {
      localDb.setThemeDraft(userId, draft).catch(() => {});
    }, 220);
    return () => window.clearTimeout(timer);
  }, [draft, userId, onLivePreviewChange]);

  function commitDraftUpdate(updater: (prev: CustomizationConfig) => CustomizationConfig) {
    setDraft((prev) => {
      const next = normalizeCustomization(updater(prev));
      setPast((p) => [...p.slice(-39), prev]);
      setFuture([]);
      return next;
    });
  }

  function handleUndo() {
    if (past.length === 0) return;
    const previous = past[past.length - 1];
    setPast((p) => p.slice(0, -1));
    setFuture((f) => [draft, ...f]);
    setDraft(previous);
  }

  function handleRedo() {
    if (future.length === 0) return;
    const next = future[0];
    setFuture((f) => f.slice(1));
    setPast((p) => [...p, draft]);
    setDraft(next);
  }

  function updatePageOverride(pageKey: StudioPageKey, patch: Partial<PageThemeOverride>) {
    commitDraftUpdate((prev) => ({
      ...prev,
      pageThemes: {
        ...prev.pageThemes,
        [pageKey]: {
          ...prev.pageThemes[pageKey],
          ...patch,
        },
      },
    }));
  }

  function getActiveTargetColor(): string {
    const pageOv = draft.pageThemes[previewPage];
    switch (colorTarget) {
      case 'primaryAccent':
        return draft.primaryAccent;
      case 'secondaryAccent':
        return draft.secondaryAccent;
      case 'outgoingBubbleColor':
        return draft.outgoingBubbleColor;
      case 'incomingBubbleColor':
        return draft.incomingBubbleColor;
      case 'pageBg':
        return pageOv.backgroundColor || '#05070D';
      case 'pageSurface':
        return pageOv.surfaceColor || '#0C1222';
      case 'pageAccent':
        return pageOv.accentColor || draft.primaryAccent;
      case 'pageText':
        return pageOv.textColor || '#F2F6FF';
      case 'pageGradFrom':
        return pageOv.gradientFrom || '#0C1222';
      case 'pageGradTo':
        return pageOv.gradientTo || '#1A103D';
    }
  }

  function setActiveTargetColor(hex: string) {
    switch (colorTarget) {
      case 'primaryAccent':
      case 'secondaryAccent':
      case 'outgoingBubbleColor':
      case 'incomingBubbleColor':
        commitDraftUpdate((prev) => ({ ...prev, [colorTarget]: hex }));
        break;
      case 'pageBg':
        updatePageOverride(previewPage, { enabled: true, backgroundColor: hex });
        break;
      case 'pageSurface':
        updatePageOverride(previewPage, { enabled: true, surfaceColor: hex });
        break;
      case 'pageAccent':
        updatePageOverride(previewPage, { enabled: true, accentColor: hex });
        break;
      case 'pageText':
        updatePageOverride(previewPage, { enabled: true, textColor: hex });
        break;
      case 'pageGradFrom':
        updatePageOverride(previewPage, { enabled: true, useGradient: true, gradientFrom: hex });
        break;
      case 'pageGradTo':
        updatePageOverride(previewPage, { enabled: true, useGradient: true, gradientTo: hex });
        break;
    }
  }

  async function handleUploadWallpaper(e: React.ChangeEvent<HTMLInputElement>, forPage?: StudioPageKey) {
    const file = e.target.files?.[0];
    if (!file) return;
    setErrorMsg(null);
    try {
      const dataUrl = await resizeGalleryImageToDataUrl(file, 1440);
      if (forPage) {
        updatePageOverride(forPage, { enabled: true, wallpaperDataUrl: dataUrl });
      } else {
        commitDraftUpdate((prev) => ({
          ...prev,
          wallpaper: 'custom_image',
          customWallpaperDataUrl: dataUrl,
        }));
      }
      setStatusMsg(isAr ? 'تم تطبيق الخلفية من المعرض محلياً' : 'Gallery wallpaper applied locally');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to load image');
    }
    e.target.value = '';
  }

  async function handleExtractPalette(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setExtractingPalette(true);
    setErrorMsg(null);
    try {
      const dataUrl = await resizeGalleryImageToDataUrl(file, 480);
      const colors = await extractPaletteFromImageDataUrl(dataUrl, 6);
      setExtractedPalette(colors);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not extract palette');
    } finally {
      setExtractingPalette(false);
    }
    e.target.value = '';
  }

  function handleApplyExtractedPalette() {
    if (extractedPalette.length < 2) return;
    commitDraftUpdate((prev) => ({
      ...prev,
      primaryAccent: extractedPalette[0],
      secondaryAccent: extractedPalette[1],
      outgoingBubbleColor: extractedPalette[2] || prev.outgoingBubbleColor,
      incomingBubbleColor: extractedPalette[3] || prev.incomingBubbleColor,
      favoriteColors: Array.from(new Set([...extractedPalette, ...prev.favoriteColors])).slice(0, 24),
    }));
    setStatusMsg(isAr ? 'تم تطبيق لوحة الألوان المستخرجة على الثيم' : 'Extracted palette applied to theme');
  }

  async function handleSaveNewPreset(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = newThemeName.trim();
    if (!trimmed) return;
    const now = Date.now();
    const preset: SavedThemePreset = {
      themeId: `thm_${crypto.randomUUID()}`,
      ownerUserId: userId,
      name: trimmed.slice(0, 60),
      description: newThemeDesc.trim().slice(0, 140) || undefined,
      config: normalizeCustomization(draft),
      createdAt: now,
      updatedAt: now,
    };
    await localDb.saveThemePreset(preset);
    await onRefreshThemes();
    setNewThemeName('');
    setNewThemeDesc('');
    setStatusMsg(isAr ? `تم حفظ الثيم "${preset.name}" محلياً` : `Saved theme "${preset.name}" locally`);
  }

  async function handleDuplicatePreset(preset: { name: string; description?: string; config: CustomizationConfig }) {
    const now = Date.now();
    const copyName = isAr ? `${preset.name} (نسخة)` : `${preset.name} (Copy)`;
    const copied: SavedThemePreset = {
      themeId: `thm_${crypto.randomUUID()}`,
      ownerUserId: userId,
      name: copyName.slice(0, 60),
      description: preset.description,
      config: normalizeCustomization(preset.config),
      createdAt: now,
      updatedAt: now,
    };
    await localDb.saveThemePreset(copied);
    await onRefreshThemes();
    commitDraftUpdate(() => copied.config);
    setStudioTab('look');
    setStatusMsg(isAr ? `تم نسخ "${copied.name}" وفتحه للتعديل` : `Duplicated "${copied.name}" and loaded into editor`);
  }

  function handleExportPreset(preset: { name: string; description?: string; config: CustomizationConfig }) {
    const payload = {
      format: 'charisma-theme-v1',
      exportedAt: Date.now(),
      name: preset.name,
      description: preset.description,
      config: preset.config,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${preset.name.replace(/[^a-z0-9\u0600-\u06FF_-]+/gi, '_')}.charisma-theme.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleImportThemeFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setErrorMsg(null);
    try {
      const text = await file.text();
      const imported = parseImportedThemeJson(text);
      const now = Date.now();
      const preset: SavedThemePreset = {
        themeId: `thm_${crypto.randomUUID()}`,
        ownerUserId: userId,
        name: imported.name,
        description: imported.description,
        config: imported.config,
        createdAt: now,
        updatedAt: now,
      };
      await localDb.saveThemePreset(preset);
      await onRefreshThemes();
      commitDraftUpdate(() => preset.config);
      setStatusMsg(isAr ? `تم استيراد الثيم "${preset.name}"` : `Imported theme "${preset.name}"`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Invalid theme file');
    }
    e.target.value = '';
  }

  async function handleDeletePreset(themeId: string) {
    const backup = await localDb.deleteThemePresetWithBackup(themeId);
    await onRefreshThemes();
    if (backup) {
      setDeletedBackups(await localDb.listDeletedThemeBackups(userId));
      setStatusMsg(
        isAr
          ? 'تم حذف الثيم مع حفظ نسخة احتياطية محلية للاستعادة'
          : 'Theme deleted; local recovery backup created',
      );
    }
  }

  async function handleRestoreBackup(backupId: string) {
    const restored = await localDb.restoreDeletedTheme(backupId);
    await onRefreshThemes();
    setDeletedBackups(await localDb.listDeletedThemeBackups(userId));
    if (restored) {
      setStatusMsg(isAr ? `تمت استعادة الثيم "${restored.name}"` : `Restored "${restored.name}"`);
    }
  }

  async function handlePurgeBackup(backupId: string) {
    await localDb.purgeDeletedThemeBackup(backupId);
    setDeletedBackups(await localDb.listDeletedThemeBackups(userId));
  }

  async function handleApplyAndSave() {
    await localDb.setThemeDraft(userId, null);
    onApplyCustomization(draft);
  }

  async function handleDiscardAndClose() {
    await localDb.setThemeDraft(userId, null);
    onCloseRestoreOriginal();
  }

  function handleResetToOriginal() {
    commitDraftUpdate(() => normalizeCustomization(DEFAULT_CUSTOMIZATION_CONFIG));
    setStatusMsg(isAr ? 'تمت إعادة الضبط إلى التصميم الأصلي' : 'Reset to original CHARISMA design');
  }

  // Live floating preview bar over the real running app
  if (floatingPreviewMode) {
    return (
      <div className="fixed bottom-4 inset-x-4 z-50 flex justify-center pointer-events-none">
        <div
          data-studio-fixed
          className="pointer-events-auto max-w-2xl w-full rounded-2xl bg-[#080C18]/95 text-[#F2F6FF] border border-cyan-400/40 shadow-2xl px-4 py-3 flex flex-wrap items-center justify-between gap-3 backdrop-blur-md"
        >
          <div className="flex items-center gap-2.5">
            <Eye className="w-4 h-4 text-[#00E5FF]" />
            <div className="text-xs">
              <div className="font-semibold">{isAr ? 'وضع المعاينة المباشرة على التطبيق' : 'Live App Preview Mode'}</div>
              <div className="text-[11px] text-slate-400">
                {isAr ? 'تصفح الصفحات الآن ثم طبّق التعديلات أو عُد للاستوديو' : 'Navigate pages live, then apply changes or return to studio'}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleUndo}
              disabled={past.length === 0}
              className="min-h-[38px] px-3 rounded-xl border border-white/15 text-xs disabled:opacity-40"
            >
              <Undo2 className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => setFloatingPreviewMode(false)}
              className="min-h-[38px] px-3.5 rounded-xl border border-white/15 text-xs font-semibold flex items-center gap-1.5"
            >
              <Sliders className="w-3.5 h-3.5" />
              <span>{t.exitLivePreviewBtn}</span>
            </button>
            <button
              type="button"
              onClick={handleApplyAndSave}
              className="min-h-[38px] px-4 rounded-xl bg-[#00E5FF] text-[#041018] text-xs font-semibold flex items-center gap-1.5"
            >
              <Check className="w-3.5 h-3.5" />
              <span>{t.applyChangesBtn}</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  const activePageOv = draft.pageThemes[previewPage];
  const buttonStyleRadius =
    draft.buttonStyle === 'pill' ? '9999px' : draft.buttonStyle === 'sharp' ? '4px' : '12px';

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4">
      <div className="w-full max-w-7xl h-[94vh] bg-white dark:bg-[#080C18] text-slate-900 dark:text-[#F2F6FF] border border-slate-200 dark:border-white/15 rounded-3xl overflow-hidden flex flex-col shadow-2xl">
        {/* Studio Header */}
        <header className="px-4 sm:px-6 py-3.5 border-b border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#0C1222] flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="min-w-0">
            <h2 className="font-display text-base sm:text-lg font-bold flex items-center gap-2 truncate">
              <Palette className="w-5 h-5 shrink-0" style={{ color: draft.primaryAccent }} />
              <span className="truncate">{t.themeStudioTitle}</span>
            </h2>
            <p className="text-[11px] text-slate-500 dark:text-[#9AA8C7] truncate">
              {draftNotice || t.draftAutoSaved}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
            <button
              type="button"
              onClick={handleUndo}
              disabled={past.length === 0}
              title={t.undoBtn}
              className="min-h-[38px] px-2.5 rounded-xl border border-slate-200 dark:border-white/15 text-xs font-medium flex items-center gap-1 disabled:opacity-40 hover:border-cyan-500"
            >
              <Undo2 className="w-4 h-4" />
              <span className="hidden lg:inline">{t.undoBtn}</span>
            </button>
            <button
              type="button"
              onClick={handleRedo}
              disabled={future.length === 0}
              title={t.redoBtn}
              className="min-h-[38px] px-2.5 rounded-xl border border-slate-200 dark:border-white/15 text-xs font-medium flex items-center gap-1 disabled:opacity-40 hover:border-cyan-500"
            >
              <Redo2 className="w-4 h-4" />
              <span className="hidden lg:inline">{t.redoBtn}</span>
            </button>
            <button
              type="button"
              onClick={handleResetToOriginal}
              title={t.resetOriginalBtn}
              className="min-h-[38px] px-3 rounded-xl border border-slate-200 dark:border-white/15 text-xs font-medium flex items-center gap-1.5 hover:border-amber-500"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span className="hidden xl:inline">{t.resetOriginalBtn}</span>
            </button>
            <button
              type="button"
              onClick={() => setFloatingPreviewMode(true)}
              className="min-h-[38px] px-3 rounded-xl border border-cyan-500/40 bg-cyan-500/10 text-cyan-600 dark:text-[#00E5FF] text-xs font-semibold flex items-center gap-1.5"
            >
              <Minimize2 className="w-3.5 h-3.5" />
              <span>{t.previewLiveAppBtn}</span>
            </button>
            <button
              type="button"
              onClick={handleApplyAndSave}
              className="min-h-[38px] px-4 rounded-xl text-[#041018] text-xs font-semibold flex items-center gap-1.5"
              style={{
                background: draft.gradientEnabled
                  ? `linear-gradient(${draft.gradientAngle}deg, ${draft.primaryAccent}, ${draft.secondaryAccent})`
                  : draft.primaryAccent,
              }}
            >
              <Check className="w-4 h-4" />
              <span>{t.applyChangesBtn}</span>
            </button>
            <button
              type="button"
              onClick={handleDiscardAndClose}
              title={t.cancel}
              className="min-h-[38px] min-w-[38px] rounded-xl border border-slate-200 dark:border-white/15 flex items-center justify-center hover:bg-red-500/10 hover:text-red-500"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* Mobile Inspector / Preview Switcher */}
        <div className="lg:hidden px-4 py-2 border-b border-slate-200 dark:border-white/10 grid grid-cols-2 gap-2 bg-slate-50 dark:bg-[#05070D]">
          <button
            type="button"
            onClick={() => setMobileShowPreview(false)}
            className={`min-h-[36px] rounded-xl text-xs font-semibold ${
              !mobileShowPreview ? 'bg-cyan-600 text-white' : 'text-slate-500'
            }`}
          >
            {isAr ? 'أدوات التصميم' : 'Design Controls'}
          </button>
          <button
            type="button"
            onClick={() => setMobileShowPreview(true)}
            className={`min-h-[36px] rounded-xl text-xs font-semibold ${
              mobileShowPreview ? 'bg-cyan-600 text-white' : 'text-slate-500'
            }`}
          >
            {isAr ? 'المعاينة الحية' : 'Live Preview'}
          </button>
        </div>

        {/* Main Split Studio Workspace */}
        <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
          {/* Left Inspector Panel */}
          <div className={`${mobileShowPreview ? 'hidden lg:flex' : 'flex'} w-full lg:w-[54%] flex-col border-e border-slate-200 dark:border-white/10 overflow-hidden`}>
            {/* Studio Section Tabs */}
            <div className="px-4 py-2.5 border-b border-slate-200 dark:border-white/10 flex items-center gap-1.5 overflow-x-auto bg-white dark:bg-[#080C18] shrink-0">
              {[
                { id: 'look' as const, icon: ImageIcon, label: isAr ? 'المظهر والخلفية' : 'Look & Backdrop' },
                { id: 'colors' as const, icon: Pipette, label: isAr ? 'عجلة الألوان' : 'Color Lab' },
                { id: 'components' as const, icon: Type, label: isAr ? 'الفقاعات والخطوط' : 'Bubbles & Fonts' },
                { id: 'pages' as const, icon: Layers, label: isAr ? 'تخصيص الصفحات (8)' : 'Pages (8)' },
                { id: 'library' as const, icon: Save, label: isAr ? 'إدارة الثيمات' : 'Themes & Chats' },
              ].map((tabItem) => {
                const Icon = tabItem.icon;
                const active = studioTab === tabItem.id;
                return (
                  <button
                    key={tabItem.id}
                    type="button"
                    onClick={() => setStudioTab(tabItem.id)}
                    className={`min-h-[38px] px-3 rounded-xl text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap transition-colors ${
                      active
                        ? 'text-[#041018]'
                        : 'bg-slate-100 dark:bg-[#0C1222] text-slate-600 dark:text-[#9AA8C7]'
                    }`}
                    style={active ? { backgroundColor: draft.primaryAccent } : undefined}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    <span>{tabItem.label}</span>
                  </button>
                );
              })}
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-6">
              {statusMsg && (
                <div className="px-3.5 py-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-500 text-xs flex items-center justify-between">
                  <span>{statusMsg}</span>
                  <button type="button" onClick={() => setStatusMsg(null)}><X className="w-3.5 h-3.5" /></button>
                </div>
              )}
              {errorMsg && (
                <div className="px-3.5 py-2.5 rounded-xl bg-red-500/10 border border-red-500/30 text-red-500 text-xs flex items-center justify-between">
                  <span>{errorMsg}</span>
                  <button type="button" onClick={() => setErrorMsg(null)}><X className="w-3.5 h-3.5" /></button>
                </div>
              )}

              {/* TAB 1: GLOBAL LOOK, WALLPAPER, TRANSPARENCY & SHADOWS */}
              {studioTab === 'look' && (
                <div className="space-y-6">
                  {/* Base Theme Mode */}
                  <section className="space-y-2.5">
                    <div className="flex items-center justify-between">
                      <h3 className="text-xs font-semibold text-slate-500 dark:text-[#9AA8C7]">{t.themeLabel}</h3>
                      <button
                        type="button"
                        onClick={() => commitDraftUpdate((p) => ({ ...p, themeMode: DEFAULT_CUSTOMIZATION_CONFIG.themeMode }))}
                        className="text-[11px] text-cyan-500 hover:underline flex items-center gap-1"
                      >
                        <RotateCcw className="w-3 h-3" /> {isAr ? 'ضبط' : 'Reset'}
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        type="button"
                        onClick={() => commitDraftUpdate((p) => ({ ...p, themeMode: 'dark' }))}
                        className={`min-h-[44px] rounded-xl border text-xs font-semibold ${
                          draft.themeMode === 'dark' ? 'border-cyan-500 bg-cyan-500/10' : 'border-slate-200 dark:border-white/10'
                        }`}
                      >
                        {t.themeDark}
                      </button>
                      <button
                        type="button"
                        onClick={() => commitDraftUpdate((p) => ({ ...p, themeMode: 'light' }))}
                        className={`min-h-[44px] rounded-xl border text-xs font-semibold ${
                          draft.themeMode === 'light' ? 'border-cyan-500 bg-cyan-500/10' : 'border-slate-200 dark:border-white/10'
                        }`}
                      >
                        {t.themeLight}
                      </button>
                    </div>
                  </section>

                  {/* Wallpaper & Gallery Upload */}
                  <section className="space-y-3 pt-4 border-t border-slate-200 dark:border-white/10">
                    <div className="flex items-center justify-between">
                      <h3 className="text-xs font-semibold text-slate-500 dark:text-[#9AA8C7]">
                        {isAr ? 'خلفية التطبيق ومن معرض الجهاز' : 'App Wallpaper & Gallery Upload'}
                      </h3>
                      <button
                        type="button"
                        onClick={() =>
                          commitDraftUpdate((p) => ({
                            ...p,
                            wallpaper: DEFAULT_CUSTOMIZATION_CONFIG.wallpaper,
                            customWallpaperDataUrl: undefined,
                            wallpaperBlur: 0,
                            wallpaperOverlayOpacity: 0.45,
                          }))
                        }
                        className="text-[11px] text-cyan-500 hover:underline flex items-center gap-1"
                      >
                        <RotateCcw className="w-3 h-3" /> {isAr ? 'إعادة ضبط الخلفية' : 'Reset Wallpaper'}
                      </button>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {[
                        { id: 'silk_dark' as const, label: isAr ? 'حرير داكن' : 'Dark Silk' },
                        { id: 'midnight_grid' as const, label: isAr ? 'شبكة ليلية' : 'Midnight Grid' },
                        { id: 'clean_light' as const, label: isAr ? 'صفاء نهاري' : 'Clean Light' },
                        { id: 'gradient' as const, label: isAr ? 'تدرج لوني' : 'Ambient Gradient' },
                        { id: 'default' as const, label: isAr ? 'لون صلب' : 'Solid Canvas' },
                      ].map((wp) => (
                        <button
                          key={wp.id}
                          type="button"
                          onClick={() => commitDraftUpdate((p) => ({ ...p, wallpaper: wp.id }))}
                          className={`min-h-[40px] px-3 rounded-xl border text-xs font-medium ${
                            draft.wallpaper === wp.id ? 'border-cyan-500 bg-cyan-500/10' : 'border-slate-200 dark:border-white/10'
                          }`}
                        >
                          {wp.label}
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() => wallpaperFileRef.current?.click()}
                        className={`min-h-[40px] px-3 rounded-xl border text-xs font-semibold flex items-center justify-center gap-1.5 ${
                          draft.wallpaper === 'custom_image' ? 'border-cyan-500 bg-cyan-500/15 text-cyan-500' : 'border-dashed border-cyan-500/40'
                        }`}
                      >
                        <Upload className="w-3.5 h-3.5" />
                        <span>{isAr ? 'من المعرض' : 'From Gallery'}</span>
                      </button>
                      <input
                        ref={wallpaperFileRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => handleUploadWallpaper(e)}
                      />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                      <label className="space-y-1 text-xs">
                        <div className="flex justify-between">
                          <span>{isAr ? 'ضبابية الخلفية (Blur)' : 'Wallpaper Blur'}</span>
                          <span className="font-mono-tabular">{draft.wallpaperBlur}px</span>
                        </div>
                        <input
                          type="range"
                          min={0}
                          max={20}
                          step={1}
                          value={draft.wallpaperBlur}
                          onChange={(e) => commitDraftUpdate((p) => ({ ...p, wallpaperBlur: Number(e.target.value) }))}
                          className="w-full"
                        />
                      </label>
                      <label className="space-y-1 text-xs">
                        <div className="flex justify-between">
                          <span>{isAr ? 'تعتيم الخلفية' : 'Backdrop Dimming'}</span>
                          <span className="font-mono-tabular">{Math.round(draft.wallpaperOverlayOpacity * 100)}%</span>
                        </div>
                        <input
                          type="range"
                          min={0}
                          max={0.9}
                          step={0.05}
                          value={draft.wallpaperOverlayOpacity}
                          onChange={(e) => commitDraftUpdate((p) => ({ ...p, wallpaperOverlayOpacity: Number(e.target.value) }))}
                          className="w-full"
                        />
                      </label>
                    </div>
                  </section>

                  {/* Transparency, Shadows & Animations */}
                  <section className="space-y-4 pt-4 border-t border-slate-200 dark:border-white/10">
                    <div className="flex items-center justify-between">
                      <h3 className="text-xs font-semibold text-slate-500 dark:text-[#9AA8C7]">
                        {isAr ? 'الشفافية والظلال والحركة' : 'Transparency, Shadows & Motion'}
                      </h3>
                      <button
                        type="button"
                        onClick={() =>
                          commitDraftUpdate((p) => ({
                            ...p,
                            surfaceOpacity: DEFAULT_CUSTOMIZATION_CONFIG.surfaceOpacity,
                            surfaceShadow: DEFAULT_CUSTOMIZATION_CONFIG.surfaceShadow,
                            enableAnimations: true,
                          }))
                        }
                        className="text-[11px] text-cyan-500 hover:underline flex items-center gap-1"
                      >
                        <RotateCcw className="w-3 h-3" /> {isAr ? 'إعادة ضبط' : 'Reset'}
                      </button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <label className="space-y-1 text-xs">
                        <div className="flex justify-between">
                          <span>{isAr ? 'شفافية النوافذ والبطاقات' : 'Surface Opacity'}</span>
                          <span className="font-mono-tabular">{Math.round(draft.surfaceOpacity * 100)}%</span>
                        </div>
                        <input
                          type="range"
                          min={0.65}
                          max={1}
                          step={0.02}
                          value={draft.surfaceOpacity}
                          onChange={(e) => commitDraftUpdate((p) => ({ ...p, surfaceOpacity: Number(e.target.value) }))}
                          className="w-full"
                        />
                      </label>

                      <div>
                        <label className="block text-xs mb-1.5">{isAr ? 'عمق الظلال' : 'Shadow Depth'}</label>
                        <select
                          value={draft.surfaceShadow}
                          onChange={(e) => commitDraftUpdate((p) => ({ ...p, surfaceShadow: e.target.value as ShadowLevel }))}
                          className="w-full min-h-[38px] px-3 rounded-xl bg-slate-100 dark:bg-[#05070D] text-xs"
                        >
                          <option value="none">{isAr ? 'بدون ظلال' : 'None'}</option>
                          <option value="soft">{isAr ? 'ظل ناعم' : 'Soft Elevation'}</option>
                          <option value="glow">{isAr ? 'توهج بلون التمييز' : 'Accent Glow'}</option>
                          <option value="deep">{isAr ? 'ظل عميق فاخر' : 'Deep Ambient'}</option>
                        </select>
                      </div>
                    </div>

                    <label className="flex items-center justify-between p-3 rounded-xl bg-slate-100 dark:bg-[#0C1222] text-xs cursor-pointer">
                      <span>{isAr ? 'تفعيل الانيميشن والانتقالات السلسة' : 'Enable Smooth Transitions & Motion'}</span>
                      <input
                        type="checkbox"
                        checked={draft.enableAnimations}
                        onChange={(e) => commitDraftUpdate((p) => ({ ...p, enableAnimations: e.target.checked }))}
                      />
                    </label>
                  </section>
                </div>
              )}

              {/* TAB 2: COLOR WHEEL, GRADIENTS, FAVORITES & IMAGE PALETTE EXTRACTOR */}
              {studioTab === 'colors' && (
                <div className="space-y-6">
                  {/* Target color token selector */}
                  <section className="space-y-2.5">
                    <div className="flex items-center justify-between">
                      <h3 className="text-xs font-semibold text-slate-500 dark:text-[#9AA8C7]">
                        {isAr ? 'اختر العنصر المراد تلوينه' : 'Select Color Target'}
                      </h3>
                      <button
                        type="button"
                        onClick={() =>
                          commitDraftUpdate((p) => ({
                            ...p,
                            primaryAccent: DEFAULT_CUSTOMIZATION_CONFIG.primaryAccent,
                            secondaryAccent: DEFAULT_CUSTOMIZATION_CONFIG.secondaryAccent,
                            outgoingBubbleColor: DEFAULT_CUSTOMIZATION_CONFIG.outgoingBubbleColor,
                            incomingBubbleColor: DEFAULT_CUSTOMIZATION_CONFIG.incomingBubbleColor,
                            gradientEnabled: false,
                          }))
                        }
                        className="text-[11px] text-cyan-500 hover:underline flex items-center gap-1"
                      >
                        <RotateCcw className="w-3 h-3" /> {isAr ? 'إعادة ضبط الألوان' : 'Reset Colors'}
                      </button>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {[
                        { id: 'primaryAccent' as const, label: isAr ? 'الأساسي' : 'Primary', hex: draft.primaryAccent },
                        { id: 'secondaryAccent' as const, label: isAr ? 'الثانوي' : 'Secondary', hex: draft.secondaryAccent },
                        { id: 'outgoingBubbleColor' as const, label: isAr ? 'فقاعتي' : 'Outgoing', hex: draft.outgoingBubbleColor },
                        { id: 'incomingBubbleColor' as const, label: isAr ? 'المستلم' : 'Incoming', hex: draft.incomingBubbleColor },
                      ].map((tok) => (
                        <button
                          key={tok.id}
                          type="button"
                          onClick={() => setColorTarget(tok.id)}
                          className={`p-2.5 rounded-xl border text-xs flex items-center gap-2 ${
                            colorTarget === tok.id ? 'border-cyan-500 bg-cyan-500/10 font-semibold' : 'border-slate-200 dark:border-white/10'
                          }`}
                        >
                          <span className="w-5 h-5 rounded-md border border-white/20 shrink-0" style={{ backgroundColor: tok.hex }} />
                          <span className="truncate">{tok.label}</span>
                        </button>
                      ))}
                    </div>
                  </section>

                  {/* Color Wheel Picker */}
                  <section className="p-4 rounded-2xl bg-slate-50 dark:bg-[#0C1222] border border-slate-200 dark:border-white/10">
                    <ColorWheelPicker
                      language={language}
                      color={getActiveTargetColor()}
                      favoriteColors={draft.favoriteColors}
                      onChange={setActiveTargetColor}
                      onAddFavorite={(hex) =>
                        commitDraftUpdate((p) => ({
                          ...p,
                          favoriteColors: Array.from(new Set([hex.toUpperCase(), ...p.favoriteColors])).slice(0, 24),
                        }))
                      }
                      onRemoveFavorite={(hex) =>
                        commitDraftUpdate((p) => ({
                          ...p,
                          favoriteColors: p.favoriteColors.filter((c) => c.toUpperCase() !== hex.toUpperCase()),
                        }))
                      }
                    />
                  </section>

                  {/* Gradient Generator */}
                  <section className="space-y-3 pt-4 border-t border-slate-200 dark:border-white/10">
                    <label className="flex items-center justify-between text-xs font-semibold cursor-pointer">
                      <span>{isAr ? 'إنشاء وتطبيق التدرجات اللونية (Gradients)' : 'Gradient Accent & Bubble Mode'}</span>
                      <input
                        type="checkbox"
                        checked={draft.gradientEnabled}
                        onChange={(e) => commitDraftUpdate((p) => ({ ...p, gradientEnabled: e.target.checked }))}
                      />
                    </label>
                    <div
                      className="h-10 rounded-xl border border-slate-200 dark:border-white/15"
                      style={{
                        background: `linear-gradient(${draft.gradientAngle}deg, ${draft.primaryAccent}, ${draft.secondaryAccent})`,
                      }}
                    />
                    <label className="block space-y-1 text-xs">
                      <div className="flex justify-between text-slate-500">
                        <span>{isAr ? 'زاوية التدرج' : 'Gradient Angle'}</span>
                        <span className="font-mono-tabular">{draft.gradientAngle}°</span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={360}
                        step={5}
                        value={draft.gradientAngle}
                        onChange={(e) => commitDraftUpdate((p) => ({ ...p, gradientAngle: Number(e.target.value) }))}
                        className="w-full"
                      />
                    </label>
                  </section>

                  {/* Extract Palette from Image */}
                  <section className="space-y-3 pt-4 border-t border-slate-200 dark:border-white/10">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <h3 className="text-xs font-semibold">
                          {isAr ? 'استخراج لوحة ألوان من صورة' : 'Extract Color Palette from Photo'}
                        </h3>
                        <p className="text-[11px] text-slate-500 dark:text-[#9AA8C7]">
                          {isAr
                            ? 'اختر أي صورة من جهازك لاستخراج أبرز الألوان وتطبيقها فوراً محلياً'
                            : 'Choose any image on your device to extract dominant colors offline'}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => paletteImageRef.current?.click()}
                        className="min-h-[38px] px-3.5 rounded-xl bg-slate-900 dark:bg-white/10 text-white text-xs font-semibold flex items-center gap-1.5"
                      >
                        <Upload className="w-3.5 h-3.5" />
                        <span>{extractingPalette ? (isAr ? 'جارٍ التحليل...' : 'Analyzing...') : (isAr ? 'اختيار صورة' : 'Pick Photo')}</span>
                      </button>
                      <input
                        ref={paletteImageRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={handleExtractPalette}
                      />
                    </div>

                    {extractedPalette.length > 0 && (
                      <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-[#0C1222] border border-slate-200 dark:border-white/10 space-y-3">
                        <div className="flex flex-wrap gap-2">
                          {extractedPalette.map((hex) => (
                            <button
                              key={hex}
                              type="button"
                              onClick={() => setActiveTargetColor(hex)}
                              className="px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-white/15 flex items-center gap-2 text-xs font-mono-tabular"
                            >
                              <span className="w-4 h-4 rounded-md" style={{ backgroundColor: hex }} />
                              <span>{hex}</span>
                            </button>
                          ))}
                        </div>
                        <button
                          type="button"
                          onClick={handleApplyExtractedPalette}
                          className="min-h-[36px] px-3.5 rounded-xl text-xs font-semibold text-[#041018]"
                          style={{ backgroundColor: extractedPalette[0] }}
                        >
                          {isAr ? 'تطبيق اللوحة المستخرجة بالكامل على الثيم' : 'Apply Extracted Palette to Theme'}
                        </button>
                      </div>
                    )}
                  </section>
                </div>
              )}

              {/* TAB 3: BUBBLES, ICONS, BUTTONS, MENUS & FONTS */}
              {studioTab === 'components' && (
                <div className="space-y-6">
                  {/* Chat Bubbles */}
                  <section className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-xs font-semibold text-slate-500 dark:text-[#9AA8C7]">
                        {isAr ? 'شكل وتفاصيل فقاعات المحادثات' : 'Chat Bubble Geometry & Shadows'}
                      </h3>
                      <button
                        type="button"
                        onClick={() =>
                          commitDraftUpdate((p) => ({
                            ...p,
                            bubbleStyle: DEFAULT_CUSTOMIZATION_CONFIG.bubbleStyle,
                            bubbleRadiusPx: DEFAULT_CUSTOMIZATION_CONFIG.bubbleRadiusPx,
                            bubbleOpacity: DEFAULT_CUSTOMIZATION_CONFIG.bubbleOpacity,
                            bubbleShadow: DEFAULT_CUSTOMIZATION_CONFIG.bubbleShadow,
                          }))
                        }
                        className="text-[11px] text-cyan-500 hover:underline flex items-center gap-1"
                      >
                        <RotateCcw className="w-3 h-3" /> {isAr ? 'إعادة ضبط الفقاعات' : 'Reset Bubbles'}
                      </button>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                      {[
                        { id: 'futuristic' as const, label: isAr ? 'مستقبلي' : 'Futuristic' },
                        { id: 'balanced' as const, label: isAr ? 'متوازن' : 'Balanced' },
                        { id: 'classic' as const, label: isAr ? 'كلاسيكي' : 'Classic' },
                        { id: 'capsule' as const, label: isAr ? 'كبسولة' : 'Capsule' },
                        { id: 'sharp' as const, label: isAr ? 'هندسي حاد' : 'Sharp' },
                      ].map((bs) => (
                        <button
                          key={bs.id}
                          type="button"
                          onClick={() => commitDraftUpdate((p) => ({ ...p, bubbleStyle: bs.id }))}
                          className={`min-h-[38px] px-2 rounded-xl border text-xs font-medium ${
                            draft.bubbleStyle === bs.id ? 'border-cyan-500 bg-cyan-500/10' : 'border-slate-200 dark:border-white/10'
                          }`}
                        >
                          {bs.label}
                        </button>
                      ))}
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-1">
                      <label className="space-y-1 text-xs">
                        <div className="flex justify-between">
                          <span>{isAr ? 'تدوير الحواف' : 'Corner Radius'}</span>
                          <span className="font-mono-tabular">{draft.bubbleRadiusPx}px</span>
                        </div>
                        <input
                          type="range"
                          min={4}
                          max={28}
                          step={1}
                          value={draft.bubbleRadiusPx}
                          onChange={(e) => commitDraftUpdate((p) => ({ ...p, bubbleRadiusPx: Number(e.target.value) }))}
                          className="w-full"
                        />
                      </label>
                      <label className="space-y-1 text-xs">
                        <div className="flex justify-between">
                          <span>{isAr ? 'شفافية الفقاعة' : 'Bubble Opacity'}</span>
                          <span className="font-mono-tabular">{Math.round(draft.bubbleOpacity * 100)}%</span>
                        </div>
                        <input
                          type="range"
                          min={0.45}
                          max={1}
                          step={0.05}
                          value={draft.bubbleOpacity}
                          onChange={(e) => commitDraftUpdate((p) => ({ ...p, bubbleOpacity: Number(e.target.value) }))}
                          className="w-full"
                        />
                      </label>
                      <div>
                        <label className="block text-xs mb-1">{isAr ? 'ظل الفقاعة' : 'Bubble Shadow'}</label>
                        <select
                          value={draft.bubbleShadow}
                          onChange={(e) => commitDraftUpdate((p) => ({ ...p, bubbleShadow: e.target.value as ShadowLevel }))}
                          className="w-full min-h-[36px] px-2.5 rounded-xl bg-slate-100 dark:bg-[#05070D] text-xs"
                        >
                          <option value="none">{isAr ? 'بدون' : 'None'}</option>
                          <option value="soft">{isAr ? 'ناعم' : 'Soft'}</option>
                          <option value="glow">{isAr ? 'متوهج' : 'Glow'}</option>
                          <option value="deep">{isAr ? 'عميق' : 'Deep'}</option>
                        </select>
                      </div>
                    </div>
                  </section>

                  {/* Icons, Buttons, Menus & Navigation */}
                  <section className="space-y-3 pt-4 border-t border-slate-200 dark:border-white/10">
                    <div className="flex items-center justify-between">
                      <h3 className="text-xs font-semibold text-slate-500 dark:text-[#9AA8C7]">
                        {isAr ? 'الأيقونات والأزرار والقوائم' : 'Icons, Buttons, Menus & Navigation'}
                      </h3>
                      <button
                        type="button"
                        onClick={() =>
                          commitDraftUpdate((p) => ({
                            ...p,
                            iconStyle: 'outlined',
                            buttonStyle: 'rounded',
                            menuStyle: 'glass',
                            navStyle: 'rail',
                            density: 'comfortable',
                          }))
                        }
                        className="text-[11px] text-cyan-500 hover:underline flex items-center gap-1"
                      >
                        <RotateCcw className="w-3 h-3" /> {isAr ? 'إعادة ضبط' : 'Reset'}
                      </button>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                      <div>
                        <label className="block text-[11px] text-slate-500 mb-1">{isAr ? 'نمط الأيقونات' : 'Icon Style'}</label>
                        <select
                          value={draft.iconStyle}
                          onChange={(e) => commitDraftUpdate((p) => ({ ...p, iconStyle: e.target.value as CustomizationConfig['iconStyle'] }))}
                          className="w-full min-h-[38px] px-2.5 rounded-xl bg-slate-100 dark:bg-[#05070D] text-xs"
                        >
                          <option value="outlined">{isAr ? 'خطي رشيق' : 'Outlined'}</option>
                          <option value="duotone">{isAr ? 'ثنائي الدرجة' : 'Duotone Fill'}</option>
                          <option value="bold">{isAr ? 'سميك بارز' : 'Bold Stroke'}</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-[11px] text-slate-500 mb-1">{isAr ? 'شكل الأزرار' : 'Button Shape'}</label>
                        <select
                          value={draft.buttonStyle}
                          onChange={(e) => commitDraftUpdate((p) => ({ ...p, buttonStyle: e.target.value as CustomizationConfig['buttonStyle'] }))}
                          className="w-full min-h-[38px] px-2.5 rounded-xl bg-slate-100 dark:bg-[#05070D] text-xs"
                        >
                          <option value="rounded">{isAr ? 'مستدير حديث' : 'Rounded'}</option>
                          <option value="pill">{isAr ? 'بيضاوي' : 'Pill'}</option>
                          <option value="sharp">{isAr ? 'هندسي حاد' : 'Sharp'}</option>
                          <option value="glass">{isAr ? 'زجاجي شفاف' : 'Glass'}</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-[11px] text-slate-500 mb-1">{isAr ? 'أسلوب القوائم' : 'Menu Surface'}</label>
                        <select
                          value={draft.menuStyle}
                          onChange={(e) => commitDraftUpdate((p) => ({ ...p, menuStyle: e.target.value as CustomizationConfig['menuStyle'] }))}
                          className="w-full min-h-[38px] px-2.5 rounded-xl bg-slate-100 dark:bg-[#05070D] text-xs"
                        >
                          <option value="glass">{isAr ? 'زجاجي ضبابي' : 'Glass Blur'}</option>
                          <option value="solid">{isAr ? 'صلب صافي' : 'Solid'}</option>
                          <option value="bordered">{isAr ? 'محدد بإطار لوني' : 'Accent Bordered'}</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-[11px] text-slate-500 mb-1">{isAr ? 'شريط التنقل' : 'Nav Layout'}</label>
                        <select
                          value={draft.navStyle}
                          onChange={(e) => commitDraftUpdate((p) => ({ ...p, navStyle: e.target.value as CustomizationConfig['navStyle'] }))}
                          className="w-full min-h-[38px] px-2.5 rounded-xl bg-slate-100 dark:bg-[#05070D] text-xs"
                        >
                          <option value="rail">{isAr ? 'شريط جانبي كلاسيكي' : 'Docked Rail'}</option>
                          <option value="floating">{isAr ? 'شريط عائم' : 'Floating Dock'}</option>
                          <option value="minimal">{isAr ? 'مبسط مدمج' : 'Minimal'}</option>
                        </select>
                      </div>
                    </div>
                  </section>

                  {/* Fonts & Sizes */}
                  <section className="space-y-3 pt-4 border-t border-slate-200 dark:border-white/10">
                    <div className="flex items-center justify-between">
                      <h3 className="text-xs font-semibold text-slate-500 dark:text-[#9AA8C7]">
                        {isAr ? 'الخطوط والأحجام' : 'Typography & Scale'}
                      </h3>
                      <button
                        type="button"
                        onClick={() => commitDraftUpdate((p) => ({ ...p, fontFamily: 'system', fontScale: 1, density: 'comfortable' }))}
                        className="text-[11px] text-cyan-500 hover:underline flex items-center gap-1"
                      >
                        <RotateCcw className="w-3 h-3" /> {isAr ? 'إعادة ضبط الخط' : 'Reset Typography'}
                      </button>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-[11px] text-slate-500 mb-1">{isAr ? 'عائلة الخط' : 'Font Family'}</label>
                        <select
                          value={draft.fontFamily}
                          onChange={(e) => commitDraftUpdate((p) => ({ ...p, fontFamily: e.target.value as StudioFontFamily }))}
                          className="w-full min-h-[38px] px-3 rounded-xl bg-slate-100 dark:bg-[#05070D] text-xs"
                        >
                          <option value="system">{isAr ? 'النظام الحديث (System)' : 'Modern System'}</option>
                          <option value="geometric">{isAr ? 'هندسي عصري (Geometric)' : 'Geometric Modern'}</option>
                          <option value="editorial">{isAr ? 'أدبي فاخر (Serif)' : 'Editorial Serif'}</option>
                          <option value="arabic_naskh">{isAr ? 'نسخ عربي كلاسيكي' : 'Arabic Classic Naskh'}</option>
                          <option value="monospace">{isAr ? 'تقني أحادي (Monospace)' : 'Technical Monospace'}</option>
                        </select>
                      </div>
                      <label className="space-y-1 text-xs">
                        <div className="flex justify-between">
                          <span>{isAr ? 'حجم الخط العام' : 'Global Font Scale'}</span>
                          <span className="font-mono-tabular">{draft.fontScale.toFixed(2)}x</span>
                        </div>
                        <input
                          type="range"
                          min={0.85}
                          max={1.35}
                          step={0.05}
                          value={draft.fontScale}
                          onChange={(e) => commitDraftUpdate((p) => ({ ...p, fontScale: Number(e.target.value) }))}
                          className="w-full mt-2"
                        />
                      </label>
                    </div>
                  </section>
                </div>
              )}

              {/* TAB 4: PER-PAGE INDEPENDENT CUSTOMIZATION (ALL 8 PAGES) */}
              {studioTab === 'pages' && (
                <div className="space-y-5">
                  <div>
                    <h3 className="text-xs font-semibold text-slate-500 dark:text-[#9AA8C7] mb-2">
                      {isAr ? 'اختر الصفحة لتخصيصها بشكل مستقل' : 'Choose Page to Customize Independently'}
                    </h3>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {STUDIO_PAGE_KEYS.map((pk) => {
                        const meta = PAGE_LABELS[pk];
                        const Icon = meta.icon;
                        const active = previewPage === pk;
                        const enabled = draft.pageThemes[pk]?.enabled;
                        return (
                          <button
                            key={pk}
                            type="button"
                            onClick={() => setPreviewPage(pk)}
                            className={`p-2.5 rounded-xl border text-start text-xs flex items-center gap-2 transition-colors ${
                              active ? 'border-cyan-500 bg-cyan-500/15 font-semibold' : 'border-slate-200 dark:border-white/10'
                            }`}
                          >
                            <Icon className="w-4 h-4 shrink-0" />
                            <span className="truncate flex-1">{isAr ? meta.ar : meta.en}</span>
                            {enabled && <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: draft.primaryAccent }} />}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Active Page Editor */}
                  <div className="p-4 rounded-2xl bg-slate-50 dark:bg-[#0C1222] border border-slate-200 dark:border-white/10 space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <label className="flex items-center gap-2.5 text-xs font-semibold cursor-pointer">
                        <input
                          type="checkbox"
                          checked={activePageOv.enabled}
                          onChange={(e) => updatePageOverride(previewPage, { enabled: e.target.checked })}
                        />
                        <span>
                          {isAr
                            ? `تفعيل تصميم مستقل لـ "${PAGE_LABELS[previewPage].ar}"`
                            : `Enable Independent Override for "${PAGE_LABELS[previewPage].en}"`}
                        </span>
                      </label>
                      <button
                        type="button"
                        onClick={() => updatePageOverride(previewPage, { ...EMPTY_PAGE_OVERRIDE })}
                        className="text-[11px] text-cyan-500 hover:underline flex items-center gap-1"
                      >
                        <RotateCcw className="w-3 h-3" />
                        <span>{isAr ? 'إعادة ضبط هذه الصفحة' : 'Reset This Page'}</span>
                      </button>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <label className="space-y-1 text-xs">
                        <span>{isAr ? 'الخلفية' : 'Background'}</span>
                        <input
                          type="color"
                          value={activePageOv.backgroundColor || '#05070D'}
                          onChange={(e) => updatePageOverride(previewPage, { enabled: true, backgroundColor: e.target.value })}
                          className="w-full h-9 rounded-lg cursor-pointer"
                        />
                      </label>
                      <label className="space-y-1 text-xs">
                        <span>{isAr ? 'البطاقات' : 'Surface'}</span>
                        <input
                          type="color"
                          value={activePageOv.surfaceColor || '#0C1222'}
                          onChange={(e) => updatePageOverride(previewPage, { enabled: true, surfaceColor: e.target.value })}
                          className="w-full h-9 rounded-lg cursor-pointer"
                        />
                      </label>
                      <label className="space-y-1 text-xs">
                        <span>{isAr ? 'لون التمييز' : 'Accent'}</span>
                        <input
                          type="color"
                          value={activePageOv.accentColor || draft.primaryAccent}
                          onChange={(e) => updatePageOverride(previewPage, { enabled: true, accentColor: e.target.value })}
                          className="w-full h-9 rounded-lg cursor-pointer"
                        />
                      </label>
                      <label className="space-y-1 text-xs">
                        <span>{isAr ? 'لون النص' : 'Text Color'}</span>
                        <input
                          type="color"
                          value={activePageOv.textColor || '#F2F6FF'}
                          onChange={(e) => updatePageOverride(previewPage, { enabled: true, textColor: e.target.value })}
                          className="w-full h-9 rounded-lg cursor-pointer"
                        />
                      </label>
                    </div>

                    {/* Page Gradient + Gallery Wallpaper */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                      <div className="space-y-2 p-3 rounded-xl bg-white dark:bg-[#05070D] border border-slate-200 dark:border-white/10">
                        <label className="flex items-center justify-between text-xs font-medium cursor-pointer">
                          <span>{isAr ? 'خلفية متدرجة لهذه الصفحة' : 'Page Gradient Backdrop'}</span>
                          <input
                            type="checkbox"
                            checked={Boolean(activePageOv.useGradient)}
                            onChange={(e) => updatePageOverride(previewPage, { enabled: true, useGradient: e.target.checked })}
                          />
                        </label>
                        <div className="flex items-center gap-2">
                          <input
                            type="color"
                            value={activePageOv.gradientFrom || '#0C1222'}
                            onChange={(e) => updatePageOverride(previewPage, { enabled: true, useGradient: true, gradientFrom: e.target.value })}
                            className="h-8 flex-1 rounded cursor-pointer"
                          />
                          <input
                            type="color"
                            value={activePageOv.gradientTo || '#1A103D'}
                            onChange={(e) => updatePageOverride(previewPage, { enabled: true, useGradient: true, gradientTo: e.target.value })}
                            className="h-8 flex-1 rounded cursor-pointer"
                          />
                        </div>
                      </div>

                      <div className="space-y-2 p-3 rounded-xl bg-white dark:bg-[#05070D] border border-slate-200 dark:border-white/10 flex flex-col justify-between">
                        <span className="text-xs font-medium">{isAr ? 'صورة خلفية خاصة بالصفحة' : 'Custom Page Wallpaper'}</span>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => pageWallpaperFileRef.current?.click()}
                            className="flex-1 min-h-[34px] px-3 rounded-lg border border-dashed border-cyan-500/40 text-xs flex items-center justify-center gap-1.5"
                          >
                            <Upload className="w-3.5 h-3.5" />
                            <span>{isAr ? 'رفع من المعرض' : 'Upload Photo'}</span>
                          </button>
                          {activePageOv.wallpaperDataUrl && (
                            <button
                              type="button"
                              onClick={() => updatePageOverride(previewPage, { wallpaperDataUrl: undefined })}
                              className="min-h-[34px] px-2.5 rounded-lg bg-red-500/15 text-red-500 text-xs"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                          <input
                            ref={pageWallpaperFileRef}
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(e) => handleUploadWallpaper(e, previewPage)}
                          />
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <label className="space-y-1 text-xs">
                        <div className="flex justify-between">
                          <span>{isAr ? 'شفافية السطح' : 'Surface Opacity'}</span>
                          <span className="font-mono-tabular">{Math.round((activePageOv.surfaceOpacity ?? 0.94) * 100)}%</span>
                        </div>
                        <input
                          type="range"
                          min={0.5}
                          max={1}
                          step={0.05}
                          value={activePageOv.surfaceOpacity ?? 0.94}
                          onChange={(e) => updatePageOverride(previewPage, { enabled: true, surfaceOpacity: Number(e.target.value) })}
                          className="w-full"
                        />
                      </label>
                      <label className="space-y-1 text-xs">
                        <div className="flex justify-between">
                          <span>{isAr ? 'تدوير الحواف' : 'Card Radius'}</span>
                          <span className="font-mono-tabular">{activePageOv.borderRadiusPx ?? 18}px</span>
                        </div>
                        <input
                          type="range"
                          min={4}
                          max={32}
                          step={2}
                          value={activePageOv.borderRadiusPx ?? 18}
                          onChange={(e) => updatePageOverride(previewPage, { enabled: true, borderRadiusPx: Number(e.target.value) })}
                          className="w-full"
                        />
                      </label>
                      <div>
                        <label className="block text-xs mb-1">{isAr ? 'ظل الصفحة' : 'Page Shadow'}</label>
                        <select
                          value={activePageOv.shadowLevel || 'soft'}
                          onChange={(e) => updatePageOverride(previewPage, { enabled: true, shadowLevel: e.target.value as ShadowLevel })}
                          className="w-full min-h-[34px] px-2.5 rounded-xl bg-white dark:bg-[#05070D] text-xs"
                        >
                          <option value="none">{isAr ? 'بدون' : 'None'}</option>
                          <option value="soft">{isAr ? 'ناعم' : 'Soft'}</option>
                          <option value="glow">{isAr ? 'توهج' : 'Glow'}</option>
                          <option value="deep">{isAr ? 'عميق' : 'Deep'}</option>
                        </select>
                      </div>
                    </div>

                    {previewPage === 'notifications' && (
                      <button
                        type="button"
                        onClick={() => onTriggerTestNotification(draft)}
                        className="min-h-[38px] px-4 rounded-xl text-xs font-semibold text-[#041018] flex items-center gap-2"
                        style={{ backgroundColor: activePageOv.accentColor || draft.primaryAccent }}
                      >
                        <Bell className="w-4 h-4" />
                        <span>{isAr ? 'إرسال إشعار تجريبي حي الآن' : 'Trigger Live In-App Notification'}</span>
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* TAB 5: UNLIMITED THEME LIBRARY, EXPORT/IMPORT, BACKUP RESTORE & PER-CHAT THEMES */}
              {studioTab === 'library' && (
                <div className="space-y-6">
                  {/* Save Current Design */}
                  <form onSubmit={handleSaveNewPreset} className="p-4 rounded-2xl bg-slate-50 dark:bg-[#0C1222] border border-slate-200 dark:border-white/10 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="text-xs font-semibold">{isAr ? 'حفظ التصميم الحالي كثيم جديد' : 'Save Current Design as New Theme'}</h3>
                      <button
                        type="button"
                        onClick={() => importThemeRef.current?.click()}
                        className="min-h-[34px] px-3 rounded-xl border border-slate-200 dark:border-white/15 text-xs font-medium flex items-center gap-1.5"
                      >
                        <Upload className="w-3.5 h-3.5" />
                        <span>{isAr ? 'استيراد ملف ثيم' : 'Import Theme File'}</span>
                      </button>
                      <input
                        ref={importThemeRef}
                        type="file"
                        accept=".json,.charisma-theme.json"
                        className="hidden"
                        onChange={handleImportThemeFile}
                      />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <input
                        type="text"
                        required
                        value={newThemeName}
                        onChange={(e) => setNewThemeName(e.target.value)}
                        placeholder={isAr ? 'اسم الثيم (مثال: ثيمي الفاخر)' : 'Theme name (e.g. Royal Midnight)'}
                        className="min-h-[40px] px-3 rounded-xl bg-white dark:bg-[#05070D] border border-slate-200 dark:border-white/10 text-xs"
                      />
                      <input
                        type="text"
                        value={newThemeDesc}
                        onChange={(e) => setNewThemeDesc(e.target.value)}
                        placeholder={isAr ? 'وصف مختصر (اختياري)' : 'Short note (optional)'}
                        className="min-h-[40px] px-3 rounded-xl bg-white dark:bg-[#05070D] border border-slate-200 dark:border-white/10 text-xs"
                      />
                    </div>
                    <button
                      type="submit"
                      className="min-h-[38px] px-4 rounded-xl text-xs font-semibold text-[#041018] flex items-center gap-1.5"
                      style={{ backgroundColor: draft.primaryAccent }}
                    >
                      <Save className="w-3.5 h-3.5" />
                      <span>{isAr ? 'حفظ في مكتبتي المحلية' : 'Save to Local Library'}</span>
                    </button>
                  </form>

                  {/* User Saved Themes */}
                  <section className="space-y-2.5">
                    <h3 className="text-xs font-semibold text-slate-500 dark:text-[#9AA8C7]">
                      {isAr ? `ثيماتي المحفوظة (${savedThemes.length})` : `My Saved Themes (${savedThemes.length})`}
                    </h3>
                    {savedThemes.length === 0 ? (
                      <p className="text-xs text-slate-500">{isAr ? 'لم تحفظ ثيماً مخصصاً بعد — استخدم النموذج أعلاه أو انسخ أحد القوالب الجاهزة.' : 'No custom themes saved yet — save your current design above or duplicate a preset below.'}</p>
                    ) : (
                      <div className="space-y-2">
                        {savedThemes.map((preset) => (
                          <div
                            key={preset.themeId}
                            className="p-3 rounded-2xl bg-slate-50 dark:bg-[#0C1222] border border-slate-200 dark:border-white/10 flex flex-wrap items-center justify-between gap-2"
                          >
                            <div className="flex items-center gap-2.5 min-w-0">
                              <span
                                className="w-8 h-8 rounded-xl border border-white/20 shrink-0"
                                style={{
                                  background: `linear-gradient(135deg, ${preset.config.primaryAccent}, ${preset.config.secondaryAccent})`,
                                }}
                              />
                              <div className="min-w-0">
                                <div className="text-xs font-semibold truncate">{preset.name}</div>
                                <div className="text-[11px] text-slate-500 truncate">
                                  {preset.description || formatLocalizedDate(preset.updatedAt, language)}
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <button
                                type="button"
                                onClick={() => commitDraftUpdate(() => preset.config)}
                                className="min-h-[32px] px-2.5 rounded-lg bg-cyan-500/15 text-cyan-600 dark:text-[#00E5FF] text-xs font-semibold"
                              >
                                {isAr ? 'تحميل' : 'Load'}
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDuplicatePreset(preset)}
                                title={isAr ? 'نسخ وتعديل' : 'Duplicate & Edit'}
                                className="min-h-[32px] px-2 rounded-lg border border-slate-200 dark:border-white/15 text-xs"
                              >
                                <Copy className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleExportPreset(preset)}
                                title={isAr ? 'تصدير ملف' : 'Export JSON'}
                                className="min-h-[32px] px-2 rounded-lg border border-slate-200 dark:border-white/15 text-xs"
                              >
                                <Download className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeletePreset(preset.themeId)}
                                title={isAr ? 'حذف' : 'Delete'}
                                className="min-h-[32px] px-2 rounded-lg bg-red-500/10 text-red-500 text-xs"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>

                  {/* Built-in Curated Presets */}
                  <section className="space-y-2.5 pt-3 border-t border-slate-200 dark:border-white/10">
                    <h3 className="text-xs font-semibold text-slate-500 dark:text-[#9AA8C7]">
                      {isAr ? 'قوالب CHARISMA الجاهزة (قابلة للنسخ والتعديل)' : 'Built-In CHARISMA Presets'}
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {BUILTIN_THEME_PRESETS.map((preset) => (
                        <div
                          key={preset.themeId}
                          className="p-3 rounded-2xl bg-slate-50 dark:bg-[#0C1222] border border-slate-200 dark:border-white/10 flex items-center justify-between gap-2"
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <span
                              className="w-7 h-7 rounded-lg shrink-0"
                              style={{
                                background: `linear-gradient(135deg, ${preset.config.primaryAccent}, ${preset.config.secondaryAccent})`,
                              }}
                            />
                            <span className="text-xs font-medium truncate">{preset.name}</span>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={() => commitDraftUpdate(() => preset.config)}
                              className="min-h-[30px] px-2.5 rounded-lg bg-slate-200 dark:bg-white/10 text-xs font-semibold"
                            >
                              {isAr ? 'معاينة' : 'Use'}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDuplicatePreset(preset)}
                              title={isAr ? 'نسخ لمكتبتي' : 'Duplicate to Library'}
                              className="min-h-[30px] px-2 rounded-lg border border-slate-200 dark:border-white/15"
                            >
                              <Copy className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>

                  {/* Per-Chat Custom Theme Assignment */}
                  <section className="space-y-2.5 pt-3 border-t border-slate-200 dark:border-white/10">
                    <h3 className="text-xs font-semibold text-slate-500 dark:text-[#9AA8C7]">
                      {isAr ? 'تعيين ثيم مختلف لكل محادثة' : 'Assign Custom Theme per Conversation'}
                    </h3>
                    {conversations.length === 0 ? (
                      <p className="text-xs text-slate-500">{isAr ? 'أنشئ محادثة أولاً لتخصيص ثيم خاص بها.' : 'Start a conversation first to bind a dedicated theme to it.'}</p>
                    ) : (
                      <div className="space-y-2">
                        {conversations.map((conv) => (
                          <div
                            key={conv.convId}
                            className="p-2.5 rounded-xl bg-slate-50 dark:bg-[#0C1222] border border-slate-200 dark:border-white/10 flex items-center justify-between gap-3"
                          >
                            <span className="text-xs font-medium truncate">{conv.title}</span>
                            <select
                              value={conv.customThemeId || ''}
                              onChange={(e) => onAssignChatTheme(conv.convId, e.target.value || undefined)}
                              className="min-h-[34px] px-2.5 rounded-lg bg-white dark:bg-[#05070D] border border-slate-200 dark:border-white/10 text-xs max-w-[180px]"
                            >
                              <option value="">{isAr ? 'الثيم العام للتطبيق' : 'Global App Theme'}</option>
                              {savedThemes.map((tItem) => (
                                <option key={tItem.themeId} value={tItem.themeId}>{tItem.name}</option>
                              ))}
                              {BUILTIN_THEME_PRESETS.map((bItem) => (
                                <option key={bItem.themeId} value={bItem.themeId}>{bItem.name}</option>
                              ))}
                            </select>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>

                  {/* Deleted Themes Local Backup Recovery */}
                  {deletedBackups.length > 0 && (
                    <section className="space-y-2.5 pt-3 border-t border-slate-200 dark:border-white/10">
                      <h3 className="text-xs font-semibold text-amber-500 flex items-center gap-1.5">
                        <ArchiveRestore className="w-4 h-4" />
                        <span>{isAr ? `النسخ الاحتياطية للثيمات المحذوفة (${deletedBackups.length})` : `Local Deleted Theme Backups (${deletedBackups.length})`}</span>
                      </h3>
                      <div className="space-y-2">
                        {deletedBackups.map((bak) => (
                          <div
                            key={bak.backupId}
                            className="p-2.5 rounded-xl bg-amber-500/5 border border-amber-500/20 flex items-center justify-between gap-2 text-xs"
                          >
                            <div className="min-w-0">
                              <div className="font-medium truncate">{bak.preset.name}</div>
                              <div className="text-[11px] text-slate-500">{formatLocalizedDate(bak.deletedAt, language)}</div>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <button
                                type="button"
                                onClick={() => handleRestoreBackup(bak.backupId)}
                                className="min-h-[30px] px-2.5 rounded-lg bg-emerald-500/15 text-emerald-500 font-semibold"
                              >
                                {isAr ? 'استعادة' : 'Restore'}
                              </button>
                              <button
                                type="button"
                                onClick={() => handlePurgeBackup(bak.backupId)}
                                className="min-h-[30px] px-2 rounded-lg text-red-500 hover:bg-red-500/10"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </section>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Right Live Interactive Preview Canvas */}
          <div className={`${mobileShowPreview ? 'flex' : 'hidden lg:flex'} flex-1 flex-col bg-slate-100 dark:bg-[#04060B] overflow-hidden`}>
            <div className="px-4 py-2.5 border-b border-slate-200 dark:border-white/10 flex items-center justify-between gap-2 bg-white dark:bg-[#080C18]">
              <span className="text-xs font-semibold flex items-center gap-1.5">
                <Eye className="w-3.5 h-3.5" style={{ color: draft.primaryAccent }} />
                <span>{isAr ? 'المعاينة الحية الفورية' : 'Live Interactive Preview'}</span>
              </span>
              <select
                value={previewPage}
                onChange={(e) => setPreviewPage(e.target.value as StudioPageKey)}
                className="min-h-[34px] px-2.5 rounded-lg bg-slate-100 dark:bg-[#0C1222] text-xs font-medium"
              >
                {STUDIO_PAGE_KEYS.map((pk) => (
                  <option key={pk} value={pk}>
                    {isAr ? PAGE_LABELS[pk].ar : PAGE_LABELS[pk].en}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex-1 overflow-y-auto p-4 sm:p-6 flex items-center justify-center">
              {/* Device Live Preview Shell */}
              <div
                className={`w-full max-w-md rounded-3xl border overflow-hidden relative ${
                  draft.themeMode === 'dark' ? 'bg-[#05070D] text-[#F2F6FF] border-white/15' : 'bg-[#F4F7FC] text-slate-900 border-slate-200'
                }`}
                style={{
                  ...getPageShellStyle(draft, previewPage),
                  fontFamily: getFontStack(draft.fontFamily),
                  boxShadow: getShadowCss(draft.surfaceShadow, draft.primaryAccent),
                }}
              >
                {draft.wallpaperBlur > 0 && (
                  <div
                    className="absolute inset-0 pointer-events-none"
                    style={{ backdropFilter: `blur(${draft.wallpaperBlur}px)` }}
                  />
                )}

                <div className="relative z-10 flex flex-col min-h-[460px]">
                  {/* Preview Top Bar */}
                  <div
                    className="px-4 py-3 border-b border-white/10 flex items-center justify-between"
                    style={getPageCardStyle(draft, previewPage)}
                  >
                    <div className="flex items-center gap-2.5">
                      <div
                        className="w-8 h-8 flex items-center justify-center font-bold text-[#041018]"
                        style={{
                          borderRadius: buttonStyleRadius,
                          background: draft.gradientEnabled
                            ? `linear-gradient(${draft.gradientAngle}deg, ${draft.primaryAccent}, ${draft.secondaryAccent})`
                            : draft.primaryAccent,
                        }}
                      >
                        ◈
                      </div>
                      <div>
                        <div className="text-xs font-bold" style={{ fontSize: `${13 * draft.fontScale}px` }}>
                          {isAr ? PAGE_LABELS[previewPage].ar : PAGE_LABELS[previewPage].en}
                        </div>
                        <div className="text-[10px] opacity-65">CHARISMA Studio Preview</div>
                      </div>
                    </div>
                    <button
                      type="button"
                      data-studio-fixed
                      style={{
                        borderRadius: buttonStyleRadius,
                        backgroundColor: draft.pageThemes[previewPage]?.enabled
                          ? draft.pageThemes[previewPage].accentColor || draft.primaryAccent
                          : draft.primaryAccent,
                        color: '#041018',
                      }}
                      className="px-3 py-1.5 text-[11px] font-semibold"
                    >
                      {isAr ? 'زر رئيسي' : 'Primary'}
                    </button>
                  </div>

                  {/* Preview Body per Page */}
                  <div className="flex-1 p-4 space-y-3">
                    {(previewPage === 'chatScreen' || previewPage === 'home') && (
                      <>
                        <div className="flex justify-start">
                          <div
                            className="max-w-[78%] px-3.5 py-2.5 text-xs border border-white/10"
                            style={{
                              ...getBubbleCornerStyle(draft, false, isAr),
                              backgroundColor: hexToRgba(draft.incomingBubbleColor, draft.bubbleOpacity),
                              boxShadow: getShadowCss(draft.bubbleShadow, draft.secondaryAccent),
                              fontSize: `${13 * draft.fontScale}px`,
                              color: draft.themeMode === 'light' && draft.incomingBubbleColor === '#FFFFFF' ? '#0F172A' : undefined,
                            }}
                          >
                            {isAr
                              ? 'مرحباً! هذه معاينة حية لفقاعة المستلم والخطوط والظلال.'
                              : 'Hello! Live preview of incoming bubble shape, font, and shadow.'}
                          </div>
                        </div>
                        <div className="flex justify-end">
                          <div
                            className="max-w-[78%] px-3.5 py-2.5 text-xs border border-white/15"
                            style={{
                              ...getBubbleCornerStyle(draft, true, isAr),
                              background: draft.gradientEnabled
                                ? `linear-gradient(${draft.gradientAngle}deg, ${hexToRgba(draft.outgoingBubbleColor, draft.bubbleOpacity)}, ${hexToRgba(draft.secondaryAccent, draft.bubbleOpacity)})`
                                : hexToRgba(draft.outgoingBubbleColor, draft.bubbleOpacity),
                              boxShadow: getShadowCss(draft.bubbleShadow, draft.primaryAccent),
                              fontSize: `${13 * draft.fontScale}px`,
                            }}
                          >
                            {isAr
                              ? 'رائع! التعديلات تظهر فوراً مع الحفظ المحلي التلقائي.'
                              : 'Awesome! Changes render instantaneously and auto-save locally.'}
                          </div>
                        </div>
                      </>
                    )}

                    {previewPage === 'notifications' && (
                      <div
                        className="p-3.5 border border-white/15 space-y-1"
                        style={{
                          ...getPageCardStyle(draft, 'notifications'),
                          borderRadius: `${activePageOv.borderRadiusPx ?? 16}px`,
                        }}
                      >
                        <div className="flex items-center justify-between text-xs font-bold">
                          <span className="flex items-center gap-1.5">
                            <Bell className="w-3.5 h-3.5" style={{ color: activePageOv.accentColor || draft.primaryAccent }} />
                            <span>{t.testNotificationTitle}</span>
                          </span>
                          <span className="text-[10px] opacity-60">{isAr ? 'الآن' : 'Now'}</span>
                        </div>
                        <p className="text-xs opacity-80" style={{ fontSize: `${12 * draft.fontScale}px` }}>
                          {t.testNotificationBody}
                        </p>
                      </div>
                    )}

                    {previewPage !== 'chatScreen' && previewPage !== 'home' && previewPage !== 'notifications' && (
                      <div className="space-y-2.5">
                        {[1, 2].map((idx) => (
                          <div
                            key={idx}
                            className="p-3.5 border border-white/10 flex items-center justify-between"
                            style={{
                              ...getPageCardStyle(draft, previewPage),
                              borderRadius: `${activePageOv.borderRadiusPx ?? 16}px`,
                            }}
                          >
                            <div className="space-y-0.5">
                              <div className="text-xs font-semibold" style={{ fontSize: `${13 * draft.fontScale}px` }}>
                                {isAr ? `${PAGE_LABELS[previewPage].ar} · عنصر ${idx}` : `${PAGE_LABELS[previewPage].en} · Item ${idx}`}
                              </div>
                              <div className="text-[11px] opacity-65">
                                {isAr ? 'معاينة البطاقة والشفافية والخط' : 'Card surface, opacity & typography preview'}
                              </div>
                            </div>
                            <span
                              className="px-2.5 py-1 text-[10px] font-semibold text-[#041018]"
                              style={{
                                borderRadius: buttonStyleRadius,
                                backgroundColor: activePageOv.accentColor || draft.primaryAccent,
                              }}
                            >
                              {isAr ? 'نشط' : 'Active'}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Preview Footer Bar */}
                  <div
                    className="px-4 py-2.5 border-t border-white/10 flex items-center justify-around text-[11px]"
                    style={getPageCardStyle(draft, previewPage)}
                  >
                    <span style={{ color: activePageOv.accentColor || draft.primaryAccent }} className="font-semibold">
                      {t.navChats}
                    </span>
                    <span className="opacity-65">{t.navContacts}</span>
                    <span className="opacity-65">{t.navStories}</span>
                    <span className="opacity-65">{t.navCalls}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
