import React, { useEffect, useRef, useState } from 'react';
import { Camera, ImagePlus, QrCode, X } from 'lucide-react';
import { AppLanguage } from '../types/charisma';
import { parseUserQrPayload, ScannedQrIdentity } from '../utils/qrIdentity';

interface BarcodeDetectorLike {
  detect: (source: ImageBitmapSource) => Promise<Array<{ rawValue?: string }>>;
}

interface QrScannerModalProps {
  language: AppLanguage;
  primaryAccent: string;
  onDetected: (identity: ScannedQrIdentity) => void;
  onClose: () => void;
}

export const QrScannerModal: React.FC<QrScannerModalProps> = ({
  language,
  primaryAccent,
  onDetected,
  onClose,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [manualInput, setManualInput] = useState('');
  const [scanError, setScanError] = useState<string | null>(null);

  const BarcodeDetectorCtor = (
    window as unknown as {
      BarcodeDetector?: new (opts: { formats: string[] }) => BarcodeDetectorLike;
    }
  ).BarcodeDetector;
  const hasBarcodeDetector = typeof BarcodeDetectorCtor === 'function';

  useEffect(() => {
    let active = true;
    let rafTimer: number | null = null;

    async function startCamera() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraError(
          language === 'ar'
            ? 'متصفح هذا الجهاز لا يدعم تشغيل الكاميرا مباشرة. يمكنك رفع صورة QR أو لصق المعرّف.'
            : 'Camera access is not supported in this browser. Upload a QR image or paste an identity code below.',
        );
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
        });
        if (!active) {
          stream.getTracks().forEach((tr) => tr.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        setCameraActive(true);

        if (BarcodeDetectorCtor) {
          const detector = new BarcodeDetectorCtor({ formats: ['qr_code'] });
          const scanFrame = async () => {
            if (!active || !videoRef.current) return;
            try {
              if (videoRef.current.readyState >= 2) {
                const barcodes = await detector.detect(videoRef.current);
                const hit = barcodes.find((b) => typeof b.rawValue === 'string' && b.rawValue.trim());
                if (hit?.rawValue) {
                  const parsed = parseUserQrPayload(hit.rawValue);
                  if (parsed) {
                    onDetected(parsed);
                    return;
                  }
                }
              }
            } catch {
              // Ignore single frame errors
            }
            rafTimer = window.setTimeout(scanFrame, 260);
          };
          rafTimer = window.setTimeout(scanFrame, 350);
        } else {
          setCameraError(
            language === 'ar'
              ? 'الكاميرا تعمل، لكن قارئ BarcodeDetector التلقائي غير مدعوم في هذا المتصفح. استخدم رفع صورة QR أو لصق الرمز أدناه.'
              : 'Camera active, but automatic BarcodeDetector is unavailable in this browser. Upload a QR image or paste the code below.',
          );
        }
      } catch {
        setCameraError(
          language === 'ar'
            ? 'تعذر الوصول إلى الكاميرا (تم رفض الإذن أو لا توجد كاميرا). يمكنك لصق رمز QR أو اسم المستخدم أدناه.'
            : 'Camera unavailable or permission denied. You can paste a QR identity code, User ID, or @username below.',
        );
      }
    }

    startCamera();

    return () => {
      active = false;
      if (rafTimer) window.clearTimeout(rafTimer);
      streamRef.current?.getTracks().forEach((tr) => tr.stop());
      streamRef.current = null;
    };
  }, [BarcodeDetectorCtor, language, onDetected]);

  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setScanError(null);

    if (!BarcodeDetectorCtor) {
      setScanError(
        language === 'ar'
          ? 'فك تشفير صور QR تلقائياً غير مدعوم في هذا المتصفح. انسخ نص الرمز أو User ID والصقه أدناه.'
          : 'Automatic QR image decoding is unavailable in this browser. Paste the QR code or User ID below.',
      );
      return;
    }

    try {
      const bitmap = await createImageBitmap(file);
      const detector = new BarcodeDetectorCtor({ formats: ['qr_code'] });
      const codes = await detector.detect(bitmap);
      bitmap.close();
      const raw = codes.find((c) => c.rawValue)?.rawValue;
      if (!raw) {
        setScanError(
          language === 'ar'
            ? 'لم يتم العثور على رمز QR صالح داخل هذه الصورة.'
            : 'No valid QR code was detected inside this image.',
        );
        return;
      }
      const parsed = parseUserQrPayload(raw);
      if (!parsed) {
        setScanError(
          language === 'ar'
            ? 'الرمز الممسوح لا يخص هوية CHARISMA صالحة.'
            : 'Scanned QR code is not a valid CHARISMA identity.',
        );
        return;
      }
      onDetected(parsed);
    } catch {
      setScanError(
        language === 'ar'
          ? 'تعذر قراءة الصورة المختارة.'
          : 'Could not inspect the selected image.',
      );
    }
  }

  function handleManualSubmit(e: React.FormEvent) {
    e.preventDefault();
    setScanError(null);
    const parsed = parseUserQrPayload(manualInput);
    if (!parsed) {
      setScanError(
        language === 'ar'
          ? 'أدخل رابط charisma:// أو User ID أو @username صحيح.'
          : 'Enter a valid charisma:// QR payload, User ID, or @username.',
      );
      return;
    }
    onDetected(parsed);
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white dark:bg-[#0C1222] border border-slate-200 dark:border-white/15 rounded-3xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <QrCode className="w-5 h-5" style={{ color: primaryAccent }} />
            <h3 className="font-display text-base font-bold">
              {language === 'ar' ? 'مسح رمز QR لصديق' : 'Scan Friend QR Code'}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[38px] min-w-[38px] rounded-xl flex items-center justify-center hover:bg-slate-100 dark:hover:bg-white/10"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Camera Viewport */}
        <div className="relative aspect-[4/3] rounded-2xl overflow-hidden bg-[#05070D] border border-white/10 flex items-center justify-center">
          <video ref={videoRef} autoPlay muted playsInline className="w-full h-full object-cover" />
          {cameraActive && hasBarcodeDetector && (
            <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
              <div
                className="w-44 h-44 rounded-3xl border-2"
                style={{ borderColor: primaryAccent }}
              />
            </div>
          )}
          {!cameraActive && (
            <div className="absolute inset-0 flex flex-col items-center justify-center p-4 text-center text-xs text-slate-300 gap-2">
              <Camera className="w-8 h-8 opacity-60" />
              <span>{cameraError || (language === 'ar' ? 'جارٍ فتح الكاميرا...' : 'Starting camera...')}</span>
            </div>
          )}
        </div>

        {cameraActive && cameraError && (
          <p className="text-[11px] text-amber-500">{cameraError}</p>
        )}

        {/* QR Image Upload + Manual QR Payload / User ID */}
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleImageUpload}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="w-full min-h-[42px] px-4 rounded-xl border border-slate-200 dark:border-white/15 text-xs font-semibold flex items-center justify-center gap-2 hover:border-cyan-500"
          >
            <ImagePlus className="w-4 h-4" style={{ color: primaryAccent }} />
            <span>
              {language === 'ar' ? 'مسح من صورة QR محفوظة' : 'Scan from QR Image File'}
            </span>
          </button>
        </div>

        <form onSubmit={handleManualSubmit} className="space-y-2 pt-2 border-t border-slate-200 dark:border-white/10">
          <label className="block text-[11px] font-medium text-slate-500 dark:text-[#9AA8C7]">
            {language === 'ar'
              ? 'أو الصق كود QR أو User ID أو @اسم_المستخدم مباشرة:'
              : 'Or paste QR identity code, User ID (usr_...), or @username:'}
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={manualInput}
              onChange={(e) => setManualInput(e.target.value)}
              placeholder="charisma://user?data=... or @username"
              dir="ltr"
              className="flex-1 min-h-[42px] px-3 rounded-xl bg-slate-100 dark:bg-[#05070D] border border-slate-200 dark:border-white/10 text-xs font-mono-tabular focus:outline-none"
            />
            <button
              type="submit"
              className="min-h-[42px] px-4 rounded-xl text-xs font-semibold text-[#041018]"
              style={{ backgroundColor: primaryAccent }}
            >
              {language === 'ar' ? 'فتح الملف' : 'Open'}
            </button>
          </div>
        </form>

        {scanError && (
          <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/25 text-xs text-red-500">
            {scanError}
          </div>
        )}
      </div>
    </div>
  );
};
