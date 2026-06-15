import { useState, useCallback, useRef, useEffect } from 'react';
import ScoreGrid from './components/ScoreGrid';
import ControlBar from './components/ControlBar';
import TransportBar, { type TransportMode } from './components/TransportBar';
import { ArrangementPhase, Note, NoteDuration, Voice } from './types';
import { AI_DISABLED_MESSAGE, AI_ENABLED } from './lib/aiConfig';

type BrowserAudioContextConstructor = typeof AudioContext;

type BrowserWindowWithWebkitAudio = Window & {
  AudioContext?: BrowserAudioContextConstructor;
  webkitAudioContext?: BrowserAudioContextConstructor;
};

const generateId = () => Math.random().toString(36).substring(2, 9);

const TOTAL_STEPS = 16;
const TOTAL_PITCHES = 15;
const TICKS_PER_BEAT = 1;
const PLAY_BPM = 200;
const RECORD_BPM = 100;
const RECORD_OCTAVE_SHIFT = 12;
const AI_API_URL = import.meta.env.VITE_AI_API_URL ?? '/api/generate';
const AI_REQUEST_TIMEOUT_MS = 15000;
const PLAYBACK_ROUND_DELAY_MS = 220;
const ARRANGEMENT_COMPLETE_LABEL = '织谱完成';

const PITCH_TO_MIDI: Record<number, number> = {
  14: 60, // C4
  13: 62, // D4
  12: 64, // E4
  11: 66, // F#4
  10: 67, // G4
  9: 69,  // A4
  8: 71,  // B4
  7: 72,  // C5
  6: 74,  // D5
  5: 76,  // E5
  4: 78,  // F#5
  3: 79,  // G5
  2: 81,  // A5
  1: 83,  // B5
  0: 84   // C6
};

const VOICE_SYNTHS: Record<Voice, {
  type: OscillatorType;
  gain: number;
  attack: number;
  release: number;
  transpose: number;
  pan: number;
}> = {
  user: {
    type: 'triangle',
    gain: 0.22,
    attack: 0.02,
    release: 0.08,
    transpose: -12,
    pan: -0.15,
  },
  alto: {
    type: 'sine',
    gain: 0.16,
    attack: 0.03,
    release: 0.1,
    transpose: 0,
    pan: -0.35,
  },
  tenor: {
    type: 'square',
    gain: 0.12,
    attack: 0.015,
    release: 0.08,
    transpose: -12,
    pan: 0.2,
  },
  bass: {
    type: 'sawtooth',
    gain: 0.08,
    attack: 0.01,
    release: 0.12,
    transpose: -24,
    pan: 0.4,
  },
  xiao: {
    type: 'sine',
    gain: 0.14,
    attack: 0.02,
    release: 0.09,
    transpose: 0,
    pan: -0.25,
  },
  pipa: {
    type: 'triangle',
    gain: 0.09,
    attack: 0.008,
    release: 0.05,
    transpose: -12,
    pan: 0.05,
  },
  guqin: {
    type: 'triangle',
    gain: 0.07,
    attack: 0.008,
    release: 0.11,
    transpose: -24,
    pan: 0.28,
  },
  percussion: {
    type: 'square',
    gain: 0.05,
    attack: 0.005,
    release: 0.03,
    transpose: 0,
    pan: 0,
  },
};

// 定义敦煌/雅乐音阶对应的相对音阶度数（0=Do, 1=Re, 2=Mi, 3=Fa#, 4=Sol, 5=La）
// 在 C 大调下，相当于 C, D, E, F#, G, A
// 五线谱上，我们的 pitch 是从上往下数的线和间。
// 为了简单起见，我们假设五线谱上的 15 个格子循环这 6 个音。
// 正常的 C 大调（没有升降号的白键）是 1 2 3 4 5 6 7
// 我们需要吸附到 1 2 3 #4 5 6 上（去掉 7，把 4 变成 #4）
// 这里我们定义一个“允许的 pitch 集合”。
// 假设 pitch 0 是高音的某一个音，我们通过简单的映射来决定。
// 假设标准的五线谱线间关系对应 C 大调的白键，那么 7 个音符是一个循环。
// 我们的敦煌音阶是 1, 2, 3, 4(实际代表#4), 5, 6
// 被剔除的音是 7（即 C 大调的 B）。
// 我们可以根据 pitch 的 index 对 7 取模，来判断它对应哪个音符。
// 假设 pitch 14 (最下面的线/下加一线下方) 是 C (1)
// 14: 1 (C)
// 13: 2 (D)
// 12: 3 (E)
// 11: 4 (F / F#)
// 10: 5 (G)
// 9: 6 (A)
// 8: 7 (B) -> 不允许
// 7: 1 (C)
// 6: 2 (D)
// 5: 3 (E)
// 4: 4 (F / F#)
// 3: 5 (G)
// 2: 6 (A)
// 1: 7 (B) -> 不允许
// 0: 1 (C)
const ALLOWED_PITCHES = [0, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 14];

const getAudioContextClass = (): BrowserAudioContextConstructor | undefined => {
  const browserWindow = window as BrowserWindowWithWebkitAudio;
  return browserWindow.AudioContext || browserWindow.webkitAudioContext;
};

