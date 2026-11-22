import React, { useEffect, useRef, useState } from 'react';
import { Heart, Plus, X } from 'lucide-react';
import { AppLanguage } from '../types/charisma';
import { isValidHex } from '../utils/themeEngine';

interface ColorWheelPickerProps {
  language: AppLanguage;
  color: string;
  favoriteColors: string[];
  onChange: (hex: string) => void;
  onAddFavorite: (hex: string) => void;
  onRemoveFavorite: (hex: string) => void;
}

function hexToHsv(hex: string): { h: number; s: number; v: number } {
  const clean = isValidHex(hex) ? hex.slice(1) : '00E5FF';
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h = Math.round(h * 60);
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : d / max;
  return { h, s, v: max };
}

function hsvToHex(h: number, s: number, v: number): string {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let rp = 0;
  let gp = 0;
  let bp = 0;
  if (h < 60) {
    rp = c; gp = x;
  } else if (h < 120) {
    rp = x; gp = c;
  } else if (h < 180) {
    gp = c; bp = x;
  } else if (h < 240) {
    gp = x; bp = c;
  } else if (h < 300) {
    rp = x; bp = c;
  } else {
    rp = c; bp = x;
  }
  const toHex = (n: number) =>
    Math.max(0, Math.min(255, Math.round((n + m) * 255)))
      .toString(16)
      .padStart(2, '0')
      .toUpperCase();
  return `#${toHex(rp)}${toHex(gp)}${toHex(bp)}`;
}

function hsvToRgb(h: number, s: number, v: number): { r: number; g: number; b: number } {
  const hex = hsvToHex(h, s, v).slice(1);
  return {
    r: parseInt(hex.slice(0, 2), 16),
    g: parseInt(hex.slice(2, 4), 16),
    b: parseInt(hex.slice(4, 6), 16),
  };
}

