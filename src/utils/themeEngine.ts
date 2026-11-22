import type React from 'react';
import {
  CustomizationConfig,
  PageThemeOverride,
  SavedThemePreset,
  ShadowLevel,
  StudioFontFamily,
  StudioPageKey,
} from '../types/charisma';

export const STUDIO_PAGE_KEYS: StudioPageKey[] = [
  'home',
  'chatsList',
  'chatScreen',
  'calls',
  'stories',
  'contacts',
  'settings',
  'notifications',
];

export const EMPTY_PAGE_OVERRIDE: PageThemeOverride = {
  enabled: false,
  backgroundColor: '',
  surfaceColor: '',
  accentColor: '',
  textColor: '',
  useGradient: false,
  gradientFrom: '#0C1222',
  gradientTo: '#1A103D',
  gradientAngle: 135,
  surfaceOpacity: 0.94,
  shadowLevel: 'soft',
  borderRadiusPx: 18,
};

export const DEFAULT_PAGE_THEMES: Record<StudioPageKey, PageThemeOverride> = {
  home: { ...EMPTY_PAGE_OVERRIDE },
  chatsList: { ...EMPTY_PAGE_OVERRIDE },
  chatScreen: { ...EMPTY_PAGE_OVERRIDE },
  calls: { ...EMPTY_PAGE_OVERRIDE },
  stories: { ...EMPTY_PAGE_OVERRIDE },
  contacts: { ...EMPTY_PAGE_OVERRIDE },
  settings: { ...EMPTY_PAGE_OVERRIDE },
  notifications: { ...EMPTY_PAGE_OVERRIDE },
};

export const DEFAULT_CUSTOMIZATION_CONFIG: CustomizationConfig = {
  themeMode: 'dark',
  primaryAccent: '#00E5FF',
  secondaryAccent: '#9D4EDD',
  gradientEnabled: false,
  gradientAngle: 135,
  outgoingBubbleColor: '#0E3A5D',
  incomingBubbleColor: '#11192E',
  wallpaper: 'silk_dark',
  customWallpaperDataUrl: undefined,
  wallpaperBlur: 0,
  wallpaperOverlayOpacity: 0.45,
  bubbleStyle: 'futuristic',
  bubbleRadiusPx: 18,
  bubbleOpacity: 0.95,
  bubbleShadow: 'soft',
  surfaceOpacity: 0.96,
  surfaceShadow: 'soft',
  fontFamily: 'system',
  fontScale: 1,
  density: 'comfortable',
  navStyle: 'rail',
  iconStyle: 'outlined',
  buttonStyle: 'rounded',
  menuStyle: 'glass',
  enableAnimations: true,
  notificationSound: 'pulse',
  favoriteColors: ['#00E5FF', '#9D4EDD', '#10B981', '#F59E0B', '#EC4899', '#3B82F6'],
  pageThemes: DEFAULT_PAGE_THEMES,
};

