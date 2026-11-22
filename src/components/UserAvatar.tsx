import React from 'react';

interface UserAvatarProps {
  avatarColor?: string;
  avatarEmoji?: string;
  avatarDataUrl?: string;
  alt?: string;
  sizeClass?: string;
  textClass?: string;
  roundedClass?: string;
}

export const UserAvatar: React.FC<UserAvatarProps> = ({
  avatarColor = '#00E5FF',
  avatarEmoji = '◈',
  avatarDataUrl,
  alt = 'Avatar',
  sizeClass = 'w-11 h-11',
  textClass = 'text-base',
  roundedClass = 'rounded-2xl',
}) => {
  if (avatarDataUrl) {
    return (
      <img
        src={avatarDataUrl}
        alt={alt}
        className={`${sizeClass} ${roundedClass} object-cover shrink-0 border border-slate-200 dark:border-white/15`}
      />
    );
  }

  return (
    <div
      className={`${sizeClass} ${roundedClass} ${textClass} flex items-center justify-center font-bold text-[#041018] shrink-0`}
      style={{ backgroundColor: avatarColor }}
    >
      {avatarEmoji}
    </div>
  );
};
