import React from 'react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export type TransportMode = 'idle' | 'countin' | 'recording' | 'playing';

type TransportBarProps = {
  mode: TransportMode;
  totalSteps: number;
  activeStep: number | null;
  countInBeat: number | null;
  detectText?: string;
  phaseLabel?: string;
  phaseSummary?: string;
};

const TransportBar: React.FC<TransportBarProps> = ({ mode, totalSteps, activeStep, countInBeat, detectText, phaseLabel, phaseSummary }) => {
  const label =
    mode === 'countin' ? '预备拍' : mode === 'recording' ? '录入中' : mode === 'playing' ? '播放中' : '空闲';

  return (
    <div className="w-full max-w-6xl">
      <div className="flex items-center gap-4 bg-white/60 backdrop-blur-sm px-5 py-3 rounded-2xl border border-[#EFEBE1]">
        <div className="text-sm text-[#5D4037] min-w-[56px]" style={{ fontFamily: '"Kaiti SC", "STKaiti", "KaiTi", "楷体", serif' }}>{label}</div>

        <div className="flex items-center gap-1.5">
          {Array.from({ length: 4 }).map((_, i) => {
            const on = mode === 'countin' && countInBeat !== null && i <= countInBeat - 1;
            const active = mode === 'countin' && countInBeat !== null && i === countInBeat - 1;
            return (
              <div
                key={`countin-${i}`}
                className={cn(
                  'w-2.5 h-2.5 rounded-full border',
                  on ? 'bg-[#C2410C] border-[#C2410C]' : 'bg-transparent border-[#D7CCC8]',
                  active ? 'scale-125' : 'scale-100'
                )}
                style={{ transition: 'transform 120ms ease' }}
              />
            );
          })}
        </div>

        <div className="h-6 w-px bg-[#EFEBE1]" />

        <div className="flex-1 flex items-center gap-1">
          {Array.from({ length: totalSteps }).map((_, i) => {
            const isActive = activeStep !== null && i === activeStep && (mode === 'recording' || mode === 'playing');
            const isOn = activeStep !== null && i <= activeStep && mode === 'playing';
            return (
              <div
                key={`step-${i}`}
                className={cn(
                  'flex-1 h-2 rounded-sm border',
                  isOn ? 'bg-[#2D1B15] border-[#2D1B15]' : 'bg-transparent border-[#D7CCC8]',
                  isActive ? 'scale-y-150' : 'scale-y-100'
                )}
                style={{ transition: 'transform 120ms ease' }}
              />
            );
          })}
        </div>

        <div className="text-xs text-[#8D6E63] min-w-[180px] text-right" style={{ fontFamily: '"Kaiti SC", "STKaiti", "KaiTi", "楷体", serif' }}>
          {mode === 'recording' ? detectText : mode === 'playing' ? (phaseLabel || phaseSummary || '') : ''}
        </div>
      </div>
    </div>
  );
};

export default TransportBar;
