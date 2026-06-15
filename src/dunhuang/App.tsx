import { useEffect, useMemo, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowLeft,
  ChevronRight,
  Music4,
  RotateCcw,
  Sparkles,
  Volume2,
} from 'lucide-react';
import { AI_DISABLED_MESSAGE, AI_ENABLED } from '../lib/aiConfig';

type WindowWithWebkitAudio = Window & {
  webkitAudioContext?: typeof AudioContext;
};

type MicrophonePermissionDescriptor = PermissionDescriptor & {
  name: 'microphone';
};

type Stage = 'intro' | 'input' | 'capture' | 'compose' | 'survey' | 'done';
type InputMode = 'humming' | 'preset';
type CapturePhase = 'idle' | 'precount' | 'countin' | 'recording';

type SurveyState = Record<string, number>;
type TrackVoice = 'user' | 'xiao' | 'pipa' | 'guqin';

type TrackSynth = {
  type: OscillatorType;
  gain: number;
  attack: number;
  release: number;
  transpose: number;
  pan: number;
};

type Preset = {
  id: string;
  name: string;
  tone: string;
};

type Track = {
  id: string;
  label: string;
  color: string;
  voice: TrackVoice;
  notes: Array<number | null>;
};

type BackendNote = {
  step: number;
  pitch: number;
  duration?: number;
  voice: string;
};

type BackendResponse = {
  status?: string;
  lead_notes?: BackendNote[];
  generated_notes?: BackendNote[];
};

type BackendHealthResponse = {
  status?: string;
  model_loaded?: boolean;
  error?: string;
};

const PRESETS: Preset[] = [
  { id: 'molihua', name: '茉莉花', tone: '温柔、清亮、最容易上手' },
  { id: 'lanhuacao', name: '兰花草', tone: '轻柔、明亮、带一点民歌感' },
  { id: 'xuanzu', name: '沂蒙山小调', tone: '明快、热烈、节奏感更强' },
];

const DEFAULT_LEADER_NOTES = [9, 9, 8, 8, 7, 7, 8, null, 9, 9, 8, 8, 7, 5, 8, null];
const MOLIHUA_LEADER_NOTES = [5, 6, 5, 3, 2, 3, 0, 2, 3, null, 3, 2, 3, null, null, null];
const LANHUACAO_LEADER_NOTES = [9, 5, 5, 5, 5, null, null, 6, 7, 6, 7, 8, 9, null, null, null];
const XUANZU_LEADER_NOTES = [6, null, 3, null, 5, 6, 5, null, 3, 5, 6, 7, 6, null, null, null];

const buildTrackLibrary = (
  leaderNotes: Array<number | null>,
  generatedTracks: Partial<Record<TrackVoice, Array<number | null>>> = {}
): Track[] => [
  { id: 'leader', label: '笛子主旋律', color: '#6f3f1f', voice: 'user', notes: leaderNotes },
  ...(generatedTracks.xiao ? [{ id: 'lead', label: '箫织体', color: '#8f4d24', voice: 'xiao' as TrackVoice, notes: generatedTracks.xiao }] : []),
  ...(generatedTracks.pipa ? [{ id: 'middle', label: '琵琶织体', color: '#9b6b2a', voice: 'pipa' as TrackVoice, notes: generatedTracks.pipa }] : []),
  ...(generatedTracks.guqin ? [{ id: 'low', label: '都塔尔踏板', color: '#2f4d52', voice: 'guqin' as TrackVoice, notes: generatedTracks.guqin }] : []),
];

const surveyItems = [
  { id: 'dunhuang', label: '像敦煌' },
  { id: 'clarity', label: '轨道清楚' },
  { id: 'input', label: '输入顺手' },
  { id: 'return', label: '愿意再来' },
];

const stageOrder: Stage[] = ['intro', 'input', 'capture', 'compose', 'survey', 'done'];

const stageLabel: Record<Stage, string> = {
  intro: '知悉',
  input: '取样',
  capture: '采声',
  compose: '织谱',
  survey: '回声',
  done: '完成',
};

const motionEase = [0.22, 1, 0.36, 1] as const;

const buttonBase =
  'inline-flex items-center justify-center gap-2 rounded-lg px-4 py-3 text-sm font-medium transition-colors duration-200';

const introPresets = [
  '使用 茉莉花 作为预设',
  '使用 兰花草 作为预设',
  '使用 沂蒙山小调 作为预设',
];

const CAPTURE_BPM = 160;
const CAPTURE_BEAT_MS = (60_000 / CAPTURE_BPM);
const CAPTURE_COUNT_IN_BEATS = 8;
const CAPTURE_BARS = 4;
const CAPTURE_BEATS_PER_BAR = 4;
const CAPTURE_TOTAL_BEATS = CAPTURE_BARS * CAPTURE_BEATS_PER_BAR;
const CAPTURE_LATENCY_COMPENSATION_MS = 260;
const CAPTURE_TAIL_MS = 450;
const MIN_DETECT_FREQ = 70;
const MAX_DETECT_FREQ = 1100;
const AI_API_URL = import.meta.env.VITE_AI_API_URL ?? '/api/generate';
const AI_HEALTH_URL = import.meta.env.VITE_AI_HEALTH_URL ?? '/api/health';
const AI_REQUEST_TIMEOUT_MS = 15000;
const AI_HEALTH_TIMEOUT_MS = 5000;

const PITCH_TO_MIDI: Record<number, number> = {
  14: 60,
  13: 62,
  12: 64,
  11: 66,
  10: 67,
  9: 69,
  8: 71,
  7: 72,
  6: 74,
  5: 76,
  4: 78,
  3: 79,
  2: 81,
  1: 83,
  0: 84,
};

const ALLOWED_PITCHES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];

const TRACK_SYNTHS: Record<TrackVoice, TrackSynth> = {
  user: {
    type: 'triangle',
    gain: 0.2,
    attack: 0.012,
    release: 0.12,
    transpose: -12,
    pan: -0.15,
  },
  xiao: {
    type: 'triangle',
    gain: 0.1,
    attack: 0.018,
    release: 0.11,
    transpose: 0,
    pan: -0.25,
  },
  pipa: {
    type: 'sawtooth',
    gain: 0.12,
    attack: 0.006,
    release: 0.045,
    transpose: -12,
    pan: 0.05,
  },
  guqin: {
    type: 'sine',
    gain: 0.14,
    attack: 0.01,
    release: 0.16,
    transpose: -24,
    pan: 0.3,
  },
};

const getComposeTitle = (trackCount: number) => {
  if (trackCount <= 1) return '正在勾勒西域旋律';
  if (trackCount === 2) return '箫声入场';
  if (trackCount === 3) return '琵琶加入乐队';
  return '都塔尔低音已经完成和声';
};

const getCountInProgress = (phase: CapturePhase, countdown: number) => {
  if (phase === 'recording') return CAPTURE_COUNT_IN_BEATS;
  if (phase !== 'countin') return 0;
  return CAPTURE_COUNT_IN_BEATS - countdown + 1;
};

const snapToDunhuangPitch = (rawPitch: number) => {
  const pitch = Math.round(rawPitch);
  if (ALLOWED_PITCHES.includes(pitch)) return pitch;

  let closest = ALLOWED_PITCHES[0];
  let minDiff = Math.abs(pitch - closest);
  for (const allowedPitch of ALLOWED_PITCHES) {
    const diff = Math.abs(pitch - allowedPitch);
    if (diff < minDiff) {
      minDiff = diff;
      closest = allowedPitch;
    }
  }
  return closest;
};

const median = (values: number[]) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) return (sorted[mid - 1] + sorted[mid]) / 2;
  return sorted[mid];
};

const freqToMidi = (frequency: number) => 69 + 12 * Math.log2(frequency / 440);

const midiToNoteName = (midi: number) => {
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const roundedMidi = Math.round(midi);
  const name = names[((roundedMidi % 12) + 12) % 12];
  const octave = Math.floor(roundedMidi / 12) - 1;
  return `${name}${octave}`;
};

const midiToPitchIndex = (midi: number, midiOffset = 0) => {
  let bestPitchIndex = 0;
  let bestDiff = Infinity;
  for (const [pitchIndexText, baseMidi] of Object.entries(PITCH_TO_MIDI)) {
    const pitchIndex = Number(pitchIndexText);
    const diff = Math.abs(midi - (baseMidi + midiOffset));
    if (diff < bestDiff) {
      bestDiff = diff;
      bestPitchIndex = pitchIndex;
    }
  }
  return bestPitchIndex;
};

const getRms = (buffer: Float32Array) => {
  let rms = 0;
  for (let index = 0; index < buffer.length; index += 1) {
    rms += buffer[index] * buffer[index];
  }
  return Math.sqrt(rms / buffer.length);
};