export const ColorWheelPicker: React.FC<ColorWheelPickerProps> = ({
  language,
  color,
  favoriteColors,
  onChange,
  onAddFavorite,
  onRemoveFavorite,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const draggingRef = useRef(false);
  const [hsv, setHsv] = useState(() => hexToHsv(color));
  const [hexInput, setHexInput] = useState(color.toUpperCase());

  useEffect(() => {
    if (isValidHex(color) && color.toUpperCase() !== hexInput.toUpperCase()) {
      setHexInput(color.toUpperCase());
      setHsv(hexToHsv(color));
    }
  }, [color]);

  // Draw HSV Color Wheel onto canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const size = canvas.width;
    const radius = size / 2;
    const img = ctx.createImageData(size, size);
    const data = img.data;

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = x - radius;
        const dy = y - radius;
        const dist = Math.hypot(dx, dy);
        const idx = (y * size + x) * 4;
        if (dist <= radius) {
          const sat = Math.min(1, dist / radius);
          let angle = (Math.atan2(dy, dx) * 180) / Math.PI;
          if (angle < 0) angle += 360;
          const rgb = hsvToRgb(angle, sat, hsv.v);
          data[idx] = rgb.r;
          data[idx + 1] = rgb.g;
          data[idx + 2] = rgb.b;
          data[idx + 3] = dist > radius - 1.2 ? Math.max(0, Math.round((radius - dist) * 210)) : 255;
        } else {
          data[idx + 3] = 0;
        }
      }
    }
    ctx.putImageData(img, 0, 0);
  }, [hsv.v]);

  function pickFromPointer(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const dx = e.clientX - rect.left - cx;
    const dy = e.clientY - rect.top - cy;
    const maxR = Math.min(cx, cy);
    const sat = Math.min(1, Math.hypot(dx, dy) / maxR);
    let hue = (Math.atan2(dy, dx) * 180) / Math.PI;
    if (hue < 0) hue += 360;

    const nextHsv = { h: hue, s: sat, v: hsv.v };
    setHsv(nextHsv);
    const nextHex = hsvToHex(nextHsv.h, nextHsv.s, nextHsv.v);
    setHexInput(nextHex);
    onChange(nextHex);
  }

  function handleBrightnessChange(nextV: number) {
    const nextHsv = { ...hsv, v: nextV };
    setHsv(nextHsv);
    const nextHex = hsvToHex(nextHsv.h, nextHsv.s, nextHsv.v);
    setHexInput(nextHex);
    onChange(nextHex);
  }

  function handleHexTyping(raw: string) {
    const formatted = raw.startsWith('#') ? raw : `#${raw}`;
    setHexInput(formatted.toUpperCase().slice(0, 7));
    if (isValidHex(formatted)) {
      const upper = formatted.toUpperCase();
      setHsv(hexToHsv(upper));
      onChange(upper);
    }
  }

  const sizePx = 192;
  const markerAngle = (hsv.h * Math.PI) / 180;
  const markerRadius = hsv.s * (sizePx / 2 - 4);
  const markerX = sizePx / 2 + Math.cos(markerAngle) * markerRadius;
  const markerY = sizePx / 2 + Math.sin(markerAngle) * markerRadius;
  const fullBrightHex = hsvToHex(hsv.h, hsv.s, 1);
  const normalizedHex = isValidHex(color) ? color.toUpperCase() : '#00E5FF';
  const isFavorited = favoriteColors.some((c) => c.toUpperCase() === normalizedHex);

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row items-center gap-5">
        {/* Interactive Canvas Wheel */}
        <div className="relative shrink-0" style={{ width: sizePx, height: sizePx }}>
          <canvas
            ref={canvasRef}
            width={sizePx}
            height={sizePx}
            onPointerDown={(e) => {
              draggingRef.current = true;
              e.currentTarget.setPointerCapture(e.pointerId);
              pickFromPointer(e);
            }}
            onPointerMove={(e) => {
              if (draggingRef.current) pickFromPointer(e);
            }}
            onPointerUp={() => {
              draggingRef.current = false;
            }}
            className="rounded-full cursor-crosshair touch-none shadow-inner"
          />
          <div
            className="w-4 h-4 rounded-full border-2 border-white shadow-md pointer-events-none absolute -translate-x-1/2 -translate-y-1/2"
            style={{
              left: `${markerX}px`,
              top: `${markerY}px`,
              backgroundColor: normalizedHex,
            }}
          />
        </div>

        {/* Controls: Brightness, HEX Input, RGB & Save Favorite */}
        <div className="flex-1 w-full space-y-3">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs text-slate-500 dark:text-[#9AA8C7]">
              <span>{language === 'ar' ? 'السطوع (Brightness)' : 'Brightness'}</span>
              <span className="font-mono-tabular">{Math.round(hsv.v * 100)}%</span>
            </div>
            <input
              type="range"
              min={0.08}
              max={1}
              step={0.01}
              value={hsv.v}
              onChange={(e) => handleBrightnessChange(Number(e.target.value))}
              className="w-full h-3 rounded-full appearance-none cursor-pointer"
              style={{
                background: `linear-gradient(to right, #000000, ${fullBrightHex})`,
              }}
            />
          </div>

          <div className="flex items-center gap-2">
            <div
              className="w-11 h-11 rounded-xl border border-slate-200 dark:border-white/15 shrink-0"
              style={{ backgroundColor: normalizedHex }}
            />
            <div className="flex-1">
              <label className="block text-[11px] text-slate-500 dark:text-[#9AA8C7] mb-1">HEX</label>
              <input
                type="text"
                value={hexInput}
                onChange={(e) => handleHexTyping(e.target.value)}
                maxLength={7}
                dir="ltr"
                className="w-full min-h-[38px] px-3 rounded-xl bg-slate-100 dark:bg-[#05070D] border border-slate-200 dark:border-white/15 font-mono-tabular text-xs uppercase focus:outline-none focus:border-cyan-500"
              />
            </div>
            <button
              type="button"
              onClick={() => (isFavorited ? onRemoveFavorite(normalizedHex) : onAddFavorite(normalizedHex))}
              title={language === 'ar' ? 'حفظ في الألوان المفضلة' : 'Save to Favorites'}
              className={`min-h-[42px] px-3 mt-4 rounded-xl border text-xs font-semibold flex items-center gap-1.5 shrink-0 ${
                isFavorited
                  ? 'border-rose-500/40 bg-rose-500/15 text-rose-500'
                  : 'border-slate-200 dark:border-white/15 hover:border-cyan-500'
              }`}
            >
              {isFavorited ? <Heart className="w-4 h-4 fill-current" /> : <Plus className="w-4 h-4" />}
              <span>{language === 'ar' ? 'مفضل' : 'Save'}</span>
            </button>
          </div>

          {/* Favorites Palette */}
          <div className="space-y-1.5">
            <span className="text-[11px] font-medium text-slate-500 dark:text-[#9AA8C7]">
              {language === 'ar' ? 'الألوان المفضلة المحفوظة' : 'Saved Favorite Colors'}
            </span>
            <div className="flex flex-wrap gap-2">
              {favoriteColors.map((fav) => (
                <div key={fav} className="relative group">
                  <button
                    type="button"
                    onClick={() => onChange(fav)}
                    title={fav}
                    className={`w-7 h-7 rounded-lg border transition-transform hover:scale-110 ${
                      fav.toUpperCase() === normalizedHex
                        ? 'border-white ring-2 ring-cyan-400'
                        : 'border-slate-300 dark:border-white/20'
                    }`}
                    style={{ backgroundColor: fav }}
                  />
                  <button
                    type="button"
                    onClick={() => onRemoveFavorite(fav)}
                    aria-label="Remove favorite color"
                    className="opacity-0 group-hover:opacity-100 transition-opacity w-4 h-4 rounded-full bg-black/80 text-white flex items-center justify-center absolute -top-1 -end-1"
                  >
                    <X className="w-2.5 h-2.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
