import React from 'react';
import { WifiOff } from 'lucide-react';
import { AppLanguage } from '../types/charisma';
import { useOnlineStatus } from '../hooks/useOnlineStatus';

interface OfflineIndicatorProps {
  language: AppLanguage;
}

export const OfflineIndicator: React.FC<OfflineIndicatorProps> = ({ language }) => {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div className="fixed bottom-20 md:bottom-4 start-4 z-[65] flex items-center gap-2 rounded-xl bg-amber-500 px-3.5 py-2 text-xs font-semibold text-[#041018] shadow-lg">
      <WifiOff className="w-4 h-4 shrink-0" />
      <span>
        {language === 'ar'
          ? 'وضع عدم الاتصال — يتم استخدام البيانات المحلية المشفرة'
          : 'Offline Mode — Cached app shell & encrypted local storage active'}
      </span>
    </div>
  );
};