const detectPitchYin = (buffer: Float32Array, sampleRate: number) => {
  const rms = getRms(buffer);
  if (rms < 0.008) return null;

  const minTau = Math.max(2, Math.floor(sampleRate / MAX_DETECT_FREQ));
  const maxTau = Math.min(buffer.length - 2, Math.ceil(sampleRate / MIN_DETECT_FREQ));
  const threshold = 0.13;
  const yin = new Float32Array(maxTau + 1);

  for (let tau = 1; tau <= maxTau; tau += 1) {
    let sum = 0;
    for (let index = 0; index < buffer.length - tau; index += 1) {
      const delta = buffer[index] - buffer[index + tau];
      sum += delta * delta;
    }
    yin[tau] = sum;
  }

  let runningSum = 0;
  yin[0] = 1;
  for (let tau = 1; tau <= maxTau; tau += 1) {
    runningSum += yin[tau];
    yin[tau] = runningSum > 0 ? (yin[tau] * tau) / runningSum : 1;
  }

  let tauEstimate = -1;
  for (let tau = minTau; tau <= maxTau; tau += 1) {
    if (yin[tau] < threshold) {
      while (tau + 1 <= maxTau && yin[tau + 1] < yin[tau]) tau += 1;
      tauEstimate = tau;
      break;
    }
  }

  if (tauEstimate < 0) {
    let bestTau = minTau;
    let bestValue = yin[minTau];
    for (let tau = minTau + 1; tau <= maxTau; tau += 1) {
      if (yin[tau] < bestValue) {
        bestValue = yin[tau];
        bestTau = tau;
      }
    }
    if (bestValue > 0.2) return null;
    tauEstimate = bestTau;
  }

  const betterTau = (() => {
    const previous = yin[tauEstimate - 1] ?? yin[tauEstimate];
    const current = yin[tauEstimate];
    const next = yin[tauEstimate + 1] ?? yin[tauEstimate];
    const divisor = 2 * (2 * current - next - previous);
    if (divisor === 0) return tauEstimate;
    return tauEstimate + (next - previous) / divisor;
  })();

  const frequency = sampleRate / betterTau;
  if (!Number.isFinite(frequency) || frequency < MIN_DETECT_FREQ || frequency > MAX_DETECT_FREQ) return null;
  return frequency;
};

const autoCorrelate = (buffer: Float32Array, sampleRate: number) => {
  const size = buffer.length;
  const rms = getRms(buffer);
  if (rms < 0.01) return null;

  let r1 = 0;
  let r2 = size - 1;
  const threshold = 0.2;
  for (let index = 0; index < size / 2; index += 1) {
    if (Math.abs(buffer[index]) < threshold) {
      r1 = index;
      break;
    }
  }
  for (let index = 1; index < size / 2; index += 1) {
    if (Math.abs(buffer[size - index]) < threshold) {
      r2 = size - index;
      break;
    }
  }

  const trimmed = buffer.slice(r1, r2);
  const trimmedSize = trimmed.length;
  const correlations = new Array(trimmedSize).fill(0);
  for (let index = 0; index < trimmedSize; index += 1) {
    for (let offset = 0; offset < trimmedSize - index; offset += 1) {
      correlations[index] += trimmed[offset] * trimmed[offset + index];
    }
  }

  let start = 0;
  while (correlations[start] > correlations[start + 1]) start += 1;

  let maxValue = -1;
  let maxIndex = -1;
  for (let index = start; index < trimmedSize; index += 1) {
    if (correlations[index] > maxValue) {
      maxValue = correlations[index];
      maxIndex = index;
    }
  }
  if (maxIndex <= 0) return null;

  const before = correlations[maxIndex - 1];
  const center = correlations[maxIndex];
  const after = correlations[maxIndex + 1];
  const a = (before + after - 2 * center) / 2;
  const b = (after - before) / 2;
  const shift = a ? b / (2 * a) : 0;
  const period = maxIndex + shift;

  if (!Number.isFinite(period) || period <= 0) return null;
  return sampleRate / period;
};

const detectPitch = (buffer: Float32Array, sampleRate: number) => {
  const yinFrequency = detectPitchYin(buffer, sampleRate);
  if (yinFrequency) return yinFrequency;

  const correlationFrequency = autoCorrelate(buffer, sampleRate);
  if (!correlationFrequency || correlationFrequency < MIN_DETECT_FREQ || correlationFrequency > MAX_DETECT_FREQ) return null;
  return correlationFrequency;
};

const chooseOctaveShift = (midis: number[]) => {
  const melodyCenter = median(midis);
  if (melodyCenter === null) return 0;

  const scoreMidis = Object.values(PITCH_TO_MIDI);
  const scoreCenter = (Math.min(...scoreMidis) + Math.max(...scoreMidis)) / 2;
  const shift = Math.round((scoreCenter - melodyCenter) / 12) * 12;
  return Math.max(-36, Math.min(36, shift));
};

const buildLeaderNotesFromBuckets = (buckets: number[][]): Array<number | null> => {
  const minMidi = Math.min(...Object.values(PITCH_TO_MIDI));
  const maxMidi = Math.max(...Object.values(PITCH_TO_MIDI));
  const octaveShift = chooseOctaveShift(buckets.flat());
  return buckets.map((bucket) => {
    if (bucket.length < 2) return null;
    const roundedMidiBuckets = new Map<number, number[]>();
    bucket.forEach((midi) => {
      const rounded = Math.round(midi);
      roundedMidiBuckets.set(rounded, [...(roundedMidiBuckets.get(rounded) ?? []), midi]);
    });
    const strongestGroup = [...roundedMidiBuckets.values()].sort((a, b) => b.length - a.length)[0] ?? [];
    const midi = median(strongestGroup);
    if (midi === null) return null;

    let shiftedMidi = midi + octaveShift;
    while (shiftedMidi < minMidi) shiftedMidi += 12;
    while (shiftedMidi > maxMidi) shiftedMidi -= 12;
    return snapToDunhuangPitch(midiToPitchIndex(shiftedMidi));
  });
};

const notesToBackendMelody = (notes: Array<number | null>) => {
  const melody = [];
  for (let step = 0; step < CAPTURE_TOTAL_BEATS; step += 1) {
    const pitch = notes[step];
    if (pitch === null || pitch === undefined) continue;
    melody.push({
      step,
      pitch,
      duration: getSustainedDuration(notes, step),
    });
  }
  return melody;
};

const backendNotesToTrackNotes = (notes: BackendNote[], voice: TrackVoice) => {
  const voiceMap: Record<string, TrackVoice> = {
    alto: 'xiao',
    tenor: 'pipa',
    bass: 'guqin',
    xiao: 'xiao',
    pipa: 'pipa',
    guqin: 'guqin',
    dutar: 'guqin',
    'dutar-bass': 'guqin',
    user: 'user',
  };
  const trackNotes: Array<number | null> = Array.from({ length: CAPTURE_TOTAL_BEATS }, () => null);
  notes
    .filter((note) => voiceMap[note.voice] === voice)
    .forEach((note) => {
      const step = Math.max(0, Math.min(CAPTURE_TOTAL_BEATS - 1, Math.round(note.step)));
      trackNotes[step] = snapToDunhuangPitch(Math.round(note.pitch));
    });
  return trackNotes;
};

const GUQIN_RHYTHM_GROUPS: Array<[number, number]> = [
  [0, 3],
  [3, 3],
  [6, 2],
  [8, 3],
  [11, 3],
  [14, 2],
];

const quantizeGuqinRhythm = (
  notes: Array<number | null>,
  leaderNotes: Array<number | null> = []
) => {
  const quantized = Array.from({ length: CAPTURE_TOTAL_BEATS }, () => null as number | null);
  const sourcePitchByGroup = new Map<number, number>();

  GUQIN_RHYTHM_GROUPS.forEach(([start, duration]) => {
    let chosenPitch: number | null = null;
    for (let step = start; step < Math.min(CAPTURE_TOTAL_BEATS, start + duration); step += 1) {
      const note = notes[step];
      if (note !== null && note !== undefined) {
        chosenPitch = note;
        break;
      }
    }
    if (chosenPitch === null) {
      const leaderNote = leaderNotes[start];
      if (leaderNote !== null && leaderNote !== undefined) {
        chosenPitch = snapToDunhuangPitch(leaderNote + 9);
      }
    }
    if (chosenPitch === null) {
      const previousPitches = [...sourcePitchByGroup.values()];
      const previousPitch = previousPitches[previousPitches.length - 1];
      if (previousPitch !== undefined) {
        chosenPitch = previousPitch;
      }
    }
    if (chosenPitch === null) return;
    sourcePitchByGroup.set(start, chosenPitch);
    for (let step = start; step < Math.min(CAPTURE_TOTAL_BEATS, start + duration); step += 1) {
      quantized[step] = chosenPitch;
    }
  });

  for (let step = 0; step < CAPTURE_TOTAL_BEATS; step += 1) {
    if (quantized[step] !== null) continue;
    const group = [...GUQIN_RHYTHM_GROUPS].reverse().find(([start]) => step >= start);
    if (!group) continue;
    const [groupStart, groupDuration] = group;
    const pitch = sourcePitchByGroup.get(groupStart);
    if (pitch === undefined) continue;
    if (step < groupStart + groupDuration) {
      quantized[step] = pitch;
    }
  }

  return quantized;
};

const hasPlayableNotes = (notes: Array<number | null> | undefined) =>
  Boolean(notes?.some((note) => note !== null && note !== undefined));

const deriveFallbackTrack = (
  leaderNotes: Array<number | null>,
  generatedTracks: Partial<Record<TrackVoice, Array<number | null>>>,
  voice: Exclude<TrackVoice, 'user'>
) => {
  const voiceOffsets: Record<Exclude<TrackVoice, 'user'>, number> = {
    xiao: 2,
    pipa: 5,
    guqin: 9,
  };
  const source =
    generatedTracks.pipa ??
    generatedTracks.xiao ??
    generatedTracks.guqin ??
    leaderNotes;
  return source.map((note, index) => {
    const sourceNote = note ?? leaderNotes[index];
    if (sourceNote === null || sourceNote === undefined) return null;
    return snapToDunhuangPitch(sourceNote + voiceOffsets[voice]);
  });
};

