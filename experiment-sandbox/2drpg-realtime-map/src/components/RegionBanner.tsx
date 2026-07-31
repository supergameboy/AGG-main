/**
 * 区域切换横幅（镜像模块5 §2.2 BannerStateManager + RegionBanner 组件）
 * 状态机：idle → showing(200ms) → visible(1600ms) → hiding(200ms) → idle
 * 约束：pointer-events: none（不阻塞玩家操作 §2.2.4）、防抖（连续跨区域仅显示最后一次 §3.2.3）
 */

import React, { useEffect, useState } from 'react';
import { useMapStore } from '@/stores/mapStore';
import { REGION_DECOR } from '@/types/tile-map';

type Phase = 'idle' | 'showing' | 'visible' | 'hiding';

export const RegionBanner: React.FC = () => {
  const banner = useMapStore((s) => s.banner);
  const [phase, setPhase] = useState<Phase>('idle');
  const [current, setCurrent] = useState(banner);

  useEffect(() => {
    if (!banner) return;
    // 防抖：新请求重置计时器（§3.2.3）
    setCurrent(banner);
    setPhase('showing');
    const t1 = window.setTimeout(() => setPhase('visible'), 200);
    const t2 = window.setTimeout(() => setPhase('hiding'), 1800);
    const t3 = window.setTimeout(() => setPhase('idle'), 2000);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.clearTimeout(t3);
    };
  }, [banner]);

  if (phase === 'idle' || !current) return null;
  const decor = REGION_DECOR[current.regionType];

  return (
    <div className="absolute inset-x-0 top-[22%] z-30 flex justify-center pointer-events-none" aria-live="polite">
      <div
        className={phase === 'hiding' ? 'sb-banner-out' : 'sb-banner-in'}
        style={{
          padding: '14px 42px',
          background: 'linear-gradient(180deg, rgba(8,8,16,0.88), rgba(8,8,16,0.72))',
          border: `1px solid ${decor.borderColor}66`,
          borderTop: `3px solid ${decor.borderColor}`,
          borderRadius: 4,
          boxShadow: `0 0 32px ${decor.borderColor}44, inset 0 0 24px rgba(0,0,0,0.6)`,
          textAlign: 'center',
        }}
      >
        <div style={{ fontSize: 13, letterSpacing: 4, color: '#9a92b8', marginBottom: 4 }}>
          {current.fromName ? `${current.fromName} →` : '进入区域'}
        </div>
        <div style={{ fontSize: 30, fontWeight: 700, letterSpacing: 8, color: '#efeaff', textShadow: `0 0 18px ${decor.borderColor}` }}>
          {decor.icon} {current.regionName} {decor.icon}
        </div>
      </div>
    </div>
  );
};

export default RegionBanner;