export function normalizeCustomization(raw?: Partial<CustomizationConfig> | null): CustomizationConfig {
  const mergedPages: Record<StudioPageKey, PageThemeOverride> = { ...DEFAULT_PAGE_THEMES };
  if (raw?.pageThemes) {
    for (const k of STUDIO_PAGE_KEYS) {
      mergedPages[k] = {
        ...EMPTY_PAGE_OVERRIDE,
        ...(raw.pageThemes[k] || {}),
      };
    }
  }
  return {
    ...DEFAULT_CUSTOMIZATION_CONFIG,
    ...(raw || {}),
    favoriteColors: Array.isArray(raw?.favoriteColors) && raw.favoriteColors.length > 0
      ? raw.favoriteColors.filter((c) => /^#[0-9a-fA-F]{6}$/.test(c)).slice(0, 24)
      : DEFAULT_CUSTOMIZATION_CONFIG.favoriteColors,
    pageThemes: mergedPages,
  };
}

export const BUILTIN_THEME_PRESETS: Array<Omit<SavedThemePreset, 'ownerUserId' | 'createdAt' | 'updatedAt'>> = [
  {
    themeId: 'builtin_charisma_dark',
    name: 'CHARISMA Midnight Cyan',
    description: 'Original deep midnight slate with electric cyan and subtle silk texture.',
    config: normalizeCustomization(DEFAULT_CUSTOMIZATION_CONFIG),
  },
  {
    themeId: 'builtin_obsidian_gold',
    name: 'Obsidian Royal Gold',
    description: 'Warm obsidian black surfaces with brushed amber-gold highlights and editorial typography.',
    config: normalizeCustomization({
      themeMode: 'dark',
      primaryAccent: '#F5B041',
      secondaryAccent: '#D97706',
      gradientEnabled: true,
      gradientAngle: 135,
      outgoingBubbleColor: '#3B280D',
      incomingBubbleColor: '#161412',
      wallpaper: 'gradient',
      bubbleStyle: 'balanced',
      bubbleRadiusPx: 20,
      bubbleShadow: 'glow',
      fontFamily: 'editorial',
      buttonStyle: 'pill',
    }),
  },
  {
    themeId: 'builtin_daylight_pearl',
    name: 'Daylight Pearl',
    description: 'Crisp luminous canvas with cobalt accents and clean soft elevation.',
    config: normalizeCustomization({
      themeMode: 'light',
      primaryAccent: '#0284C7',
      secondaryAccent: '#6366F1',
      gradientEnabled: false,
      outgoingBubbleColor: '#E0F2FE',
      incomingBubbleColor: '#FFFFFF',
      wallpaper: 'clean_light',
      bubbleStyle: 'balanced',
      bubbleRadiusPx: 18,
      bubbleShadow: 'soft',
      fontFamily: 'geometric',
      buttonStyle: 'rounded',
    }),
  },
  {
    themeId: 'builtin_emerald_stealth',
    name: 'Emerald Stealth Matrix',
    description: 'Low-glare stealth dark theme with emerald accents and monospace precision.',
    config: normalizeCustomization({
      themeMode: 'dark',
      primaryAccent: '#10B981',
      secondaryAccent: '#06B6D4',
      gradientEnabled: true,
      gradientAngle: 160,
      outgoingBubbleColor: '#0A3326',
      incomingBubbleColor: '#0D1714',
      wallpaper: 'midnight_grid',
      bubbleStyle: 'sharp',
      bubbleRadiusPx: 8,
      bubbleShadow: 'soft',
      fontFamily: 'monospace',
      buttonStyle: 'sharp',
      menuStyle: 'bordered',
    }),
  },
];

export function isValidHex(color: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(color.trim());
}

export function hexToRgba(hex: string, alpha: number): string {
  const clean = isValidHex(hex) ? hex.replace('#', '') : '0C1222';
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  const clamped = Math.max(0, Math.min(1, alpha));
  return `rgba(${r}, ${g}, ${b}, ${clamped})`;
}

export function getShadowCss(level: ShadowLevel | undefined, accentHex = '#00E5FF'): string {
  switch (level) {
    case 'none':
      return 'none';
    case 'glow':
      return `0 8px 28px -4px ${hexToRgba(accentHex, 0.32)}, 0 2px 8px rgba(0,0,0,0.22)`;
    case 'deep':
      return '0 16px 40px -8px rgba(0, 0, 0, 0.55), 0 4px 12px rgba(0, 0, 0, 0.3)';
    case 'soft':
    default:
      return '0 6px 20px -4px rgba(2, 6, 23, 0.25)';
  }
}

export function getFontStack(family: StudioFontFamily): string {
  switch (family) {
    case 'editorial':
      return "Georgia, 'Times New Roman', 'Amiri', 'Geeza Pro', serif";
    case 'geometric':
      return "'Avenir Next', 'Segoe UI', 'Dubai', 'Geeza Pro', system-ui, sans-serif";
    case 'monospace':
      return "ui-monospace, 'SFMono-Regular', Menlo, Monaco, Consolas, monospace";
    case 'arabic_naskh':
      return "'Geeza Pro', 'Traditional Arabic', 'Tahoma', system-ui, sans-serif";
    case 'system':
    default:
      return "system-ui, -apple-system, 'Segoe UI', 'Geeza Pro', 'Tahoma', sans-serif";
  }
}

export function getButtonRadiusCss(style: CustomizationConfig['buttonStyle']): string {
  switch (style) {
    case 'pill':
      return '9999px';
    case 'sharp':
      return '4px';
    case 'glass':
    case 'rounded':
    default:
      return '12px';
  }
}

export function applyThemeToDocument(cfg: CustomizationConfig): void {
  const root = document.documentElement;
  if (cfg.themeMode === 'dark') {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }

  const fontStack = getFontStack(cfg.fontFamily);
  root.style.setProperty('--charisma-accent', cfg.primaryAccent);
  root.style.setProperty('--charisma-secondary', cfg.secondaryAccent);
  root.style.setProperty(
    '--charisma-accent-bg',
    cfg.gradientEnabled
      ? `linear-gradient(${cfg.gradientAngle}deg, ${cfg.primaryAccent}, ${cfg.secondaryAccent})`
      : cfg.primaryAccent,
  );
  root.style.setProperty('--font-sans', fontStack);
  root.style.setProperty('--font-display', fontStack);
  root.style.setProperty('--charisma-font-scale', String(cfg.fontScale));
  root.style.setProperty('--charisma-btn-radius', getButtonRadiusCss(cfg.buttonStyle));
  root.style.setProperty('--charisma-surface-opacity', String(cfg.surfaceOpacity));
  root.style.setProperty('--charisma-surface-shadow', getShadowCss(cfg.surfaceShadow, cfg.primaryAccent));
  root.style.setProperty(
    '--charisma-icon-stroke',
    cfg.iconStyle === 'bold' ? '2.4' : cfg.iconStyle === 'duotone' ? '1.9' : '1.65',
  );

  root.dataset.btnStyle = cfg.buttonStyle;
  root.dataset.iconStyle = cfg.iconStyle;
  root.dataset.menuStyle = cfg.menuStyle;
  root.dataset.navStyle = cfg.navStyle;
  root.dataset.anim = cfg.enableAnimations ? 'on' : 'off';
}

export function getPageShellStyle(cfg: CustomizationConfig, pageKey: StudioPageKey): React.CSSProperties {
  const override = cfg.pageThemes?.[pageKey];
  const styles: React.CSSProperties = {
    fontFamily: getFontStack(cfg.fontFamily),
  };

  if (override?.enabled) {
    if (override.textColor) styles.color = override.textColor;
    if (override.wallpaperDataUrl) {
      styles.backgroundImage = `linear-gradient(${hexToRgba(override.backgroundColor || '#05070D', cfg.wallpaperOverlayOpacity)}, ${hexToRgba(override.backgroundColor || '#05070D', cfg.wallpaperOverlayOpacity)}), url(${override.wallpaperDataUrl})`;
      styles.backgroundSize = 'cover';
      styles.backgroundPosition = 'center';
    } else if (override.useGradient && override.gradientFrom && override.gradientTo) {
      styles.backgroundImage = `linear-gradient(${override.gradientAngle ?? cfg.gradientAngle}deg, ${override.gradientFrom}, ${override.gradientTo})`;
    } else if (override.backgroundColor) {
      styles.backgroundColor = override.backgroundColor;
    }
    if (override.accentColor) {
      (styles as Record<string, string>)['--charisma-accent'] = override.accentColor;
    }
    return styles;
  }

  // Global wallpaper on home/chatScreen if no page override
  if (pageKey === 'home' && cfg.wallpaper === 'custom_image' && cfg.customWallpaperDataUrl) {
    const dimColor = cfg.themeMode === 'dark' ? '#05070D' : '#F4F7FC';
    styles.backgroundImage = `linear-gradient(${hexToRgba(dimColor, cfg.wallpaperOverlayOpacity)}, ${hexToRgba(dimColor, cfg.wallpaperOverlayOpacity)}), url(${cfg.customWallpaperDataUrl})`;
    styles.backgroundSize = 'cover';
    styles.backgroundPosition = 'center';
  } else if (pageKey === 'home' && cfg.wallpaper === 'gradient') {
    const bgA = cfg.themeMode === 'dark' ? '#05070D' : '#F1F5F9';
    styles.backgroundImage = `radial-gradient(circle at top right, ${hexToRgba(cfg.primaryAccent, 0.14)}, transparent 50%), radial-gradient(circle at bottom left, ${hexToRgba(cfg.secondaryAccent, 0.14)}, ${bgA} 65%)`;
  }

  return styles;
}

export function getPageCardStyle(cfg: CustomizationConfig, pageKey: StudioPageKey): React.CSSProperties {
  const override = cfg.pageThemes?.[pageKey];
  const opacity = override?.enabled && override.surfaceOpacity !== undefined
    ? override.surfaceOpacity
    : cfg.surfaceOpacity;
  const shadow = override?.enabled && override.shadowLevel
    ? override.shadowLevel
    : cfg.surfaceShadow;
  const accent = override?.enabled && override.accentColor
    ? override.accentColor
    : cfg.primaryAccent;

  const baseSurface = override?.enabled && override.surfaceColor
    ? override.surfaceColor
    : cfg.themeMode === 'dark'
    ? '#0C1222'
    : '#FFFFFF';

  const style: React.CSSProperties = {
    boxShadow: getShadowCss(shadow, accent),
    backdropFilter: opacity < 0.99 ? 'blur(12px)' : undefined,
  };

  if (override?.enabled && override.surfaceColor) {
    style.backgroundColor = hexToRgba(baseSurface, opacity);
  } else if (opacity < 0.99) {
    style.backgroundColor = hexToRgba(baseSurface, opacity);
  }

  if (override?.enabled && override.borderRadiusPx !== undefined) {
    style.borderRadius = `${override.borderRadiusPx}px`;
  }

  if (cfg.menuStyle === 'bordered') {
    style.borderColor = hexToRgba(accent, 0.35);
  }

  return style;
}

export function getBubbleCornerStyle(
  cfg: CustomizationConfig,
  isOutgoing: boolean,
  isRtl: boolean,
): React.CSSProperties {
  const r = Math.max(4, Math.min(32, cfg.bubbleRadiusPx));
  const rightSide = isRtl ? !isOutgoing : isOutgoing;
  if (cfg.bubbleStyle === 'capsule') {
    return { borderRadius: '26px' };
  }
  if (cfg.bubbleStyle === 'sharp') {
    return { borderRadius: '6px' };
  }
  if (cfg.bubbleStyle === 'classic') {
    return { borderRadius: '10px' };
  }
  if (cfg.bubbleStyle === 'balanced') {
    return { borderRadius: `${r}px` };
  }
  // Futuristic asymmetric tail
  return rightSide
    ? { borderRadius: `${r}px ${r}px 4px ${r}px` }
    : { borderRadius: `${r}px ${r}px ${r}px 4px` };
}

export async function resizeGalleryImageToDataUrl(file: File, maxDim = 1440): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read selected image file'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Invalid image format'));
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const width = Math.max(1, Math.round(img.width * scale));
        const height = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(reader.result as string);
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.82));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