const snapToDunhuangPitch = (rawPitch: number) => {
  const pitch = Math.round(rawPitch);
  if (ALLOWED_PITCHES.includes(pitch)) return pitch;
  
  // 找最近的
  let closest = ALLOWED_PITCHES[0];
  let minDiff = Math.abs(pitch - closest);
  for (const p of ALLOWED_PITCHES) {
    const diff = Math.abs(pitch - p);
    if (diff < minDiff) {
      minDiff = diff;
      closest = p;
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

const freqToMidi = (freq: number) => 69 + 12 * Math.log2(freq / 440);

const midiToPitchIndex = (midi: number, midiOffset: number = 0) => {
  let bestPitchIndex = 0;
  let bestDiff = Infinity;
  for (const [pitchIndexStr, baseMidi] of Object.entries(PITCH_TO_MIDI)) {
    const pitchIndex = Number(pitchIndexStr);
    const diff = Math.abs(midi - (baseMidi + midiOffset));
    if (diff < bestDiff) {
      bestDiff = diff;
      bestPitchIndex = pitchIndex;
    }
  }
  return bestPitchIndex;
};

const midiToNoteName = (midi: number) => {
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const n = Math.round(midi);
  const name = names[((n % 12) + 12) % 12];
  const octave = Math.floor(n / 12) - 1;
  return `${name}${octave}`;
};

const pitchIndexToNoteName = (pitchIndex: number) => {
  const midi = PITCH_TO_MIDI[Math.round(pitchIndex)];
  if (midi === undefined) return '';
  return midiToNoteName(midi);
};

const getTickDuration = (bpm: number) => 60 / bpm / TICKS_PER_BEAT;

const clampDuration = (duration: number, step: number): NoteDuration => {
  const room = Math.max(1, TOTAL_STEPS - step);
  return Math.max(1, Math.min(room, Math.round(duration || 1)));
};

const normalizeNote = (note: Note): Note => {
  const step = Math.max(0, Math.min(TOTAL_STEPS - 1, Math.round(note.step)));
  return {
    ...note,
    step,
    pitch: snapToDunhuangPitch(Math.round(note.pitch)),
    duration: clampDuration(note.duration ?? 1, step),
  };
};

const LEGACY_GENERATED_VOICE_MAP: Record<string, Voice> = {
  alto: 'xiao',
  tenor: 'pipa',
  bass: 'guqin',
  xiao: 'xiao',
  pipa: 'pipa',
  guqin: 'guqin',
  dutar: 'guqin',
  'dutar-bass': 'guqin',
  percussion: 'percussion',
  user: 'user',
};

const VOICE_REVEAL_ORDER: Voice[] = ['xiao', 'pipa', 'guqin', 'percussion'];

const VOICE_LABELS: Record<Voice, string> = {
  user: '笛子主旋律',
  alto: '高声部',
  tenor: '中声部',
  bass: '低声部',
  xiao: '箫',
  pipa: '琵琶',
  guqin: '都塔尔低音',
  percussion: '鼓点',
};

const PHASE_LABELS: Record<string, string> = {
  alto: '加入高声部',
  tenor: '加入中声部',
  bass: '加入低声部',
  xiao: '加入箫',
  pipa: '加入琵琶',
  guqin: '加入都塔尔低音',
  percussion: '加入鼓点',
};

const mapGeneratedVoice = (voice: unknown): Voice => {
  if (typeof voice !== 'string') return 'xiao';

  const legacyVoice = LEGACY_GENERATED_VOICE_MAP[voice];
  if (legacyVoice) return legacyVoice;

  if (Object.prototype.hasOwnProperty.call(VOICE_SYNTHS, voice)) {
    return voice as Voice;
  }

  return 'xiao';
};

const buildSequentialArrangementPhases = (leadNotes: Note[], generatedNotes: Note[]): ArrangementPhase[] => {
  const normalizedLeadNotes = leadNotes.map((note) => ({
    ...normalizeNote(note),
    voice: 'user' as Voice,
  }));
  const normalizedGeneratedNotes = generatedNotes.map((note) => ({
    ...normalizeNote(note),
    voice: mapGeneratedVoice(note.voice),
  }));

  const generatedVoices = new Set(normalizedGeneratedNotes.map((note) => note.voice));
  const revealVoices = [
    ...VOICE_REVEAL_ORDER.filter((voice) => generatedVoices.has(voice)),
    ...Array.from(generatedVoices).filter((voice) => voice !== 'user' && !VOICE_REVEAL_ORDER.includes(voice)),
  ];

  const phases: ArrangementPhase[] = [
    {
      index: 1,
      label: '主旋律敦煌化',
      bars: 4,
      voices: ['user'],
      notes: normalizedLeadNotes,
    },
  ];

  let currentNotes = [...normalizedLeadNotes];
  revealVoices.forEach((voice, index) => {
    currentNotes = [...currentNotes, ...normalizedGeneratedNotes.filter((note) => note.voice === voice)];
    phases.push({
      index: index + 2,
      label: PHASE_LABELS[voice] ?? `加入${voice}`,
      bars: 4,
      voices: ['user', ...revealVoices.slice(0, index + 1)],
      notes: currentNotes,
    });
  });

  return phases;
};

const buildNotesFromPitchTicks = (pitchTicks: Array<number | null>): Note[] => {
  const notes: Note[] = [];
  let step = 0;

  while (step < TOTAL_STEPS) {
    const pitch = pitchTicks[step];
    if (pitch === null) {
      step += 1;
      continue;
    }

    let end = step + 1;
    while (end < TOTAL_STEPS && pitchTicks[end] === pitch) {
      end += 1;
    }

    notes.push({
      id: generateId(),
      pitch,
      step,
      duration: clampDuration(end - step, step),
      voice: 'user',
    });
    step = end;
  }

  return notes;
};

const deriveSustainedNotes = (currentNotes: Note[]): Note[] => {
  const userNotes = getSnappedNotes(currentNotes)
    .filter((n) => n.voice === 'user')
    .sort((a, b) => a.step - b.step);
  const otherNotes = currentNotes.filter((n) => n.voice !== 'user').map(normalizeNote);

  const sustainedUserNotes = userNotes.map((note, index) => {
    const measureEnd = Math.floor(note.step / 4) * 4 + 4;
    const nextNote = userNotes
      .slice(index + 1)
      .find((candidate) => candidate.step > note.step && candidate.step < measureEnd);
    const endStep = nextNote ? nextNote.step : measureEnd;

    return {
      ...note,
      duration: clampDuration(endStep - note.step, note.step),
    };
  });

  return [...otherNotes, ...sustainedUserNotes];
};

const autoCorrelate = (buf: Float32Array, sampleRate: number) => {
  const SIZE = buf.length;
  let rms = 0;
  for (let i = 0; i < SIZE; i++) rms += buf[i] * buf[i];
  rms = Math.sqrt(rms / SIZE);
  if (rms < 0.01) return null;

  let r1 = 0;
  let r2 = SIZE - 1;
  const threshold = 0.2;
  for (let i = 0; i < SIZE / 2; i++) {
    if (Math.abs(buf[i]) < threshold) {
      r1 = i;
      break;
    }
  }
  for (let i = 1; i < SIZE / 2; i++) {
    if (Math.abs(buf[SIZE - i]) < threshold) {
      r2 = SIZE - i;
      break;
    }
  }

  const trimmed = buf.slice(r1, r2);
  const trimmedSize = trimmed.length;
  const c = new Array(trimmedSize).fill(0);
  for (let i = 0; i < trimmedSize; i++) {
    for (let j = 0; j < trimmedSize - i; j++) {
      c[i] = c[i] + trimmed[j] * trimmed[j + i];
    }
  }

  let d = 0;
  while (c[d] > c[d + 1]) d++;

  let maxValue = -1;
  let maxIndex = -1;
  for (let i = d; i < trimmedSize; i++) {
    if (c[i] > maxValue) {
      maxValue = c[i];
      maxIndex = i;
    }
  }
  if (maxIndex <= 0) return null;

  const x1 = c[maxIndex - 1];
  const x2 = c[maxIndex];
  const x3 = c[maxIndex + 1];
  const a = (x1 + x3 - 2 * x2) / 2;
  const b = (x3 - x1) / 2;
  const shift = a ? b / (2 * a) : 0;
  const period = maxIndex + shift;

  if (!isFinite(period) || period <= 0) return null;
  return sampleRate / period;
};

const getSnappedNotes = (currentNotes: Note[]): Note[] => {
  const userNotes = currentNotes.filter(n => n.voice === 'user');
  const otherNotes = currentNotes.filter(n => n.voice !== 'user').map(normalizeNote);

  const snappedUserNotes: Note[] = [];
  const usedSteps = new Set<number>();

  const sortedUserNotes = [...userNotes].sort((a, b) => a.step - b.step);

  sortedUserNotes.forEach(n => {
    const snapped = normalizeNote(n);

    if (!usedSteps.has(snapped.step)) {
      usedSteps.add(snapped.step);
      snappedUserNotes.push(snapped);
    }
  });

  return [...otherNotes, ...snappedUserNotes];
};

const scheduleNotePlayback = (
  ctx: AudioContext,
  note: Note,
  noteStartTime: number,
  tickDuration: number
) => {
  const midi = PITCH_TO_MIDI[Math.round(note.pitch)];
  if (midi === undefined) return;

  const synth = VOICE_SYNTHS[note.voice];
  const transposedMidi = midi + synth.transpose;
  const freq = 440 * Math.pow(2, (transposedMidi - 69) / 12);
  const noteEndTime = noteStartTime + (note.duration ?? 1) * tickDuration;

  const osc = ctx.createOscillator();
  const overtoneOsc = ctx.createOscillator();
  const filter = ctx.createBiquadFilter();
  const gainNode = ctx.createGain();
  const outputNode =
    typeof ctx.createStereoPanner === 'function' ? ctx.createStereoPanner() : null;

  osc.type = synth.type;
  overtoneOsc.type = synth.type === 'sine' ? 'triangle' : 'sawtooth';
  osc.frequency.setValueAtTime(freq, noteStartTime);
  overtoneOsc.frequency.setValueAtTime(freq * 2.01, noteStartTime);
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(Math.max(900, freq * 4.2), noteStartTime);
  filter.Q.value = 0.9;

  gainNode.gain.setValueAtTime(0, noteStartTime);
  gainNode.gain.linearRampToValueAtTime(synth.gain, noteStartTime + synth.attack);
  gainNode.gain.setValueAtTime(
    synth.gain,
    Math.max(noteStartTime + synth.attack, noteEndTime - synth.release)
  );
  gainNode.gain.linearRampToValueAtTime(0, noteEndTime);

  osc.connect(filter);
  overtoneOsc.connect(filter);
  filter.connect(gainNode);
  if (outputNode) {
    outputNode.pan.setValueAtTime(synth.pan, noteStartTime);
    gainNode.connect(outputNode);
    outputNode.connect(ctx.destination);
  } else {
    gainNode.connect(ctx.destination);
  }

  osc.start(noteStartTime);
  overtoneOsc.start(noteStartTime);
  osc.stop(noteEndTime);
  overtoneOsc.stop(noteEndTime);
};

const formatAiErrorMessage = (error: unknown) => {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return '当前 AI 服务暂时不可用。后端服务器可能正在重启，或已按夜间节费策略关机；请手动开机后再生成和声。';
  }

  if (error instanceof Error) {
    const message = error.message.trim();
    if (message !== '') {
      return `AI 生成失败：${message}`;
    }
  }

  return '当前 AI 服务暂时不可用。后端服务器可能已关机、未启动，或网络暂时无法访问。';
};

const formatRecordErrorMessage = (error: unknown) => {
  if (!window.isSecureContext) {
    return '当前页面不是安全上下文，浏览器会禁用麦克风。录音功能需要 HTTPS，或在 localhost 下访问。';
  }

  if (error instanceof DOMException) {
    switch (error.name) {
      case 'NotAllowedError':
      case 'PermissionDeniedError':
        return '浏览器没有拿到麦克风权限。请在地址栏或系统设置里允许当前页面访问麦克风。';
      case 'NotFoundError':
      case 'DevicesNotFoundError':
        return '没有检测到可用的麦克风设备。请确认麦克风已连接并可被系统识别。';
      case 'NotReadableError':
      case 'TrackStartError':
        return '麦克风当前被其他应用占用，或系统暂时无法读取音频输入。';
      case 'SecurityError':
        return '浏览器安全策略阻止了录音。通常需要 HTTPS 环境和麦克风权限。';
      default:
        return `录音启动失败：${error.message || error.name}`;
    }
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    return '当前浏览器环境不支持麦克风录音，或页面不是 HTTPS / localhost。';
  }

  return '录音启动失败。请检查麦克风权限、浏览器安全设置，以及是否通过 HTTPS 访问页面。';
};

function App() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [arrangementPhases, setArrangementPhases] = useState<ArrangementPhase[]>([]);
  const [visiblePhaseIndex, setVisiblePhaseIndex] = useState<number>(0);
  const [phaseLabel, setPhaseLabel] = useState<string>('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isCountingIn, setIsCountingIn] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [transportMode, setTransportMode] = useState<TransportMode>('idle');
  const [activeStep, setActiveStep] = useState<number | null>(null);
  const [countInBeat, setCountInBeat] = useState<number | null>(null);
  const [detectText, setDetectText] = useState<string>('');
  
  const audioCtxRef = useRef<AudioContext | null>(null);
  const playRoundTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const playRafRef = useRef<number | null>(null);
  const playStartRef = useRef<number>(0);
  const playStepDurationRef = useRef<number>(0);
  const playSequenceRef = useRef<ArrangementPhase[]>([]);
  const playRoundIndexRef = useRef<number>(0);
  const recordCtxRef = useRef<AudioContext | null>(null);
  const recordIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countInTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recordRafRef = useRef<number | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const isRecordingRef = useRef(false);
  const recordBucketsRef = useRef<number[][]>([]);
  const recordStartTimeRef = useRef<number>(0);
  const recordStepDurationRef = useRef<number>(0);
  const userNoteIdsByStepRef = useRef<Record<number, string>>({});
  const lastCommittedStepRef = useRef<number>(-1);

  const clearPlaybackTimers = useCallback(() => {
    if (playRafRef.current !== null) {
      cancelAnimationFrame(playRafRef.current);
      playRafRef.current = null;
    }
    if (playRoundTimeoutRef.current) {
      clearTimeout(playRoundTimeoutRef.current);
      playRoundTimeoutRef.current = null;
    }
  }, []);

  const stopPlayback = useCallback(() => {
    if (audioCtxRef.current) {
      audioCtxRef.current.close();
      audioCtxRef.current = null;
    }
    clearPlaybackTimers();
    setIsPlaying(false);
    setTransportMode('idle');
    setActiveStep(null);
    playSequenceRef.current = [];
    playRoundIndexRef.current = 0;
  }, [clearPlaybackTimers]);

  const stopRecording = useCallback(() => {
    if (countInTimeoutRef.current) {
      clearTimeout(countInTimeoutRef.current);
      countInTimeoutRef.current = null;
    }
    if (recordTimeoutRef.current) {
      clearTimeout(recordTimeoutRef.current);
      recordTimeoutRef.current = null;
    }
    if (recordIntervalRef.current) {
      clearInterval(recordIntervalRef.current);
      recordIntervalRef.current = null;
    }
    if (recordRafRef.current !== null) {
      cancelAnimationFrame(recordRafRef.current);
      recordRafRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }
    analyserRef.current = null;
    isRecordingRef.current = false;
    if (recordCtxRef.current) {
      recordCtxRef.current.close();
      recordCtxRef.current = null;
    }
    setIsCountingIn(false);
    setIsRecording(false);
    setTransportMode('idle');
    setActiveStep(null);
    setCountInBeat(null);
    setDetectText('');
    lastCommittedStepRef.current = -1;
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopPlayback();
      stopRecording();
    };
  }, [stopPlayback, stopRecording]);

  const resetArrangementState = useCallback(() => {
    setArrangementPhases([]);
    setVisiblePhaseIndex(0);
    setPhaseLabel('');
  }, []);

  const playNotesSequence = useCallback((sequence: ArrangementPhase[]) => {
    if (sequence.length === 0) return;

    clearPlaybackTimers();
    if (audioCtxRef.current) {
      audioCtxRef.current.close();
      audioCtxRef.current = null;
    }

    const AudioContextClass = getAudioContextClass();
    if (!AudioContextClass) {
      setIsPlaying(false);
      setTransportMode('idle');
      return;
    }

    const ctx = new AudioContextClass();
    audioCtxRef.current = ctx;
    void ctx.resume();

    const stepDuration = getTickDuration(PLAY_BPM);
    const totalDurationMs = TOTAL_STEPS * stepDuration * 1000;
    playStepDurationRef.current = stepDuration;
    playSequenceRef.current = sequence;
    playRoundIndexRef.current = 0;

    const runRound = (roundIndex: number) => {
      if (!audioCtxRef.current) return;
      const phase = sequence[roundIndex];
      if (!phase) {
        stopPlayback();
        return;
      }

      playRoundIndexRef.current = roundIndex;
      setVisiblePhaseIndex(roundIndex);
      setPhaseLabel(phase.label);
      setNotes(phase.notes);

      const startTime = audioCtxRef.current.currentTime + 0.08;
      playStartRef.current = startTime;

      phase.notes.forEach((note) => {
        const noteStartTime = startTime + Math.round(note.step) * stepDuration;
        scheduleNotePlayback(audioCtxRef.current!, note, noteStartTime, stepDuration);
      });

      if (playRafRef.current !== null) {
        cancelAnimationFrame(playRafRef.current);
        playRafRef.current = null;
      }

      const tick = () => {
        if (!audioCtxRef.current) return;
        const elapsed = audioCtxRef.current.currentTime - playStartRef.current;
        const step = Math.floor(elapsed / playStepDurationRef.current);
        if (step >= 0 && step < TOTAL_STEPS) {
          setActiveStep(step);
          playRafRef.current = requestAnimationFrame(tick);
          return;
        }
        if (elapsed < TOTAL_STEPS * playStepDurationRef.current) {
          playRafRef.current = requestAnimationFrame(tick);
        }
      };
      tick();

      playRoundTimeoutRef.current = setTimeout(() => {
        setActiveStep(null);
        if (roundIndex + 1 < sequence.length) {
          runRound(roundIndex + 1);
          return;
        }

        if (audioCtxRef.current) {
          audioCtxRef.current.close();
          audioCtxRef.current = null;
        }
        if (playRafRef.current !== null) {
          cancelAnimationFrame(playRafRef.current);
          playRafRef.current = null;
        }
        playRoundTimeoutRef.current = null;
        playSequenceRef.current = [];
        playRoundIndexRef.current = 0;
        setIsPlaying(false);
        setTransportMode('idle');
        setActiveStep(null);
        setVisiblePhaseIndex(sequence.length - 1);
        setNotes(sequence[sequence.length - 1].notes);
        setPhaseLabel(ARRANGEMENT_COMPLETE_LABEL);
      }, totalDurationMs + PLAYBACK_ROUND_DELAY_MS);
    };

    setIsPlaying(true);
    setTransportMode('playing');
    runRound(0);
  }, [clearPlaybackTimers, stopPlayback]);

  const handlePlay = useCallback(() => {
    if (isCountingIn || isRecording) return;
    if (isPlaying) {
      stopPlayback();
      return;
    }

    const phaseSequence: ArrangementPhase[] = arrangementPhases.length > 0
      ? arrangementPhases
      : [{
          index: 1,
          label: '主旋律回放',
          bars: 4,
          voices: ['user' as Voice],
          notes: deriveSustainedNotes(notes),
        }];

    playNotesSequence(phaseSequence);
  }, [arrangementPhases, isCountingIn, isPlaying, isRecording, notes, playNotesSequence, stopPlayback]);

  const handleRecord = useCallback(async () => {
    if (isCountingIn || isRecording) {
      stopRecording();
      return;
    }
    if (isPlaying) stopPlayback();
    resetArrangementState();

    if (!navigator.mediaDevices?.getUserMedia) {
      alert('当前浏览器环境不支持麦克风录音，或页面不是 HTTPS / localhost。');
      return;
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (error) {
      alert(formatRecordErrorMessage(error));
      return;
    }

    const AudioContextClass = getAudioContextClass();
    if (!AudioContextClass) return;

    const ctx: AudioContext = new AudioContextClass();
    await ctx.resume();
    recordCtxRef.current = ctx;
    mediaStreamRef.current = stream;

    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.2;
    source.connect(analyser);
    analyserRef.current = analyser;

    const stepDuration = getTickDuration(RECORD_BPM);
    recordStepDurationRef.current = stepDuration;
    const baseTime = ctx.currentTime + 0.25;
    const recordStartTime = baseTime + 4 * TICKS_PER_BEAT * stepDuration;
    recordStartTimeRef.current = recordStartTime;

    const clickFreq = 1000;
    for (let i = 0; i < 4; i++) {
      const t = baseTime + i * TICKS_PER_BEAT * stepDuration;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = clickFreq;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.9, t + 0.002);
      gain.gain.linearRampToValueAtTime(0, t + 0.06);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.08);
    }

    setNotes([]);
    setIsCountingIn(true);
    setTransportMode('countin');
    setCountInBeat(1);
    isRecordingRef.current = false;
    recordBucketsRef.current = Array.from({ length: TOTAL_STEPS }, () => []);
    userNoteIdsByStepRef.current = {};
    lastCommittedStepRef.current = -1;

    const countInTick = () => {
      if (!recordCtxRef.current) return;
      const dt = recordCtxRef.current.currentTime - baseTime;
      const beat = Math.floor(dt / (TICKS_PER_BEAT * stepDuration)) + 1;
      const clampedBeat = Math.max(1, Math.min(4, beat));
      setCountInBeat(clampedBeat);
      if (recordCtxRef.current.currentTime >= recordStartTime) return;
      recordRafRef.current = requestAnimationFrame(countInTick);
    };
    countInTick();

    countInTimeoutRef.current = setTimeout(() => {
      setIsCountingIn(false);
      setIsRecording(true);
      setTransportMode('recording');
      setCountInBeat(null);
      setDetectText('');
      isRecordingRef.current = true;

      const buffer = new Float32Array(analyser.fftSize);
      recordIntervalRef.current = setInterval(() => {
        if (!isRecordingRef.current) return;
        const now = ctx.currentTime;
        const step = Math.floor((now - recordStartTimeRef.current) / stepDuration);
        if (step < 0 || step >= TOTAL_STEPS) return;

        analyser.getFloatTimeDomainData(buffer);
        const freq = autoCorrelate(buffer, ctx.sampleRate);
        if (freq && freq >= 80 && freq <= 1000) {
          const midi = freqToMidi(freq);
          if (isFinite(midi)) recordBucketsRef.current[step].push(midi);
        }

        if (step !== lastCommittedStepRef.current) {
          lastCommittedStepRef.current = step;
          setActiveStep(step);
        }

        const m = median(recordBucketsRef.current[step]);
        if (m !== null) {
          const minMidi = Math.min(...Object.values(PITCH_TO_MIDI));
          const maxMidi = Math.max(...Object.values(PITCH_TO_MIDI));
          let shiftedMidi = m + RECORD_OCTAVE_SHIFT;
          while (shiftedMidi < minMidi) shiftedMidi += 12;
          while (shiftedMidi > maxMidi) shiftedMidi -= 12;
          const pitchIndex = snapToDunhuangPitch(midiToPitchIndex(shiftedMidi));
          const id = userNoteIdsByStepRef.current[step] ?? generateId();
          userNoteIdsByStepRef.current[step] = id;
          setDetectText(`${midiToNoteName(m)}↑8 → ${pitchIndexToNoteName(pitchIndex)}`);
          setNotes((prev) => {
            const otherNotes = prev.filter((n) => n.voice !== 'user');
            const userNotes = prev.filter((n) => n.voice === 'user' && Math.round(n.step) !== step);
            return [...otherNotes, ...userNotes, { id, pitch: pitchIndex, step, duration: 1, voice: 'user' }];
          });
        }
      }, 40);

      recordTimeoutRef.current = setTimeout(() => {
        isRecordingRef.current = false;
        setIsRecording(false);
        setIsCountingIn(false);
        setTransportMode('idle');
        if (recordIntervalRef.current) {
          clearInterval(recordIntervalRef.current);
          recordIntervalRef.current = null;
        }

        const buckets = recordBucketsRef.current;
        const pitchTicks: Array<number | null> = [];
        for (let step = 0; step < TOTAL_STEPS; step++) {
          const m = median(buckets[step]);
          if (m === null) {
            pitchTicks.push(null);
            continue;
          }
          const minMidi = Math.min(...Object.values(PITCH_TO_MIDI));
          const maxMidi = Math.max(...Object.values(PITCH_TO_MIDI));
          let shiftedMidi = m + RECORD_OCTAVE_SHIFT;
          while (shiftedMidi < minMidi) shiftedMidi += 12;
          while (shiftedMidi > maxMidi) shiftedMidi -= 12;
          const pitchIndex = snapToDunhuangPitch(midiToPitchIndex(shiftedMidi));
          pitchTicks.push(pitchIndex);
        }

        setNotes(buildNotesFromPitchTicks(pitchTicks));
        setDetectText('');

        if (mediaStreamRef.current) {
          mediaStreamRef.current.getTracks().forEach((t) => t.stop());
          mediaStreamRef.current = null;
        }
        analyserRef.current = null;
        if (recordCtxRef.current) {
          recordCtxRef.current.close();
          recordCtxRef.current = null;
        }
        setActiveStep(null);
      }, TOTAL_STEPS * stepDuration * 1000 + 80);
    }, 4 * TICKS_PER_BEAT * stepDuration * 1000);
  }, [isCountingIn, isRecording, isPlaying, resetArrangementState, stopPlayback, stopRecording]);

  const handleGridClick = useCallback((pitch: number, step: number) => {
    resetArrangementState();
    setNotes((prev) => {
      const userNotes = prev.filter((n) => n.voice === 'user');
      const otherNotes = prev.filter((n) => n.voice !== 'user');

      const clickX = step * 48; // CELL_WIDTH
      const clickY = pitch * 16; // CELL_HEIGHT
      let clickedIndex = -1;
      let minDistance = 24;

      userNotes.forEach((n, idx) => {
        const nx = n.step * 48;
        const ny = n.pitch * 16;
        const dist = Math.hypot(nx - clickX, ny - clickY);
        if (dist < minDistance) {
          minDistance = dist;
          clickedIndex = idx;
        }
      });

      if (clickedIndex >= 0) {
        userNotes.splice(clickedIndex, 1);
      } else {
        userNotes.push({
          id: generateId(),
          pitch,
          step,
          duration: 1,
          voice: 'user',
        });
      }

      return [...otherNotes, ...userNotes];
    });
  }, [resetArrangementState]);

  const handleDrawEnd = useCallback((path: {step: number, pitch: number}[]) => {
    resetArrangementState();
    setNotes((prev) => {
      const stepPitchMap = new Map<number, number[]>();

      for (let i = 0; i < path.length - 1; i++) {
        const p1 = path[i];
        const p2 = path[i+1];
        const steps = Math.max(1, Math.abs(p2.step - p1.step) * 48);
        const numSamples = Math.ceil(steps);
        for (let j = 0; j <= numSamples; j++) {
          const t = numSamples === 0 ? 0 : j / numSamples;
          const s = p1.step + t * (p2.step - p1.step);
          const p = p1.pitch + t * (p2.pitch - p1.pitch);
          const col = Math.round(s);
          if (col >= 0 && col < TOTAL_STEPS) {
            if (!stepPitchMap.has(col)) stepPitchMap.set(col, []);
            stepPitchMap.get(col)!.push(p);
          }
        }
      }

      const pitchTicks: Array<number | null> = Array.from({ length: TOTAL_STEPS }, () => null);
      const newCols = new Set(stepPitchMap.keys());

      for (const [col, pitches] of stepPitchMap.entries()) {
        const avgPitch = pitches.reduce((sum, p) => sum + p, 0) / pitches.length;
        pitchTicks[col] = snapToDunhuangPitch(Math.round(avgPitch));
      }

      const otherNotes = prev.filter((n) => n.voice !== 'user');
      const userNotes = prev.filter((n) => n.voice === 'user');

      // Remove existing user notes in columns that were drawn over
      const filteredUserNotes = userNotes.filter((n) => !newCols.has(Math.round(n.step)));

      const combined = [...otherNotes, ...filteredUserNotes, ...buildNotesFromPitchTicks(pitchTicks)];
      // 自动处理成符合要求的旋律
      return getSnappedNotes(combined);
    });
  }, [resetArrangementState]);

  const handleClear = useCallback(() => {
    resetArrangementState();
    setNotes([]);
  }, [resetArrangementState]);

  const handleHarmonize = useCallback(async () => {
    if (isCountingIn || isRecording) return;
    if (isGenerating) return;
    if (!AI_ENABLED) {
      alert(AI_DISABLED_MESSAGE);
      return;
    }
    if (isPlaying) stopPlayback();
    setIsGenerating(true);

    // 1. 先触发吸附更新
    const snappedNotes = deriveSustainedNotes(notes);
    setNotes(snappedNotes);

    // 2. 将用户绘制的旋律打包准备发送给 AI 服务器
    const userNotes = snappedNotes.filter((n) => n.voice === 'user');
    if (userNotes.length === 0) {
      setIsGenerating(false);
      alert('请先输入或录入主旋律，再生成和声。');
      return;
    }

    const melodyPayload = userNotes.map(n => ({
      step: n.step,
      pitch: n.pitch,
      duration: n.duration,
    }));

    try {
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), AI_REQUEST_TIMEOUT_MS);
      try {
        // 3. 向我们刚刚搭建的腾讯云 GPU 服务器发起真实请求
        const response = await fetch(AI_API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ melody: melodyPayload }),
          signal: controller.signal
        });

        if (!response.ok) {
          let detail = '';
          try {
            const errorData = await response.json();
            detail = typeof errorData?.detail === 'string' ? errorData.detail : JSON.stringify(errorData);
          } catch {
            detail = response.statusText;
          }
          throw new Error(`服务器返回 ${response.status}${detail ? `，${detail}` : ''}`);
        }

        const data = await response.json();
        console.log("AI 大脑返回的原始配器数据:", data);

        if (data.status === "success" && data.generated_notes) {
          const leadNotes = Array.isArray(data.lead_notes)
            ? (data.lead_notes as Note[]).map(normalizeNote)
            : userNotes.map(normalizeNote);
          const generatedNotes = (data.generated_notes as Note[]).map(normalizeNote);
          const phases = buildSequentialArrangementPhases(leadNotes, generatedNotes);
          setArrangementPhases(phases);
          playNotesSequence(phases);
        } else {
          throw new Error("API 返回格式不正确");
        }
      } finally {
        window.clearTimeout(timeoutId);
      }

    } catch (error) {
      console.error("AI 音乐生成失败:", error);
      alert(formatAiErrorMessage(error));
    } finally {
      setIsGenerating(false);
    }
  }, [isCountingIn, isGenerating, isPlaying, isRecording, notes, playNotesSequence, stopPlayback]);

  const currentPhaseCount = arrangementPhases.length;
  const currentPhase = currentPhaseCount > 0
    ? arrangementPhases[Math.min(visiblePhaseIndex, currentPhaseCount - 1)]
    : null;
  const phaseSummary = currentPhaseCount > 0
    ? `第 ${Math.min(visiblePhaseIndex + 1, currentPhaseCount)} 轮 / 共 ${currentPhaseCount} 轮`
    : '当前仅播放主旋律';
  const currentPhaseVoiceLabels = currentPhase?.voices.map((voice) => VOICE_LABELS[voice] ?? voice).join(' / ');

  return (
    <div className="min-h-screen bg-[#FDFBF7] text-[#3E2723] font-serif flex flex-col items-center py-10 px-4">
      <header className="mb-8 text-center max-w-2xl">
        <h1 className="text-4xl md:text-5xl font-bold mb-3 text-[#2D1B15] tracking-tight" style={{ fontFamily: '"Kaiti SC", "STKaiti", "KaiTi", "楷体", serif' }}>
          灵岩谱曲台
        </h1>
        <p className="text-[#5D4037] text-sm md:text-base leading-relaxed" style={{ fontFamily: '"Kaiti SC", "STKaiti", "KaiTi", "楷体", serif' }}>在下方五线谱上绘制主旋律后，系统会将音符吸附到敦煌音阶（1-2-3-♯4-5-6）与节奏网格，并通过 AI 后端生成可直接试听的四声部和声建议。</p>
      </header>

      <div className="w-full max-w-6xl flex-1 flex flex-col items-center gap-8">
        <ControlBar 
          onHarmonize={handleHarmonize} 
          onClear={handleClear} 
          onPlay={handlePlay}
          onRecord={handleRecord}
          isGenerating={isGenerating} 
          isPlaying={isPlaying}
          isCountingIn={isCountingIn}
          isRecording={isRecording}
          aiEnabled={AI_ENABLED}
        />

        <TransportBar
          mode={transportMode}
          totalSteps={TOTAL_STEPS}
          activeStep={activeStep}
          countInBeat={countInBeat}
          detectText={detectText}
          phaseLabel={phaseLabel}
          phaseSummary={phaseSummary}
        />

        <div className="w-full max-w-6xl grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
          <div className="rounded-2xl border border-[#EFEBE1] bg-white/70 px-5 py-4 text-sm text-[#5D4037]">
            <div className="text-xs uppercase tracking-[0.18em] text-[#8D6E63]">织谱流程</div>
            <div className="mt-2 text-lg text-[#2D1B15]">{phaseLabel || '等待生成配器'}</div>
            <div className="mt-1 text-sm text-[#6E5A4A]">
              {currentPhase ? `本轮固定 4 小节试听：${currentPhaseVoiceLabels}` : '生成后会按四小节为一轮，逐轨加入箫、琵琶、都塔尔低音与鼓点。'}
            </div>
          </div>
          <div className="rounded-2xl border border-[#EFEBE1] bg-white/70 px-5 py-4 text-sm text-[#5D4037] min-w-[220px]">
            <div className="text-xs uppercase tracking-[0.18em] text-[#8D6E63]">当前轮次</div>
            <div className="mt-2 text-lg text-[#2D1B15]">{phaseSummary}</div>
          </div>
        </div>
        
        <div className="w-full overflow-x-auto pb-8 flex justify-center">
          <ScoreGrid 
            notes={notes} 
            onGridClick={handleGridClick} 
            onDrawEnd={handleDrawEnd}
            totalSteps={TOTAL_STEPS} 
            totalPitches={TOTAL_PITCHES} 
            activeStep={activeStep}
            mode={transportMode}
          />
        </div>
      </div>
      
      <footer className="mt-auto pt-8 text-[#8D6E63] text-xs text-center" style={{ fontFamily: '"Kaiti SC", "STKaiti", "KaiTi", "楷体", serif' }}>灵岩谱曲台 - Lingyan Composing Platform | 基于 1-2-3-♯4-5-6 敦煌音阶体系</footer>
    </div>
  );
}

export default App;
