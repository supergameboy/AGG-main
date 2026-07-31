/**
 * 控制面板公共控件（折叠分区容器 / 分段按钮 / 滑杆 / 开关 / 说明文本）
 * UI 语言遵循主项目：Tailwind + 暗色主题 + 紧凑工程面板风格。
 */

import React, { useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...args: Parameters<typeof clsx>): string {
  return twMerge(clsx(...args));
}

export const Section: React.FC<{
  title: string;
  badge?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}> = ({ title, badge, defaultOpen = false, children }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-white/10 rounded-lg overflow-hidden bg-[#12121c]">
      <button
        className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-white/5 transition-colors"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="text-[13px] font-semibold text-gray-100 tracking-wide">{title}</span>
        <span className="flex items-center gap-2">
          {badge && <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300 border border-purple-500/30">{badge}</span>}
          <span className="text-gray-500 text-xs">{open ? '▾' : '▸'}</span>
        </span>
      </button>
      {open && <div className="px-3 pb-3 pt-1 space-y-2.5 border-t border-white/5">{children}</div>}
    </div>
  );
};

export const Segmented: React.FC<{
  label: string;
  value: string;
  options: readonly { value: string; label: string; hint?: string; disabled?: boolean }[];
  onChange: (v: string) => void;
  docRef?: string;
}> = ({ label, value, options, onChange, docRef }) => (
  <div>
    <div className="flex items-baseline justify-between mb-1">
      <span className="text-[11px] text-gray-400">{label}</span>
      {docRef && <span className="text-[10px] text-gray-600">{docRef}</span>}
    </div>
    <div className="flex flex-wrap gap-1">
      {options.map((o) => (
        <button
          key={o.value}
          disabled={o.disabled}
          title={o.hint}
          onClick={() => onChange(o.value)}
          className={cn(
            'px-2 py-1 rounded text-[11px] border transition-colors',
            value === o.value
              ? 'bg-purple-500/25 border-purple-400/60 text-purple-100'
              : 'bg-white/5 border-white/10 text-gray-400 hover:bg-white/10',
            o.disabled && 'opacity-35 cursor-not-allowed',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  </div>
);

export const SliderRow: React.FC<{
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  onChange: (v: number) => void;
  docRef?: string;
}> = ({ label, value, min, max, step = 1, unit = '', onChange, docRef }) => (
  <div>
    <div className="flex items-baseline justify-between mb-0.5">
      <span className="text-[11px] text-gray-400">{label}</span>
      <span className="text-[11px] text-purple-300 font-mono">
        {value}
        {unit}
        {docRef && <span className="text-gray-600 ml-2">{docRef}</span>}
      </span>
    </div>
    <input
      type="range"
      className="w-full h-1.5"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
    />
  </div>
);

export const ToggleRow: React.FC<{
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  docRef?: string;
}> = ({ label, checked, onChange, docRef }) => (
  <label className="flex items-center justify-between cursor-pointer">
    <span className="text-[11px] text-gray-400">
      {label}
      {docRef && <span className="text-gray-600 ml-1.5 text-[10px]">{docRef}</span>}
    </span>
    <button
      onClick={() => onChange(!checked)}
      className={cn('w-8 h-4.5 rounded-full relative transition-colors h-[18px]', checked ? 'bg-purple-500' : 'bg-white/15')}
    >
      <span
        className={cn('absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white transition-all', checked ? 'left-[18px]' : 'left-[2px]')}
      />
    </button>
  </label>
);

export const Hint: React.FC<{ children: ReactNode }> = ({ children }) => (
  <div className="text-[10px] leading-4 text-gray-500 border-l-2 border-purple-500/30 pl-2">{children}</div>
);

export const StatRow: React.FC<{ label: string; value: ReactNode; tone?: 'ok' | 'warn' | 'bad' | 'plain' }> = ({ label, value, tone = 'plain' }) => (
  <div className="flex items-center justify-between text-[11px]">
    <span className="text-gray-500">{label}</span>
    <span
      className={cn(
        'font-mono',
        tone === 'ok' && 'text-emerald-400',
        tone === 'warn' && 'text-amber-400',
        tone === 'bad' && 'text-red-400',
        tone === 'plain' && 'text-gray-200',
      )}
    >
      {value}
    </span>
  </div>
);