const completeGeneratedTracks = (
  leaderNotes: Array<number | null>,
  generatedTracks: Partial<Record<TrackVoice, Array<number | null>>>
) => {
  const completed = { ...generatedTracks };
  if (completed.guqin) {
    completed.guqin = quantizeGuqinRhythm(completed.guqin, leaderNotes);
  }
  (['xiao', 'pipa', 'guqin'] as const).forEach((voice) => {
    if (!hasPlayableNotes(completed[voice])) {
      completed[voice] = deriveFallbackTrack(leaderNotes, completed, voice);
    }
  });
  completed.guqin = quantizeGuqinRhythm(completed.guqin ?? deriveFallbackTrack(leaderNotes, completed, 'guqin'), leaderNotes);
  return completed as Record<Exclude<TrackVoice, 'user'>, Array<number | null>>;
};

const getSustainedDuration = (notes: Array<number | null>, step: number) => {
  const measureEnd = Math.floor(step / CAPTURE_BEATS_PER_BAR) * CAPTURE_BEATS_PER_BAR + CAPTURE_BEATS_PER_BAR;
  for (let nextStep = step + 1; nextStep < measureEnd; nextStep += 1) {
    const nextNote = notes[nextStep % notes.length];
    if (nextNote !== null && nextNote !== undefined) {
      return nextStep - step;
    }
  }
  return measureEnd - step;
};

const formatRecordErrorMessage = (error: unknown) => {
  if (!window.isSecureContext) {
    return '当前页面不是安全上下文，浏览器会禁用麦克风。录音功能需要 HTTPS，或在 localhost 下访问。';
  }

  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
      return '当前页面的麦克风权限被拒绝了。请在地址栏的权限图标里把麦克风改为允许，然后再点开始录音。';
    }
    if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
      return '没有检测到可用的麦克风设备。请确认麦克风已连接并可被系统识别。';
    }
    if (error.name === 'NotReadableError' || error.name === 'TrackStartError') {
      return '麦克风当前被其他应用占用，或系统暂时无法读取音频输入。';
    }
    if (error.name === 'SecurityError') {
      return '浏览器安全策略阻止了录音。通常需要 HTTPS 环境和麦克风权限。';
    }
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    return '当前浏览器环境不支持麦克风录音，或页面不是 HTTPS / localhost。';
  }

  return '录音启动失败。请检查麦克风权限、浏览器安全设置，以及是否通过 HTTPS 访问页面。';
};

const scheduleTrackTone = (
  ctx: AudioContext,
  track: Track,
  step: number,
  noteStartTime: number,
  beatDuration: number
) => {
  const pitch = track.notes[step % track.notes.length];
  if (pitch === null || pitch === undefined) return;
  const midi = PITCH_TO_MIDI[Math.round(pitch)];
  if (midi === undefined) return;

  const synth = TRACK_SYNTHS[track.voice];
  const transposedMidi = midi + synth.transpose;
  const frequency = 440 * Math.pow(2, (transposedMidi - 69) / 12);
  const noteEndTime = noteStartTime + beatDuration * getSustainedDuration(track.notes, step) * 0.92;

  const oscillator = ctx.createOscillator();
  const overtoneOsc = ctx.createOscillator();
  const filter = ctx.createBiquadFilter();
  const gainNode = ctx.createGain();
  const outputNode = typeof ctx.createStereoPanner === 'function' ? ctx.createStereoPanner() : null;

  oscillator.type = synth.type;
  overtoneOsc.type = synth.type === 'sine' ? 'triangle' : 'sawtooth';
  oscillator.frequency.setValueAtTime(frequency, noteStartTime);
  overtoneOsc.frequency.setValueAtTime(frequency * 2.01, noteStartTime);
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(Math.max(900, frequency * 4.2), noteStartTime);
  filter.Q.value = 0.9;

  gainNode.gain.setValueAtTime(0, noteStartTime);
  gainNode.gain.linearRampToValueAtTime(synth.gain, noteStartTime + synth.attack);
  gainNode.gain.setValueAtTime(synth.gain, Math.max(noteStartTime + synth.attack, noteEndTime - synth.release));
  gainNode.gain.linearRampToValueAtTime(0, noteEndTime);

  oscillator.connect(filter);
  overtoneOsc.connect(filter);
  filter.connect(gainNode);
  if (outputNode) {
    outputNode.pan.setValueAtTime(synth.pan, noteStartTime);
    gainNode.connect(outputNode);
    outputNode.connect(ctx.destination);
  } else {
    gainNode.connect(ctx.destination);
  }

  oscillator.start(noteStartTime);
  overtoneOsc.start(noteStartTime);
  oscillator.stop(noteEndTime);
  overtoneOsc.stop(noteEndTime);
};

const MOBILE_STAFF_LINES = [4, 6, 8, 10, 12];
const MOBILE_CELL_HEIGHT = 6;
const MOBILE_TOTAL_STEPS = 16;
const MOBILE_TOTAL_PITCHES = 15;
const MOBILE_SCORE_LEFT_PAD = 62;
const MOBILE_SCORE_RIGHT_PAD = 12;
const MOBILE_CELL_WIDTH = 16.56;
const MOBILE_NOTE_BOX_WIDTH = 28;
const MOBILE_NOTE_BOX_HEIGHT = 38;
const MOBILE_STEM_HEIGHT = 23;
const MOBILE_SCORE_SCALE = 0.86;

const needsSharp = (pitch: number) => {
  const roundedPitch = Math.round(pitch);
  return roundedPitch === 4 || roundedPitch === 11;
};

const getMobileNoteCenterX = (step: number) => MOBILE_SCORE_LEFT_PAD + step * MOBILE_CELL_WIDTH + MOBILE_CELL_WIDTH / 2;
const getMobileNoteCenterY = (pitch: number) => pitch * MOBILE_CELL_HEIGHT + MOBILE_CELL_HEIGHT / 2;
const getMobileStemDirection = (pitch: number) => (Math.round(pitch) <= 8 ? 'down' : 'up');

