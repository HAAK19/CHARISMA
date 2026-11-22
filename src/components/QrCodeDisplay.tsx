import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';

interface QrCodeDisplayProps {
  value: string;
  size?: number;
  label?: string;
}

export const QrCodeDisplay: React.FC<QrCodeDisplayProps> = ({ value, size = 180, label }) => {
  const [dataUrl, setDataUrl] = useState<string>('');

  useEffect(() => {
    let active = true;
    QRCode.toDataURL(value, {
      width: size,
      margin: 2,
      color: { dark: '#05070D', light: '#FFFFFF' },
    })
      .then((url) => {
        if (active) setDataUrl(url);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [value, size]);

  if (!dataUrl) {
    return (
      <div
        className="rounded-xl bg-slate-200 dark:bg-white/10 animate-pulse"
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <div className="inline-flex flex-col items-center gap-2">
      <div className="p-2.5 bg-white rounded-2xl border border-slate-200">
        <img src={dataUrl} alt={label || 'QR Code'} width={size} height={size} className="rounded-lg" />
      </div>
      {label && <span className="text-xs text-slate-500 dark:text-[#9AA8C7]">{label}</span>}
    </div>
  );
};