export async function extractPaletteFromImageDataUrl(dataUrl: string, count = 6): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onerror = () => reject(new Error('Failed to load image for palette extraction'));
    img.onload = () => {
      const size = 64;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(['#00E5FF', '#9D4EDD', '#1E293B', '#0F172A', '#38BDF8', '#F43F5E']);
        return;
      }
      ctx.drawImage(img, 0, 0, size, size);
      const { data } = ctx.getImageData(0, 0, size, size);

      // Quantize pixels into 5-bit buckets and pick distinct colors
      const buckets = new Map<string, { r: number; g: number; b: number; count: number; weight: number }>();
      for (let i = 0; i < data.length; i += 4) {
        const a = data[i + 3];
        if (a < 128) continue;
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const satWeight = 1 + (max - min) / 64;
        const key = `${r >> 5}-${g >> 5}-${b >> 5}`;
        const existing = buckets.get(key);
        if (existing) {
          existing.r += r;
          existing.g += g;
          existing.b += b;
          existing.count += 1;
          existing.weight += satWeight;
        } else {
          buckets.set(key, { r, g, b, count: 1, weight: satWeight });
        }
      }

      const sorted = Array.from(buckets.values()).sort((a, b) => b.weight - a.weight);
      const picked: Array<{ r: number; g: number; b: number }> = [];

      for (const bucket of sorted) {
        const avgR = Math.min(255, Math.round(bucket.r / bucket.count));
        const avgG = Math.min(255, Math.round(bucket.g / bucket.count));
        const avgB = Math.min(255, Math.round(bucket.b / bucket.count));

        // Ensure color distinctness
        const tooClose = picked.some(
          (p) => Math.hypot(p.r - avgR, p.g - avgG, p.b - avgB) < 42,
        );
        if (!tooClose) {
          picked.push({ r: avgR, g: avgG, b: avgB });
          if (picked.length >= count) break;
        }
      }

      // Compute exact means directly if bucket division drifted
      const toHex = (n: number) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0').toUpperCase();
      const hexList = picked.map((c) => `#${toHex(c.r)}${toHex(c.g)}${toHex(c.b)}`);
      resolve(hexList.length > 0 ? hexList : ['#00E5FF', '#9D4EDD', '#0EA5E9', '#1E293B']);
    };
    img.src = dataUrl;
  });
}

export function parseImportedThemeJson(rawJson: string): {
  name: string;
  description?: string;
  config: CustomizationConfig;
} {
  const parsed = JSON.parse(rawJson) as Record<string, unknown>;
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Invalid theme file format');
  }
  const candidateConfig = (
    parsed.config && typeof parsed.config === 'object' ? parsed.config : parsed
  ) as Partial<CustomizationConfig>;

  if (!candidateConfig.primaryAccent && !candidateConfig.themeMode && !candidateConfig.bubbleStyle) {
    throw new Error('Theme file is missing required CHARISMA customization fields');
  }

  const name =
    typeof parsed.name === 'string' && parsed.name.trim()
      ? parsed.name.trim().slice(0, 60)
      : 'Imported CHARISMA Theme';
  const description =
    typeof parsed.description === 'string' ? parsed.description.trim().slice(0, 160) : undefined;

  return {
    name,
    description,
    config: normalizeCustomization(candidateConfig),
  };
}