function MiniNoteGlyph({
  pitch,
  color,
}: {
  pitch: number;
  color: string;
}) {
  const stemDown = getMobileStemDirection(pitch) === 'down';
  const cx = MOBILE_NOTE_BOX_WIDTH / 2;
  const cy = MOBILE_NOTE_BOX_HEIGHT / 2;
  const rx = 6.2;
  const ry = 3.9;
  const stemX = stemDown ? cx - rx + 1.5 : cx + rx - 1.5;
  const stemY1 = stemDown ? cy + 1 : cy - MOBILE_STEM_HEIGHT + 3;
  const stemY2 = stemDown ? cy + MOBILE_STEM_HEIGHT - 2 : cy - 1;

  return (
    <svg
      className="absolute inset-0 overflow-visible"
      width={MOBILE_NOTE_BOX_WIDTH}
      height={MOBILE_NOTE_BOX_HEIGHT}
      viewBox={`0 0 ${MOBILE_NOTE_BOX_WIDTH} ${MOBILE_NOTE_BOX_HEIGHT}`}
      aria-hidden="true"
    >
      <ellipse
        cx={cx}
        cy={cy}
        rx={rx}
        ry={ry}
        fill={color}
        stroke={color}
        strokeWidth="1.1"
        transform={`rotate(-18 ${cx} ${cy})`}
      />
      <line
        x1={stemX}
        x2={stemX}
        y1={stemY1}
        y2={stemY2}
        stroke={color}
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

function OrnamentalFrame({ children }: { children: ReactNode }) {
  return (
    <div className="fixed inset-0 bg-[#1f1f1d] px-4 py-5 text-[#4a2d1f]">
      <main className="mx-auto flex h-full w-full max-w-[390px] flex-col overflow-hidden border-t-4 border-[#9e6530] bg-[#fcf4dd] shadow-none">
        {children}
      </main>
    </div>
  );
}

function Pill({ active, children }: { active?: boolean; children: ReactNode }) {
  return (
    <span
      className={[
        'inline-flex items-center rounded-full border px-3 py-1 text-[11px] tracking-wide',
        active ? 'border-[#8b4d24] bg-[#8b4d24] text-[#fff6e7]' : 'border-[#cda66e] bg-[#fff7ea]/85 text-[#7b4a30]',
      ].join(' ')}
    >
      {children}
    </span>
  );
}

function PrimaryButton(props: ButtonHTMLAttributes<HTMLButtonElement> & { icon?: ReactNode }) {
  const { className = '', icon, children, ...rest } = props;
  return (
    <button
      {...rest}
      className={[
        buttonBase,
        'bg-[#4a2d1f] text-[#fff8ef] shadow-none active:translate-y-px disabled:opacity-50',
        className,
      ].join(' ')}
    >
      {icon}
      <span>{children}</span>
    </button>
  );
}

function GhostButton(props: ButtonHTMLAttributes<HTMLButtonElement> & { icon?: ReactNode }) {
  const { className = '', icon, children, ...rest } = props;
  return (
    <button
      {...rest}
      className={[
        buttonBase,
        'border border-[#d7b37a] bg-[#f8ebd1] text-[#6d3f27] active:translate-y-px disabled:opacity-50',
        className,
      ].join(' ')}
    >
      {icon}
      <span>{children}</span>
    </button>
  );
}

function StageRail({ stage }: { stage: Stage }) {
  const current = stageOrder.indexOf(stage);

  return (
    <div className="flex items-end justify-between px-2 pt-3 text-[11px] text-[#866448]">
      {stageOrder.slice(0, 5).map((item, index) => {
        const active = index === current;
        const done = index < current;
        return (
          <div key={item} className="flex w-full flex-col items-center gap-1">
            <span
              className={[
                'flex h-8 w-8 items-center justify-center rounded-full border text-[12px] font-semibold',
                done || active ? 'border-[#5f3728] bg-[#5f3728] text-[#fff7ea]' : 'border-[#d7b37a] bg-transparent text-[#b78f58]',
              ].join(' ')}
            >
              {done ? '✓' : index + 1}
            </span>
            <span className={active || done ? 'text-[#5f3e2d]' : 'text-[#b79c72]'}>{stageLabel[item]}</span>
          </div>
        );
      })}
    </div>
  );
}

function FreezeBar({
  title,
  stepLabelText,
  stage,
}: {
  title: string;
  stepLabelText: string;
  stage: Stage;
}) {
  return (
    <div className="shrink-0 border-b border-[#d8c08d] bg-[#fcf5e2] px-3 pb-2 pt-4">
      <div className="text-center text-[12px] tracking-[0.34em] text-[#b66c33]">{title}</div>
      <div className="mt-1.5 flex items-center justify-center text-[15px] text-[#5f3e2d]">
        <span>{stepLabelText}</span>
      </div>
      <div className="mt-0.5">
        <StageRail stage={stage} />
      </div>
    </div>
  );
}

function FreezeActions({
  leftLabel,
  rightLabel,
  leftIcon,
  rightIcon,
  onLeft,
  onRight,
  leftWidthClass = 'w-[96px]',
  rightWidthClass = 'flex-1',
}: {
  leftLabel: string;
  rightLabel: string;
  leftIcon: ReactNode;
  rightIcon: ReactNode;
  onLeft: () => void;
  onRight: () => void;
  leftWidthClass?: string;
  rightWidthClass?: string;
}) {
  return (
    <div className="shrink-0 border-t border-[#d8c08d] bg-[#fcf5e2] px-4 pb-3 pt-3">
      <div className={leftLabel ? 'flex gap-3' : 'flex'}>
        <GhostButton className={`h-[52px] rounded-[12px] text-[14px] ${leftWidthClass}`} icon={leftIcon} onClick={onLeft}>
          {leftLabel}
        </GhostButton>
        <PrimaryButton className={`h-[52px] rounded-[12px] text-[15px] ${rightWidthClass}`} icon={rightIcon} onClick={onRight}>
          {rightLabel}
        </PrimaryButton>
      </div>
    </div>
  );
}

function ScoreLane({
  label,
  color,
  notes,
  activeStep,
  notesVisible = true,
  delay = 0,
}: {
  label: string;
  color: string;
  notes: Array<number | null>;
  activeStep: number;
  notesVisible?: boolean;
  delay?: number;
}) {
  const scoreWidth = MOBILE_SCORE_LEFT_PAD + MOBILE_TOTAL_STEPS * MOBILE_CELL_WIDTH + MOBILE_SCORE_RIGHT_PAD;
  const scoreHeight = MOBILE_TOTAL_PITCHES * MOBILE_CELL_HEIGHT;
  const staffTop = MOBILE_STAFF_LINES[0] * MOBILE_CELL_HEIGHT + MOBILE_CELL_HEIGHT / 2 - 1;
  const staffHeight = (MOBILE_STAFF_LINES[MOBILE_STAFF_LINES.length - 1] - MOBILE_STAFF_LINES[0]) * MOBILE_CELL_HEIGHT + 2;

  return (
    <motion.div
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay, ease: motionEase }}
      className="rounded-lg border border-[#d8bd8d] bg-[#fff9f0]/90 px-2.5 py-2"
    >
      <div className="mb-1 flex items-center justify-between px-0.5 text-[11px] text-[#7a4d36]">
        <span className="font-medium">{label}</span>
      </div>
      <div className="relative mx-auto overflow-hidden rounded-md border border-[#e5cfaa] bg-[#fbf4e7]" style={{ width: '100%', height: 78 }}>
        <div
          className="absolute left-1/2 top-1/2"
          style={{
            width: scoreWidth,
            height: scoreHeight,
            transform: `translate(-50%, -50%) scale(${MOBILE_SCORE_SCALE})`,
            transformOrigin: 'center',
          }}
        >
          {MOBILE_STAFF_LINES.map((pitch) => (
            <span
              key={`staff-line-${pitch}`}
              className="absolute left-0 pointer-events-none"
              style={{
                top: pitch * MOBILE_CELL_HEIGHT + MOBILE_CELL_HEIGHT / 2 - 1,
                width: MOBILE_SCORE_LEFT_PAD + MOBILE_TOTAL_STEPS * MOBILE_CELL_WIDTH,
                borderTop: `1.4px solid ${color}`,
              }}
            />
          ))}

          <div
            className="absolute pointer-events-none z-10 flex items-center justify-center"
            style={{
              left: 2,
              top: staffTop - 6,
              width: 38,
              height: staffHeight,
              color,
            }}
          >
            <span
              className="select-none"
              style={{
                fontSize: 68,
                lineHeight: '1',
                fontFamily: '"Noto Music", Georgia, serif',
                opacity: 0.96,
                transform: 'scale(0.75)',
                transformOrigin: 'center center',
              }}
            >
              𝄞
            </span>
          </div>

          <span
            className="absolute pointer-events-none z-10 select-none flex items-center justify-center"
            style={{
              left: 39,
              top: staffTop + 4,
              width: 22,
              height: 18,
              color,
              fontSize: 34,
              lineHeight: '1',
              fontFamily: '"Baskerville","Times New Roman",serif',
              fontWeight: 700,
              transform: 'scaleX(0.82)',
            }}
          >
            4
          </span>
          <span
            className="absolute pointer-events-none z-10 select-none flex items-center justify-center"
            style={{
              left: 39,
              top: staffTop + 27,
              width: 22,
              height: 18,
              color,
              fontSize: 34,
              lineHeight: '1',
              fontFamily: '"Baskerville","Times New Roman",serif',
              fontWeight: 700,
              transform: 'scaleX(0.82)',
            }}
          >
            4
          </span>

          {Array.from({ length: MOBILE_TOTAL_STEPS / 4 + 1 }).map((_, index) => {
            if (index === 0 || index * 4 >= MOBILE_TOTAL_STEPS) return null;
            return (
              <span
                key={`bar-${index}`}
                className="absolute pointer-events-none z-10"
                style={{
                  left: MOBILE_SCORE_LEFT_PAD + index * 4 * MOBILE_CELL_WIDTH,
                  top: staffTop,
                  height: staffHeight,
                  borderLeft: `1.4px solid ${color}`,
                }}
              />
            );
          })}

          <span
            className="absolute pointer-events-none z-10"
            style={{
              left: MOBILE_SCORE_LEFT_PAD + MOBILE_TOTAL_STEPS * MOBILE_CELL_WIDTH - 9,
              top: staffTop,
              height: staffHeight,
              width: 1.4,
              backgroundColor: color,
            }}
          />
          <span
            className="absolute pointer-events-none z-10"
            style={{
              left: MOBILE_SCORE_LEFT_PAD + MOBILE_TOTAL_STEPS * MOBILE_CELL_WIDTH - 4,
              top: staffTop,
              height: staffHeight,
              width: 4,
              backgroundColor: color,
            }}
          />

          {[0, 1, 2, 3].map((index) => (
            <span
              key={`beat-${index}`}
              className="absolute pointer-events-none z-0 h-full rounded-md transition-colors"
              style={{
                left: MOBILE_SCORE_LEFT_PAD + index * 4 * MOBILE_CELL_WIDTH,
                top: 0,
                width: 4 * MOBILE_CELL_WIDTH,
                backgroundColor: index * 4 <= activeStep && activeStep < index * 4 + 4 ? 'rgba(139,77,36,0.06)' : 'transparent',
              }}
            />
          ))}

          {notesVisible && Array.from({ length: MOBILE_TOTAL_STEPS }).map((_, index) => {
            const note = notes[index % notes.length];
            if (note === null || note === undefined) return null;
            const left = getMobileNoteCenterX(index) - MOBILE_NOTE_BOX_WIDTH / 2;
            const top = getMobileNoteCenterY(note) - MOBILE_NOTE_BOX_HEIGHT / 2;
            return (
              <motion.div
                key={`${color}-${index}`}
                initial={{ opacity: 0, scale: 0.7, y: -5 }}
                animate={{
                  opacity: 1,
                  scale: index === activeStep ? [1, 1.16, 1] : 1,
                  y: 0,
                }}
                transition={{ duration: 0.18, ease: motionEase }}
                className="absolute pointer-events-none z-20"
                style={{
                  left,
                  top,
                  width: MOBILE_NOTE_BOX_WIDTH,
                  height: MOBILE_NOTE_BOX_HEIGHT,
                }}
              >
                {needsSharp(note) && (
                  <span
                    className="absolute font-bold"
                    style={{
                      color,
                      left: -4,
                      top: '50%',
                      transform: 'translateY(-58%)',
                      fontSize: 14,
                      fontFamily: '"Kaiti SC", "STKaiti", "KaiTi", "楷体", serif',
                    }}
                  >
                    ♯
                  </span>
                )}
                <MiniNoteGlyph pitch={note} color={color} />
              </motion.div>
            );
          })}
        </div>
      </div>
    </motion.div>
  );
}

