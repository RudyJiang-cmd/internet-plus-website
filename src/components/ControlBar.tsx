import React from 'react';
import { RotateCcw, Sparkles, Play, Square, Mic } from 'lucide-react';
import { motion } from 'framer-motion';

type ControlBarProps = {
  onHarmonize: () => void;
  onClear: () => void;
  onPlay: () => void;
  onRecord: () => void;
  isGenerating: boolean;
  isPlaying: boolean;
  isCountingIn: boolean;
  isRecording: boolean;
  aiEnabled: boolean;
};

const ControlBar: React.FC<ControlBarProps> = ({
  onHarmonize,
  onClear,
  onPlay,
  onRecord,
  isGenerating,
  isPlaying,
  isCountingIn,
  isRecording,
  aiEnabled,
}) => {
  return (
    <div className="flex flex-wrap items-center gap-4 bg-white/80 backdrop-blur-sm p-4 rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-[#EFEBE1]">
      <motion.button
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        onClick={onPlay}
        disabled={isCountingIn || isRecording}
        className="flex items-center justify-center w-12 h-12 bg-[#2D1B15] text-white rounded-full shadow-md transition-colors hover:bg-[#3E2723] disabled:opacity-60 disabled:hover:bg-[#2D1B15]"
        aria-label={isPlaying ? "停止" : "播放主旋律"}
      >
        {isPlaying ? (
          <Square className="w-5 h-5 fill-current" />
        ) : (
          <Play className="w-6 h-6 fill-current translate-x-0.5" />
        )}
      </motion.button>

      <motion.button
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        onClick={onRecord}
        className={
          isRecording
            ? "flex items-center justify-center w-12 h-12 bg-[#C2410C] text-white rounded-full shadow-md transition-colors"
            : "flex items-center justify-center w-12 h-12 bg-[#5D4037] text-white rounded-full shadow-md transition-colors hover:bg-[#3E2723]"
        }
        aria-label={isRecording ? "停止录音" : isCountingIn ? "预备拍中" : "哼唱录入"}
      >
        <Mic className={`w-5 h-5 ${isCountingIn || isRecording ? 'animate-pulse' : ''}`} />
      </motion.button>

      <motion.button
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        onClick={onHarmonize}
        disabled={!aiEnabled || isGenerating || isPlaying || isCountingIn || isRecording}
        title={aiEnabled ? '生成和声' : 'AI 生成服务暂时停用'}
        className="relative overflow-hidden group flex items-center gap-2 px-6 py-3 bg-[#2D1B15] text-white rounded-xl font-medium transition-colors disabled:opacity-70"
      >
        <Sparkles className={`w-5 h-5 ${isGenerating ? 'animate-spin' : ''}`} />
        <span>{!aiEnabled ? 'AI 服务已暂停' : isGenerating ? '正在生成和声...' : '生成和声'}</span>
        <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/20 to-transparent group-hover:animate-[shimmer_1.5s_infinite]" />
      </motion.button>

      <motion.button
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        onClick={onClear}
        disabled={isCountingIn || isRecording}
        className="flex items-center gap-2 px-5 py-3 text-[#5D4037] hover:bg-[#F5F2EA] rounded-xl font-medium transition-colors"
      >
        <RotateCcw className="w-4 h-4" />
        <span>清除</span>
      </motion.button>
      
      <div className="h-8 w-px bg-[#EFEBE1] mx-2" />
      
      <div className="flex items-center gap-4 text-sm" style={{ fontFamily: '"Kaiti SC", "STKaiti", "KaiTi", "楷体", serif' }}>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-full bg-[#6F3F1F] shadow-sm" />
          <span className="text-[#5D4037]">笛子主旋律</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-full bg-[#8F4D24] shadow-sm" />
          <span className="text-[#5D4037]">箫</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-full bg-[#9B6B2A] shadow-sm" />
          <span className="text-[#5D4037]">琵琶</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-full bg-[#2F4D52] shadow-sm" />
          <span className="text-[#5D4037]">都塔尔低音</span>
        </div>
      </div>

    </div>
  );
};

export default ControlBar;
