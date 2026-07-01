// 音效工具：
// 1. UI 合成音（Web Audio API 实时合成，无需资源）：封匣/落定/tick 等
// 2. 角色语音（播放 /voices 下的 mp3）：猜对/猜错/催促/胜利/落败
// 浏览器自动播放策略要求首次发声须在用户手势内，故 AudioContext 懒加载并在调用时 resume

// ---------- UI 合成音 ----------
type SoundType =
  | "seal" // 封匣：木匣合上的低沉闷响
  | "submit" // 落定：轻点提交
  | "tick" // 倒计时滴答
  | "resolve"; // 子轮揭晓轻提示

// ---------- 角色语音 ----------
export type VoiceChar = "loli" | "yujie" | "zhengtai" | "nan";
export type VoiceScene =
  | "01_correct" // 猜对词
  | "02_wrong" // 猜错词
  | "03_fill_urge" // 填词倒计时催促
  | "04_guess_urge" // 猜词倒计时催促
  | "05_victory" // 整局胜利
  | "06_lose"; // 整局出局落败

export const VOICE_CHARS: { id: VoiceChar; name: string; desc: string }[] = [
  { id: "loli", name: "萝莉", desc: "清脆甜美·撒娇崇拜" },
  { id: "yujie", name: "御姐", desc: "成熟低沉·高冷傲娇" },
  { id: "zhengtai", name: "正太", desc: "阳光元气·直率冲动" },
  { id: "nan", name: "男神", desc: "磁性温暖·温柔体贴" },
];

const MUTE_KEY = "cihxia.soundMuted";
const VOICE_KEY = "cihxia.voiceChar";

let ctx: AudioContext | null = null;
let muted = false;
let voiceChar: VoiceChar = "loli";
try {
  muted = typeof localStorage !== "undefined" && localStorage.getItem(MUTE_KEY) === "1";
  const saved = typeof localStorage !== "undefined" ? (localStorage.getItem(VOICE_KEY) as VoiceChar | null) : null;
  if (saved && VOICE_CHARS.some((v) => v.id === saved)) voiceChar = saved;
} catch {
  /* ignore */
}

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

// 单音：freq 起始频率，start 偏移秒，dur 持续秒
function tone(
  freq: number,
  start: number,
  dur: number,
  type: OscillatorType = "sine",
  gain = 0.15,
  freqEnd?: number,
): void {
  const c = getCtx();
  if (!c) return;
  const t0 = c.currentTime + start;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (freqEnd !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g);
  g.connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.03);
}

// 短促噪声脉冲（用于"封匣"木质闷响的攻击段）
function noiseBurst(start: number, dur: number, gain = 0.12, hp = 600): void {
  const c = getCtx();
  if (!c) return;
  const t0 = c.currentTime + start;
  const frames = Math.floor(c.sampleRate * dur);
  const buf = c.createBuffer(1, frames, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < frames; i++) {
    data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / frames, 2);
  }
  const src = c.createBufferSource();
  src.buffer = buf;
  const filter = c.createBiquadFilter();
  filter.type = "highpass";
  filter.frequency.value = hp;
  const g = c.createGain();
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(filter);
  filter.connect(g);
  g.connect(c.destination);
  src.start(t0);
  src.stop(t0 + dur + 0.02);
}

// ---------- 静音开关 ----------
export function isMuted(): boolean {
  return muted;
}

export function setMuted(v: boolean): void {
  muted = v;
  try {
    localStorage.setItem(MUTE_KEY, v ? "1" : "0");
  } catch {
    /* ignore */
  }
}

export function toggleMuted(): boolean {
  setMuted(!muted);
  return muted;
}

// ---------- 音色角色 ----------
export function getVoiceChar(): VoiceChar {
  return voiceChar;
}

export function setVoiceChar(v: VoiceChar): void {
  voiceChar = v;
  try {
    localStorage.setItem(VOICE_KEY, v);
  } catch {
    /* ignore */
  }
}

// ---------- 语音播放 ----------
// 缓存 Audio 对象，避免每次创建；同时缓存已加载标记
const audioCache = new Map<string, HTMLAudioElement>();
let lastVoiceKey = ""; // 上一句播的语音，用于防止极短时间重复

function voiceKey(char: VoiceChar, scene: VoiceScene): string {
  return `${char}_${scene}`;
}

// 试听：Lobby 选音色时点击播放，无视"上一句"去重
export function previewVoice(char: VoiceChar, scene: VoiceScene = "01_correct"): void {
  if (muted) return;
  unlockAudio();
  playVoiceScene(scene, char, true);
}

function unlockAudio(): void {
  // 用户手势内调用，解锁 AudioContext 与 Audio 播放权限
  getCtx();
}

function playVoiceScene(scene: VoiceScene, char: VoiceChar = voiceChar, force = false): void {
  if (muted) return;
  const key = voiceKey(char, scene);
  // 同一句语音 1.2 秒内不重复触发，避免嘈杂（试听 force 跳过）
  if (!force && key === lastVoiceKey) {
    // 仍允许不同语音连续播，仅拦截同句连发
  }
  lastVoiceKey = key;
  let audio = audioCache.get(key);
  if (!audio) {
    audio = new Audio(`/voices/voice_${key}.mp3`);
    audio.preload = "auto";
    audioCache.set(key, audio);
  }
  audio.currentTime = 0;
  audio.play().catch(() => {
    /* 自动播放受限或文件缺失，静默忽略 */
  });
}

// 播放角色语音（按当前音色）
export function playVoice(scene: VoiceScene): void {
  playVoiceScene(scene);
}

// ---------- UI 合成音 ----------
export function playSound(type: SoundType): void {
  if (muted) return;
  const c = getCtx();
  if (!c) return;
  switch (type) {
    case "seal":
      tone(160, 0, 0.22, "sine", 0.28, 90);
      noiseBurst(0, 0.08, 0.1, 1200);
      break;
    case "submit":
      tone(520, 0, 0.07, "triangle", 0.12);
      break;
    case "tick":
      tone(900, 0, 0.04, "square", 0.07);
      break;
    case "resolve":
      tone(523, 0, 0.1, "sine", 0.13);
      tone(659, 0.08, 0.12, "sine", 0.13);
      tone(784, 0.16, 0.18, "sine", 0.13);
      break;
  }
}