function SurveyScale({
  value,
  onChange,
}: {
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="grid grid-cols-5 gap-2">
      {[1, 2, 3, 4, 5].map((item) => {
        const active = item === value;
        return (
          <button
            key={item}
            type="button"
            onClick={() => onChange(item)}
            className={[
              'rounded-lg border px-0 py-3 text-sm transition-colors',
              active ? 'border-[#8b4d24] bg-[#8b4d24] text-[#fff7ea]' : 'border-[#d8bd8d] bg-[#fff8ee] text-[#6a4030]',
            ].join(' ')}
          >
            {item}
          </button>
        );
      })}
    </div>
  );
}

export default function App() {
  const [stage, setStage] = useState<Stage>('intro');
  const [inputMode, setInputMode] = useState<InputMode>('humming');
  const [presetId, setPresetId] = useState<string>(PRESETS[0].id);
  const [captureStarted, setCaptureStarted] = useState(false);
  const [capturePhase, setCapturePhase] = useState<CapturePhase>('idle');
  const [micError, setMicError] = useState('');
  const [isRequestingMic, setIsRequestingMic] = useState(false);
  const [isCheckingBackend, setIsCheckingBackend] = useState(false);
  const [detectedPitch, setDetectedPitch] = useState('待识别');
  const [countdown, setCountdown] = useState(4);
  const [recordProgress, setRecordProgress] = useState(0);
  const [recordBeat, setRecordBeat] = useState(0);
  const [leaderNotes, setLeaderNotes] = useState<Array<number | null>>(DEFAULT_LEADER_NOTES);
  const [generatedTrackNotes, setGeneratedTrackNotes] = useState<Partial<Record<TrackVoice, Array<number | null>>>>({});
  const [generationError, setGenerationError] = useState('');
  const trackLibrary = useMemo(() => buildTrackLibrary(leaderNotes, generatedTrackNotes), [leaderNotes, generatedTrackNotes]);
  const [tracks, setTracks] = useState<Track[]>([trackLibrary[0]]);
  const [activeTrackCount, setActiveTrackCount] = useState(1);
  const [survey, setSurvey] = useState<SurveyState>({
    dunhuang: 4,
    clarity: 4,
    input: 4,
    return: 4,
  });
  const [feedback, setFeedback] = useState('');
  const [playhead, setPlayhead] = useState(0);
  const [composeRun, setComposeRun] = useState(0);

  const timers = useRef<number[]>([]);
  const intervals = useRef<number[]>([]);
  const generationRequestId = useRef(0);
  const trackLibraryRef = useRef<Track[]>(trackLibrary);
  const audioCtx = useRef<AudioContext | null>(null);
  const recordCtx = useRef<AudioContext | null>(null);
  const mediaStream = useRef<MediaStream | null>(null);
  const analyser = useRef<AnalyserNode | null>(null);
  const recordBuckets = useRef<number[][]>(Array.from({ length: CAPTURE_TOTAL_BEATS }, () => []));

  const preset = useMemo(() => PRESETS.find((item) => item.id === presetId) ?? PRESETS[0], [presetId]);
  const arrangementReady = trackLibrary.length >= 4 && !generationError;

  const clearTimers = () => {
    timers.current.forEach((id) => window.clearTimeout(id));
    timers.current = [];
    intervals.current.forEach((id) => window.clearInterval(id));
    intervals.current = [];
  };

  const stopMicCapture = () => {
    mediaStream.current?.getTracks().forEach((track) => track.stop());
    mediaStream.current = null;
    analyser.current = null;
    if (recordCtx.current) {
      recordCtx.current.close();
      recordCtx.current = null;
    }
  };

  const ping = (frequency: number, duration = 0.08) => {
    const browserWindow = window as WindowWithWebkitAudio;
    const AudioContextClass = window.AudioContext || browserWindow.webkitAudioContext;
    if (!AudioContextClass) return;

  const ctx = audioCtx.current ?? new AudioContextClass();
  audioCtx.current = ctx;
  void ctx.resume();
  const mainOsc = ctx.createOscillator();
  const overtoneOsc = ctx.createOscillator();
  const filter = ctx.createBiquadFilter();
  const gain = ctx.createGain();

  mainOsc.type = 'triangle';
  overtoneOsc.type = 'sawtooth';
  mainOsc.frequency.value = frequency;
  overtoneOsc.frequency.value = frequency * 2.01;
  filter.type = 'lowpass';
  filter.frequency.value = Math.max(700, frequency * 4.5);
  filter.Q.value = 0.8;

  gain.gain.setValueAtTime(0.0001, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.11, ctx.currentTime + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);

  mainOsc.connect(filter);
  overtoneOsc.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);
  mainOsc.start();
  overtoneOsc.start();
  mainOsc.stop(ctx.currentTime + duration + 0.02);
  overtoneOsc.stop(ctx.currentTime + duration + 0.02);
  };

  const resetCompose = () => {
    clearTimers();
    setTracks([trackLibrary[0]]);
    setActiveTrackCount(1);
    setPlayhead(0);
  };

  const restartFlow = () => {
    generationRequestId.current += 1;
    clearTimers();
    setStage('input');
    setCaptureStarted(false);
    setCapturePhase('idle');
    setCountdown(CAPTURE_COUNT_IN_BEATS);
    setRecordProgress(0);
    setRecordBeat(0);
    setMicError('');
    setDetectedPitch('待识别');
    setGenerationError('');
    setGeneratedTrackNotes({});
    stopMicCapture();
    resetCompose();
  };

  const testTone = () => {
    ping(523.25, 0.18);
    window.setTimeout(() => ping(659.25, 0.18), 220);
    window.setTimeout(() => ping(783.99, 0.22), 440);
  };

  useEffect(() => {
    return () => {
      clearTimers();
      stopMicCapture();
      audioCtx.current?.close();
    };
  }, []);

  useEffect(() => {
    const resumeAudio = () => {
      void audioCtx.current?.resume();
      void recordCtx.current?.resume();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        resumeAudio();
      }
    };

    window.addEventListener('focus', resumeAudio);
    window.addEventListener('pointerdown', resumeAudio);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('focus', resumeAudio);
      window.removeEventListener('pointerdown', resumeAudio);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  useEffect(() => {
    trackLibraryRef.current = trackLibrary;
    if (stage === 'compose') {
      setTracks(trackLibrary.slice(0, Math.max(1, Math.min(trackLibrary.length, activeTrackCount))));
    }
  }, [activeTrackCount, stage, trackLibrary]);

  useEffect(() => {
    if (stage !== 'compose') return;

    clearTimers();
    const currentTrackLibrary = trackLibraryRef.current;
    setTracks([currentTrackLibrary[0]]);
    setActiveTrackCount(1);
    setPlayhead(0);

    Array.from({ length: 4 }).forEach((_, loopIndex) => {
      Array.from({ length: CAPTURE_TOTAL_BEATS }).forEach((__, beatIndex) => {
        const timer = window.setTimeout(() => {
          const currentTrackLibrary = trackLibraryRef.current;
          const previewNextTrack = beatIndex >= CAPTURE_TOTAL_BEATS - 2;
          const activeCount = Math.min(currentTrackLibrary.length, loopIndex + 1);
          const visibleTrackCount = Math.min(currentTrackLibrary.length, loopIndex + 1 + (previewNextTrack ? 1 : 0));
          const activeTracks = currentTrackLibrary.slice(0, activeCount);
          setTracks(currentTrackLibrary.slice(0, Math.max(1, visibleTrackCount)));
          setActiveTrackCount(Math.max(1, activeCount));
          setPlayhead(beatIndex);

          const browserWindow = window as WindowWithWebkitAudio;
          const AudioContextClass = window.AudioContext || browserWindow.webkitAudioContext;
          if (AudioContextClass) {
            const ctx = audioCtx.current ?? new AudioContextClass();
            audioCtx.current = ctx;
            void ctx.resume();
            const startTime = ctx.currentTime + 0.012;
            activeTracks.forEach((track) => {
              scheduleTrackTone(ctx, track, beatIndex, startTime, CAPTURE_BEAT_MS / 1000);
            });
          }
        }, (loopIndex * CAPTURE_TOTAL_BEATS + beatIndex) * CAPTURE_BEAT_MS);
        timers.current.push(timer);
      });
    });

    return () => {
      clearTimers();
      setPlayhead(0);
    };
  }, [stage, composeRun]);

  const enterCaptureAndBegin = async (mode: InputMode) => {
    clearTimers();
    setMicError('');
    setInputMode(mode);
    setCaptureStarted(false);
    setCapturePhase('idle');
    setRecordProgress(0);
    setRecordBeat(0);
    setCountdown(CAPTURE_COUNT_IN_BEATS);

    if (mode === 'humming') {
      if (!navigator.mediaDevices?.getUserMedia) {
        setMicError(formatRecordErrorMessage(new Error('getUserMedia unavailable')));
        setStage('input');
        return;
      }

      const browserWindow = window as WindowWithWebkitAudio;
      const AudioContextClass = window.AudioContext || browserWindow.webkitAudioContext;
      if (!AudioContextClass) {
        setMicError('当前浏览器不支持 Web Audio，无法进行哼唱录音。');
        setStage('input');
        return;
      }

      setIsRequestingMic(true);
      try {
        stopMicCapture();
        if (navigator.permissions?.query) {
          try {
            const permissionStatus = await navigator.permissions.query({ name: 'microphone' } as MicrophonePermissionDescriptor);
            if (permissionStatus.state === 'denied') {
              setMicError('当前页面的麦克风权限已经被浏览器设为拒绝。请点地址栏左侧/右侧的权限图标，把麦克风改为允许，然后再点开始录音。');
              setStage('input');
              return;
            }
          } catch {
            // Safari and some embedded browsers do not expose microphone permission queries.
          }
        }

        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
          },
        });
        if (!stream.active || stream.getAudioTracks().length === 0) {
          throw new DOMException('No active microphone track', 'NotReadableError');
        }
        const ctx = new AudioContextClass();
        await ctx.resume();

        const source = ctx.createMediaStreamSource(stream);
        const inputAnalyser = ctx.createAnalyser();
        inputAnalyser.fftSize = 4096;
        inputAnalyser.smoothingTimeConstant = 0.08;
        source.connect(inputAnalyser);

        mediaStream.current = stream;
        recordCtx.current = ctx;
        analyser.current = inputAnalyser;
        recordBuckets.current = Array.from({ length: CAPTURE_TOTAL_BEATS }, () => []);
      } catch (error) {
        stopMicCapture();
        setCaptureStarted(false);
        setCapturePhase('idle');
        setStage('input');
        setMicError(formatRecordErrorMessage(error));
        return;
      } finally {
        setIsRequestingMic(false);
      }
    }

    setStage('capture');
    window.setTimeout(() => beginCapture(mode), 120);
  };

  const checkBackendReady = async () => {
    if (!AI_ENABLED) {
      throw new Error(AI_DISABLED_MESSAGE);
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), AI_HEALTH_TIMEOUT_MS);
    try {
      const response = await fetch(AI_HEALTH_URL, {
        method: 'GET',
        cache: 'no-store',
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`服务器返回 ${response.status}`);
      }

      const data = (await response.json()) as BackendHealthResponse;
      if (data.model_loaded === false || data.status === 'error') {
        throw new Error(data.error ? `模型未就绪：${data.error}` : '模型未就绪');
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new Error('后端连接超时，请稍后再试');
      }
      throw error;
    } finally {
      window.clearTimeout(timeoutId);
    }
  };

  const startComposeGeneration = async (inputNotes: Array<number | null>) => {
    setIsCheckingBackend(true);
    setGenerationError('');
    enterCompose();
    setLeaderNotes(inputNotes);
    const leaderOnlyTracks = buildTrackLibrary(inputNotes, {});
    trackLibraryRef.current = leaderOnlyTracks;
    setTracks([leaderOnlyTracks[0]]);
    setActiveTrackCount(1);
    setPlayhead(0);
    setGeneratedTrackNotes({});
    if (!AI_ENABLED) {
      setIsCheckingBackend(false);
      setGenerationError(AI_DISABLED_MESSAGE);
      return;
    }

    try {
      await checkBackendReady();
    } catch (error) {
      const message = error instanceof Error ? error.message : '后端连接失败';
      setGenerationError(`后端连接失败：${message}`);
      return;
    } finally {
      setIsCheckingBackend(false);
    }

    generationRequestId.current += 1;
    const requestId = generationRequestId.current;
    setGenerationError('');
    void generateArrangement(inputNotes, requestId);
  };

  const choosePresetAndContinue = (presetIndex: number) => {
    const selectedPreset = PRESETS[presetIndex % PRESETS.length];
    setPresetId(selectedPreset.id);
    setInputMode('preset');
    const presetNotes = selectedPreset.id === 'molihua'
      ? MOLIHUA_LEADER_NOTES
      : selectedPreset.id === 'lanhuacao'
        ? LANHUACAO_LEADER_NOTES
        : XUANZU_LEADER_NOTES;
    setLeaderNotes(presetNotes);
    setMicError('');
    setDetectedPitch('待识别');
    stopMicCapture();
    void startComposeGeneration(presetNotes);
  };

  const enterCompose = () => {
    clearTimers();
    setCaptureStarted(false);
    setCapturePhase('idle');
    setStage('compose');
    stopMicCapture();
    setComposeRun((value) => value + 1);
  };

  const generateArrangement = async (inputNotes: Array<number | null>, requestId = generationRequestId.current) => {
    const melody = notesToBackendMelody(inputNotes);
    if (melody.length === 0) {
      if (requestId === generationRequestId.current) {
        setGeneratedTrackNotes({});
        setGenerationError('后端生成失败：没有可发送的主旋律。');
      }
      return;
    }

    setGenerationError('');
    try {
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), AI_REQUEST_TIMEOUT_MS);
      try {
        const response = await fetch(AI_API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            melody,
            style_prompt: '敦煌四重奏，使用笛子主旋律、箫、琵琶、都塔尔低音，保持主旋律清晰',
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          let detail = response.statusText;
          try {
            const errorData = await response.json();
            detail = typeof errorData?.detail === 'string' ? errorData.detail : JSON.stringify(errorData);
          } catch {
            // Keep status text.
          }
          throw new Error(`服务器返回 ${response.status}${detail ? `，${detail}` : ''}`);
        }

        const data = (await response.json()) as BackendResponse;
        if (data.status !== 'success' || !Array.isArray(data.generated_notes)) {
          throw new Error('API 返回格式不正确');
        }

        const generatedTracks = completeGeneratedTracks(inputNotes, {
          xiao: backendNotesToTrackNotes(data.generated_notes, 'xiao'),
          pipa: backendNotesToTrackNotes(data.generated_notes, 'pipa'),
          guqin: backendNotesToTrackNotes(data.generated_notes, 'guqin'),
        });
        const missingVoices = Object.entries(generatedTracks)
          .filter(([, notes]) => !notes.some((note) => note !== null && note !== undefined))
          .map(([voice]) => voice);
        if (missingVoices.length > 0) {
          throw new Error(`后端没有返回有效声部：${missingVoices.join('、')}`);
        }

        if (requestId === generationRequestId.current) {
          setGeneratedTrackNotes(generatedTracks);
        }
      } finally {
        window.clearTimeout(timeoutId);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '后端请求失败';
      if (requestId === generationRequestId.current) {
        const fallbackTracks = completeGeneratedTracks(inputNotes, {});
        setGeneratedTrackNotes(fallbackTracks);
        setGenerationError(`后端连接超时，已先使用本地试听配器：${message}`);
      }
    }
  };

  const beginCapture = (modeOverride?: InputMode) => {
    const activeMode = modeOverride ?? inputMode;
    clearTimers();
    setCaptureStarted(true);
    setCapturePhase('precount');
    setRecordProgress(0);
    setRecordBeat(0);
    setCountdown(CAPTURE_COUNT_IN_BEATS);

    if (activeMode === 'preset') {
      ping(440, 0.08);
      timers.current.push(
        window.setTimeout(async () => {
          const presetNotes = preset.id === 'molihua'
            ? MOLIHUA_LEADER_NOTES
            : preset.id === 'lanhuacao'
              ? LANHUACAO_LEADER_NOTES
              : XUANZU_LEADER_NOTES;
          setLeaderNotes(presetNotes);
          void startComposeGeneration(presetNotes);
        }, 900)
      );
      return;
    }

    if (!analyser.current || !recordCtx.current) {
      setMicError('麦克风还没有准备好，请重新点击开始录音。');
      setStage('input');
      setCaptureStarted(false);
      setCapturePhase('idle');
      return;
    }

    recordBuckets.current = Array.from({ length: CAPTURE_TOTAL_BEATS }, () => []);
    setDetectedPitch('待识别');
    const firstCountInOffset = 0;
    const recordStartOffset = CAPTURE_COUNT_IN_BEATS * CAPTURE_BEAT_MS;
    const buffer = new Float32Array(analyser.current.fftSize);
    const captureStartTime = recordCtx.current.currentTime + recordStartOffset / 1000;

    Array.from({ length: CAPTURE_COUNT_IN_BEATS }).forEach((_, index) => {
      const timer = window.setTimeout(() => {
        setCapturePhase('countin');
        setCountdown(CAPTURE_COUNT_IN_BEATS - index);
        setRecordBeat(0);
        setRecordProgress(0);
        ping(440, CAPTURE_BEAT_MS / 1000);
      }, firstCountInOffset + index * CAPTURE_BEAT_MS);
      timers.current.push(timer);
    });

    Array.from({ length: CAPTURE_TOTAL_BEATS }).forEach((_, index) => {
      const beatNumber = index + 1;
      const timer = window.setTimeout(() => {
        setCapturePhase('recording');
        setCountdown(0);
        setRecordBeat(beatNumber);
        setRecordProgress(Math.floor(beatNumber / CAPTURE_BEATS_PER_BAR));
        ping(beatNumber % CAPTURE_BEATS_PER_BAR === 1 ? 660 : 440, 0.05);
      }, recordStartOffset + index * CAPTURE_BEAT_MS);
      timers.current.push(timer);
    });

    const samplingInterval = window.setInterval(() => {
      if (!analyser.current || !recordCtx.current) return;

      analyser.current.getFloatTimeDomainData(buffer);
      const frequency = detectPitch(buffer, recordCtx.current.sampleRate);
      if (!frequency) return;

      const midi = freqToMidi(frequency);
      if (!Number.isFinite(midi)) return;
      setDetectedPitch(midiToNoteName(midi));

      const elapsedMs = (recordCtx.current.currentTime - captureStartTime) * 1000 - CAPTURE_LATENCY_COMPENSATION_MS;
      if (elapsedMs < 0) return;
      const step = Math.floor(elapsedMs / CAPTURE_BEAT_MS);
      if (step < 0 || step >= CAPTURE_TOTAL_BEATS) return;
      recordBuckets.current[step].push(midi);
    }, 32);
    intervals.current.push(samplingInterval);

    const finishTimer = window.setTimeout(async () => {
      intervals.current.forEach((id) => window.clearInterval(id));
      intervals.current = [];
      const capturedLeaderNotes = buildLeaderNotesFromBuckets(recordBuckets.current);
      setLeaderNotes(capturedLeaderNotes);
      setRecordProgress(CAPTURE_BARS);
      setDetectedPitch('录制完成');
      void startComposeGeneration(capturedLeaderNotes);
    }, recordStartOffset + CAPTURE_TOTAL_BEATS * CAPTURE_BEAT_MS + CAPTURE_TAIL_MS);
    timers.current.push(finishTimer);
  };

  const content = {
    intro: (
      <section className="flex h-full flex-1 flex-col overflow-hidden">
        <FreezeBar title="LINGYAN STUDIO" stepLabelText="知悉" stage={stage} />

        <div className="min-h-0 flex-1 overflow-y-auto bg-[#f8efda] px-4 pb-3 pt-5">
          <div className="flex items-center gap-4 px-8">
            <div className="h-px flex-1 bg-[#ddcfad]" />
            <div className="h-2.5 w-2.5 rotate-45 bg-[#a45f2c]" />
            <div className="h-px flex-1 bg-[#ddcfad]" />
          </div>
          <div className="mt-4 text-center text-[13px] text-[#8b5c42]">欢迎体验</div>
          <h1 className="mt-3 text-center text-[44px] leading-[0.98] tracking-[0.01em] text-[#5b3829]">灵岩谱曲台</h1>
          <div className="mt-4 flex items-center gap-4 px-8">
            <div className="h-px flex-1 bg-[#ddcfad]" />
            <div className="h-2.5 w-2.5 rotate-45 bg-[#a45f2c]" />
            <div className="h-px flex-1 bg-[#ddcfad]" />
          </div>

          <div className="mt-5 space-y-3">
            <div className="rounded-[18px] border border-[#e0bf76] bg-[#f7e9bf] px-5 py-5 text-center">
              <div className="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-[#efd9b4] text-[#a45f2c]">
                <Volume2 className="h-5 w-5" />
              </div>
              <p className="text-[12px] leading-[1.75] text-[#8a5d43]">体验过程中，系统会播放声音</p>
              <p className="mt-1 text-[12px] leading-[1.75] text-[#8a5d43]">请确保您佩戴耳机，或环境允许外放</p>
            </div>

            <div className="rounded-[18px] border border-[#e0bf76] bg-[#f7e9bf] px-5 py-5 text-center">
              <div className="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-[#efd9b4] text-[#a45f2c]">
                <Music4 className="h-5 w-5" />
              </div>
              <p className="text-[12px] leading-[1.75] text-[#8a5d43]">在体验结束后，您会被邀请参与一个简短的问卷</p>
              <p className="mt-1 text-[12px] leading-[1.75] text-[#8a5d43]">参加本次音乐体验，即视为您知悉并同意以上行为</p>
            </div>
          </div>
        </div>

        <FreezeActions
          leftLabel=""
          rightLabel="我已知悉，开始体验"
          leftIcon={<span />}
          rightIcon={<span className="text-[18px]">→</span>}
          onLeft={() => {}}
          onRight={() => setStage('input')}
          leftWidthClass="hidden"
          rightWidthClass="w-full"
        />
      </section>
    ),
    input: (
      <section className="flex h-full flex-1 flex-col overflow-hidden">
        <FreezeBar title="LINGYAN STUDIO" stepLabelText="取样" stage={stage} />

        <div className="input-step-body min-h-0 flex-1 overflow-y-auto bg-[#f8efda] px-4 pb-3 pt-8">
          <h2 className="input-step-title px-2 text-center text-[24px] leading-[1.22] text-[#5b3829]">让我们尝试输入一段旋律</h2>
          <div className="input-step-stack mt-4 border-t border-[#ddcfad] pt-4">
            <div className="input-record-card rounded-[10px] border-2 border-[#5b3829] bg-[#efe4c8] px-5 py-4">
              <div className="input-card-title text-center text-[16px] font-semibold text-[#5b3829]">使用 哼唱 录入旋律</div>
              <div className="input-record-button-wrap mt-4 flex justify-center">
                <button
                  type="button"
                  onClick={() => {
                    void enterCaptureAndBegin('humming');
                  }}
            disabled={isRequestingMic || isCheckingBackend}
            className="input-record-button flex h-[72px] w-full max-w-[286px] items-center justify-center rounded-[999px] bg-[#5b3829] text-[17px] text-[#f7ead1] disabled:opacity-60"
          >
            {isRequestingMic ? '请求麦克风' : isCheckingBackend ? '连接后端' : '开始录音'}
                </button>
              </div>
              <div className="mt-3 flex justify-center">
                <button
                  type="button"
                  onClick={testTone}
                  className="flex h-10 items-center justify-center rounded-[999px] border border-[#d7b37a] bg-[#fff6de] px-4 text-[12px] font-semibold text-[#6f4a35] transition-colors hover:bg-[#f8ebcb]"
                >
                  测试音色
                </button>
              </div>
              <div className="input-bpm-copy mt-4 text-center text-[12px] font-semibold leading-[1.55] text-[#8a5d43]">
                <p>在 BPM = {CAPTURE_BPM} 的速度下</p>
                <p>自由哼唱四个小节</p>
              </div>
              {micError && (
                <p className="mt-3 rounded-md border border-[#d7b37a] bg-[#fff4df] px-3 py-2 text-center text-[11px] leading-5 text-[#8a4d2b]">
                  {micError}
                </p>
              )}
              {generationError && (
                <p className="mt-3 rounded-md border border-[#d7b37a] bg-[#fff4df] px-3 py-2 text-center text-[11px] leading-5 text-[#8a4d2b]">
                  {generationError}
                </p>
              )}
            </div>

            <div className="input-preset-card mt-3 rounded-[10px] border border-[#e0bf76] bg-[#f7e9bf] px-4 py-3">
              <div className="input-preset-title text-center text-[17px] leading-[1.3] text-[#5b3829]">不方便开口？ 也可使用预设</div>
              <div className="input-preset-list mt-2.5 space-y-1.5">
                {introPresets.map((label, index) => (
                  <button
                  key={`${label}-${index}`}
                  type="button"
                    onClick={() => {
                      void choosePresetAndContinue(index);
                    }}
                    disabled={isCheckingBackend}
                    className="input-preset-button flex h-8 w-full items-center justify-center rounded-[999px] bg-[#ead7b1] px-4 text-[11px] font-semibold text-[#6f4a35] transition-colors disabled:opacity-60"
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>
    ),
    capture: (
      <section className="capture-screen flex h-full flex-1 flex-col overflow-hidden bg-[#f8efda] px-4 pb-4">
        <div className="capture-copy shrink-0 space-y-2 pt-3 text-center">
          <Pill active>{inputMode === 'humming' ? '哼唱采集' : '预设填充'}</Pill>
          <h2 className="text-[25px] leading-tight text-[#5b3829]">{inputMode === 'humming' ? '准备收下你的旋律' : `已选「${preset.name}」`}</h2>
          <p className="text-[15px] leading-6 text-[#6f4a35]">
            {inputMode === 'humming' ? '先听 4 拍，再唱 4 小节。' : '这会直接作为输入进入后面的织谱。'}
          </p>
        </div>

        <div className="capture-panel mt-5 rounded-[10px] border border-[#d8bd8d] bg-[#fff8ee]/80 px-4 py-4">
          <div className="flex items-center justify-between text-[15px] text-[#7c583f]">
            <span>预备拍</span>
            <span className="font-semibold text-[#4a2d1f]">
              {inputMode === 'humming'
                ? captureStarted
                  ? capturePhase === 'precount'
                    ? '预备'
                    : countdown > 0
                        ? `${countdown}`
                        : '录制中'
                  : '待开始'
                : captureStarted ? '填充中' : '待进入'}
            </span>
          </div>
          {inputMode === 'humming' ? (
            <div className="mt-3 grid grid-cols-4 gap-2">
              {[1, 2, 3, 4].map((beat) => (
                <div
                  key={beat}
                  className={[
                    'h-3 rounded-full border',
                    captureStarted && beat <= getCountInProgress(capturePhase, countdown) ? 'border-[#8b4d24] bg-[#8b4d24]' : 'border-[#d9c09b] bg-transparent',
                  ].join(' ')}
                />
              ))}
            </div>
          ) : (
            <div className="mt-3 rounded-lg border border-dashed border-[#d4b07a] bg-[#fffdf8] p-3 text-sm text-[#7b5a46]">
              预设旋律将直接进入织谱，不需要麦克风。
            </div>
          )}
        </div>

        {inputMode === 'humming' && (
          <div className="capture-panel mt-4 rounded-[10px] border border-[#d8bd8d] bg-[#fff8ee]/80 px-4 py-4">
            <div className="flex items-center justify-between text-[15px] text-[#7c583f]">
              <span>录制进度</span>
              <span>{recordProgress}/4 小节 · {recordBeat}/16 拍</span>
            </div>
            <div className="mt-3 rounded-md border border-[#d8bd8d] bg-[#fffaf3] px-3 py-2 text-center">
              <div className="text-[11px] text-[#9b7453]">当前识别音高</div>
              <div className="mt-1 text-[18px] font-semibold tracking-[0.06em] text-[#5b3829]">{detectedPitch}</div>
            </div>
            <div className="capture-bars mt-3 grid grid-cols-4 gap-2">
              {[1, 2, 3, 4].map((bar) => {
                const barStartBeat = (bar - 1) * CAPTURE_BEATS_PER_BAR;
                const filledBeatsInBar = Math.max(0, Math.min(CAPTURE_BEATS_PER_BAR, recordBeat - barStartBeat));
                const barIsComplete = recordProgress >= bar;
                return (
                <div
                  key={bar}
                  className={[
                    'h-[78px] rounded-md border p-2 transition-colors',
                    barIsComplete ? 'border-[#8b4d24] bg-[#f7e2b8]' : filledBeatsInBar > 0 ? 'border-[#b77949] bg-[#fff4df]' : 'border-[#dbc39c] bg-[#fffaf3]',
                  ].join(' ')}
                >
                  <div className="flex h-[52px] items-end justify-center gap-1">
                    {[18, 30, 22, 34].map((height, index) => (
                      <span
                        key={`${bar}-${index}`}
                        className={[
                          'w-1 rounded-full transition-colors',
                          index < filledBeatsInBar ? 'bg-[#7a4c2b]' : 'bg-[#d9c09b]',
                        ].join(' ')}
                        style={{ height: `${height + bar * 2}px` }}
                      />
                    ))}
                  </div>
                  <div className="mt-2 grid grid-cols-4 gap-1">
                    {[1, 2, 3, 4].map((beat) => (
                      <span
                        key={`${bar}-beat-${beat}`}
                        className={[
                          'h-1.5 rounded-full',
                          beat <= filledBeatsInBar ? 'bg-[#8b4d24]' : 'bg-[#e3cfaa]',
                        ].join(' ')}
                      />
                    ))}
                  </div>
                </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="capture-actions mt-auto flex gap-3 pt-4">
          <GhostButton className="h-[52px] flex-1 rounded-[12px] text-[15px]" icon={<RotateCcw className="h-4 w-4" />} onClick={restartFlow}>
            重来
          </GhostButton>
          <PrimaryButton
            className="h-[52px] flex-1 rounded-[12px] text-[16px]"
            icon={<ChevronRight className="h-4 w-4" />}
            onClick={() => beginCapture()}
            disabled={captureStarted || isCheckingBackend}
          >
            {isCheckingBackend ? '连接后端' : captureStarted ? '采集中' : inputMode === 'humming' ? '开始' : '进入'}
          </PrimaryButton>
        </div>
      </section>
    ),
    compose: (
      <section className="compose-screen flex h-full flex-1 flex-col overflow-hidden bg-[#f8efda] px-4 pb-3">
        <div className="compose-copy shrink-0 space-y-1.5 pt-2.5 text-center">
          <h2 className="text-[23px] leading-tight text-[#5b3829]">{getComposeTitle(activeTrackCount)}</h2>
          <p className="text-[14px] leading-5 text-[#6f4a35]">
            {generationError || (arrangementReady ? '四重奏已经生成......' : '乐师正在即兴创作......')}
          </p>
        </div>

        <div className="compose-tracks mt-3 grid gap-2.5 overflow-y-auto pb-1">
          {tracks.map((track, index) => (
          <ScoreLane
              key={track.id}
              label={track.label}
              color={track.color}
              notes={track.notes}
              activeStep={playhead}
              notesVisible={index < activeTrackCount}
              delay={index * 0.18}
            />
          ))}
        </div>

        <div className="compose-actions mt-auto grid grid-cols-3 gap-2 pt-4">
          <GhostButton className="h-[52px] rounded-[12px] px-2 text-[14px]" icon={<RotateCcw className="h-4 w-4" />} onClick={() => restartFlow()}>
            重新哼唱
          </GhostButton>
          <GhostButton
            className="h-[52px] rounded-[12px] px-2 text-[14px]"
            icon={<Sparkles className="h-4 w-4" />}
            onClick={() => {
              void startComposeGeneration(leaderNotes);
            }}
            disabled={!AI_ENABLED}
          >
            {AI_ENABLED ? '重新计算' : 'AI 已暂停'}
          </GhostButton>
          <PrimaryButton
            className="h-[52px] rounded-[12px] px-2 text-[15px]"
            icon={<ChevronRight className="h-4 w-4" />}
            onClick={() => setStage('survey')}
            disabled={!arrangementReady}
          >
            继续
          </PrimaryButton>
        </div>
      </section>
    ),
    survey: (
      <section className="survey-screen flex h-full flex-1 flex-col overflow-hidden bg-[#f8efda] px-4 pb-3">
        <div className="survey-body min-h-0 flex-1 overflow-y-auto pb-3 pt-4 text-center">
          <h2 className="text-[24px] leading-tight text-[#5b3829]">给一点回声</h2>
          <p className="mt-2 text-[14px] leading-6 text-[#6f4a35]">这部分会很快，主要想知道你刚刚的感受。</p>

          <div className="mt-4 grid gap-3 text-left">
            {surveyItems.map((item) => (
              <div key={item.id} className="rounded-lg border border-[#d8bd8d] bg-[#fff8ee]/90 p-4">
                <div className="mb-3 flex items-center justify-between text-sm">
                  <span className="font-medium text-[#5f3e2d]">{item.label}</span>
                  <span className="text-[#8c6a52]">{survey[item.id]}/5</span>
                </div>
                <SurveyScale
                  value={survey[item.id]}
                  onChange={(value) =>
                    setSurvey((current) => ({
                      ...current,
                      [item.id]: value,
                    }))
                  }
                />
              </div>
            ))}
          </div>

          <div className="mt-3 rounded-lg border border-[#d8bd8d] bg-[#fff8ee]/90 p-4 text-left">
            <label className="mb-2 block text-sm font-medium text-[#5f3e2d]">补一句话</label>
            <textarea
              value={feedback}
              onChange={(event) => setFeedback(event.target.value)}
              placeholder="比如：节拍很清楚，但我更想先听到主旋律。"
              className="min-h-28 w-full resize-none rounded-md border border-[#d8bd8d] bg-[#fffdf8] px-3 py-3 text-sm outline-none placeholder:text-[#b49373] focus:border-[#8b4d24]"
            />
          </div>
        </div>

        <div className="survey-actions shrink-0 flex gap-3 border-t border-[#d8c08d] bg-[#f8efda] pt-3">
          <GhostButton className="h-[52px] flex-1 rounded-[12px]" icon={<ArrowLeft className="h-4 w-4" />} onClick={() => setStage('compose')}>
            返回
          </GhostButton>
          <PrimaryButton className="h-[52px] flex-1 rounded-[12px]" icon={<ChevronRight className="h-4 w-4" />} onClick={() => setStage('done')}>
            提交
          </PrimaryButton>
        </div>
      </section>
    ),
    done: (
      <section className="done-screen flex h-full flex-1 flex-col overflow-hidden bg-[#f8efda] px-4 pb-3">
        <div className="done-body min-h-0 flex-1 overflow-y-auto pb-3 pt-6 text-center">
          <h2 className="text-[24px] leading-tight text-[#5b3829]">谢谢你把这段旋律留下来</h2>
          <p className="mx-auto mt-2 max-w-[320px] text-[14px] leading-6 text-[#6f4a35]">你的反馈已经收好，后面可以继续迭代这套体验。</p>

          <div className="mx-auto mt-5 max-w-[340px] rounded-lg border border-[#d8bd8d] bg-[#fff8ee]/90 p-4 text-left">
            <div className="flex items-center justify-between text-sm text-[#7d5a43]">
              <span>本次体验</span>
              <span>{inputMode === 'preset' ? preset.name : '哼唱采集'}</span>
            </div>
            <div className="mt-3 space-y-2 text-sm text-[#5f3e2d]">
              <p>反馈字数：{feedback.trim().length}</p>
            </div>
          </div>
        </div>

        <div className="done-actions shrink-0 border-t border-[#d8c08d] bg-[#f8efda] pt-3">
          <PrimaryButton className="h-[52px] w-full rounded-[12px] text-base" icon={<RotateCcw className="h-4 w-4" />} onClick={restartFlow}>
            再来一轮
          </PrimaryButton>
        </div>
      </section>
    ),
  };

  return (
    <OrnamentalFrame>
      {stage !== 'intro' && stage !== 'input' && (
        <header className="generic-stage-header shrink-0 space-y-3 border-b border-[#d8c08d] bg-[#fcf5e2] px-4 pb-3 pt-4 text-center">
          <div>
            <div className="text-[12px] tracking-[0.34em] text-[#b66c33]">LINGYAN STUDIO</div>
            <div className="mt-2 text-[24px] font-semibold leading-none text-[#4a2d1f]">{stageLabel[stage]}</div>
          </div>
          <StageRail stage={stage} />
        </header>
      )}

      <AnimatePresence mode="wait">
        <motion.div
          key={stage}
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.35, ease: motionEase }}
          className="flex min-h-0 flex-1 flex-col overflow-hidden"
        >
          {content[stage]}
        </motion.div>
      </AnimatePresence>
    </OrnamentalFrame>
  );
}
