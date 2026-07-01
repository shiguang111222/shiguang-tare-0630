// 游戏状态机：阶段流转、猜词结算、角色技能、断墨候选、超时淘汰、公屏猜词展示
import type { ChatMessage, Role, Segment, Theme, DualForm } from '../shared/types.js';
import { DIFFICULTY_INFO, ALL_THEMES } from '../shared/types.js';
import { type RoomState, type Player, pushChat } from './store.js';
import { generateStory, generateDuanmoCandidates, type StoryWord } from './story.js';
import cnchar from 'cnchar';

function nick(room: RoomState, id: number): string {
  return room.players.find((p) => p.id === id)?.nickname || `玩家${id}`;
}

function isChineseWord(w: string): boolean {
  const chars = Array.from(w);
  if (chars.length < 2 || chars.length > 4) return false;
  return chars.every((c) => /[\u4e00-\u9fff]/.test(c));
}

// 计算汉字词的笔画总数（用 cnchar；查不到的字按 0 计）
function strokeCount(word: string): number {
  let sum = 0;
  for (const c of Array.from(word)) {
    sum += singleStroke(c);
  }
  return sum;
}

// 单字笔画数
function singleStroke(c: string): number {
  try {
    const n = (cnchar as unknown as { stroke: (ch: string) => number | number[] }).stroke(c);
    return Array.isArray(n) ? (n[0] || 0) : (n || 0);
  } catch {
    return 0;
  }
}

// 计算注入词的笔画总数、首字笔画、尾字笔画
function wordStrokeInfo(word: string): { total: number; head: number; tail: number } {
  const chars = Array.from(word);
  if (chars.length === 0) return { total: 0, head: 0, tail: 0 };
  return {
    total: strokeCount(word),
    head: singleStroke(chars[0]),
    tail: singleStroke(chars[chars.length - 1]),
  };
}

const PUNCT = /[，。！？、；：""''「」（）()\[\]【】…—\-\s,.;:!?]/;

export function startGame(room: RoomState): { ok: boolean; error?: string } {
  if (room.players.length < 2) return { ok: false, error: '至少需要 2 名玩家' };
  if (room.phase !== 'lobby') return { ok: false, error: '游戏已开始' };
  const noRole = room.players.find((p) => !p.role);
  if (noRole) return { ok: false, error: `${nick(room, noRole.id)} 未选择角色` };
  room.phase = 'words';
  room.currentRound = 1;
  room.subRound = 0;
  resetRoundWords(room);
  return { ok: true };
}

function resetRoundWords(room: RoomState): void {
  for (const p of room.players) {
    p.secretWord = '';
    p.secretWord2 = '';
    p.word2Strokes = 0;
    p.headStrokes2 = 0;
    p.tailStrokes2 = 0;
    p.word2Submitted = false;
    p.wordStrokes = 0;
    p.headStrokes = 0;
    p.tailStrokes = 0;
    p.themeChoice = null;
    // 命与猜词次数依角色/形态而定：双生双形态=2命1猜，双生单形态=1命2猜，其余=1命1猜
    if (p.role === '双生' && p.dualForm === 'double') {
      p.lives = 2;
      p.guessesPerRound = 1;
    } else if (p.role === '双生' && p.dualForm === 'single') {
      p.lives = 1;
      p.guessesPerRound = 2;
    } else {
      p.lives = 1;
      p.guessesPerRound = 1;
    }
    p.guessesUsed = 0;
    p.blinded = false;
    p.scapegoatTarget = null; // 每局可重新指定（未发动前）
    // scapegoatUsed 跨局保留（技能仅一次）
    p.wordSubmitted = false;
    p.done = false;
    p.alive = true;
    p.betOn = null;
    p.prunedThisRound = false;
  }
  room.storyText = '';
  room.segments = [];
  room.duanmoChoices = [];
  room.duanmoTarget = null;
  room.pruned = [];
  room.pendingGuesses = {};
  room.eliminationOrder = [];
  room.subRound = 0;
  room.storyLoading = false;
  room.theme = null;
  room.duanmoCache = [];
  room.shirenRevealed = []; // 识人：每局重置（新词新长度）
}

export function submitWord(room: RoomState, playerId: number, word: string, word2?: string): { ok: boolean; error?: string; messages: ChatMessage[] } {
  if (room.phase !== 'words') return { ok: false, error: '当前不可填词', messages: [] };
  const p = room.players.find((x) => x.id === playerId);
  if (!p) return { ok: false, error: '玩家不存在', messages: [] };
  if (!p.alive) return { ok: false, error: '你已出局', messages: [] };
  const w = (word || '').trim();
  if (!isChineseWord(w)) return { ok: false, error: '词需为 2-4 个汉字', messages: [] };
  // 双生双形态需提交两词，且两词不可相同
  const isDouble = p.role === '双生' && p.dualForm === 'double';
  let w2 = '';
  if (isDouble) {
    w2 = (word2 || '').trim();
    if (!isChineseWord(w2)) return { ok: false, error: '双生双形态需提交两个 2-4 字汉字词', messages: [] };
    if (w2 === w) return { ok: false, error: '两词不可相同', messages: [] };
  }
  const dup = room.players.find((x) => x.id !== playerId && (x.secretWord === w || (isDouble && x.secretWord === w2)));
  p.secretWord = w;
  const info = wordStrokeInfo(w);
  p.wordStrokes = info.total;
  p.headStrokes = info.head;
  p.tailStrokes = info.tail;
  if (isDouble) {
    p.secretWord2 = w2;
    const info2 = wordStrokeInfo(w2);
    p.word2Strokes = info2.total;
    p.headStrokes2 = info2.head;
    p.tailStrokes2 = info2.tail;
    p.word2Submitted = true;
  }
  p.wordSubmitted = true;
  p.done = true;
  const messages: ChatMessage[] = [];
  const done = room.players.filter((x) => x.alive && x.wordSubmitted).length;
  const total = room.players.filter((x) => x.alive).length;
  messages.push(pushChat(room, { type: 'system', text: `${nick(room, playerId)} 已封匣 (${done}/${total})` }));
  if (dup) messages.push(pushChat(room, { type: 'system', text: '提示：有玩家给出了相同的词。' }));
  return { ok: true, messages };
}

// 封匣推进条件：存活且已封匣者 >= 2，且所有存活者均已封匣（断线不再视为已提交，须等 60s 超时淘汰未封匣者）
export function allWordsSubmitted(room: RoomState): boolean {
  const alive = room.players.filter((p) => p.alive);
  if (alive.length < 2) return false;
  return alive.every((p) => p.wordSubmitted);
}

// 识人技能：每局（封匣后、故事生成前）揭示一名未晓玩家注入词之字数
// 候选：存活、非识人本人、尚未在 shirenRevealed 中；若均已知晓则不再揭示
function revealShirenOne(room: RoomState): void {
  const shiren = room.players.find((p) => p.role === '识人' && p.alive);
  if (!shiren) return;
  const candidates = room.players.filter(
    (p) => p.alive && p.id !== shiren.id && !room.shirenRevealed.includes(p.id),
  );
  if (candidates.length === 0) return;
  const pick = candidates[Math.floor(Math.random() * candidates.length)];
  room.shirenRevealed.push(pick.id);
}

// 立意多故事：2-3 人同选立意时，按立意人数生成多段独立叙事
// 把所有玩家词随机分配到各立意名下，每段故事长度随分配到的词数（沿用 multiplier）
// 各段叙事拼接为一段全文，词块位置按累计偏移调整
async function generateMultiStory(
  words: StoryWord[],
  multiplier: number,
  liyiPlayers: Player[],
): Promise<{ text: string; segments: Segment[]; unembedded: number[] }> {
  const n = liyiPlayers.length;
  const shuffled = [...words];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  // 轮流分发到 n 组，保证词数尽量均匀
  const groups: StoryWord[][] = Array.from({ length: n }, () => []);
  shuffled.forEach((w, i) => groups[i % n].push(w));
  // 仅对分到词的立意生成故事（词数<立意人数时个别立意无词则跳过）
  const used: { group: StoryWord[]; theme: Theme | null }[] = [];
  for (let i = 0; i < n; i++) {
    if (groups[i].length > 0) {
      used.push({ group: groups[i], theme: liyiPlayers[i].themeChoice });
    }
  }
  let fullText = '';
  const allSegments: Segment[] = [];
  const unembedded: number[] = [];
  for (const { group, theme } of used) {
    const s = await generateStory(group, multiplier, theme);
    const offset = fullText.length;
    fullText += s.text;
    for (const seg of s.segments) {
      allSegments.push({ start: seg.start + offset, end: seg.end + offset, ownerId: seg.ownerId });
    }
    for (const u of s.unembedded) unembedded.push(u);
  }
  allSegments.sort((a, b) => a.start - b.start);
  return { text: fullText, segments: allSegments, unembedded };
}

// 省笔自动拭字：从合格字符（非玩家词、非已拭、非标点）中随机拭去 count 个
function autoPrune(room: RoomState, count: number): number {
  const eligible: number[] = [];
  for (let i = 0; i < room.storyText.length; i++) {
    if (room.pruned.includes(i)) continue;
    if (room.segments.some((s) => i >= s.start && i < s.end)) continue;
    if (PUNCT.test(room.storyText[i])) continue;
    eligible.push(i);
  }
  let wiped = 0;
  for (let k = 0; k < count && eligible.length > 0; k++) {
    const idx = Math.floor(Math.random() * eligible.length);
    room.pruned.push(eligible[idx]);
    eligible.splice(idx, 1);
    wiped++;
  }
  return wiped;
}

// 全部封匣后触发故事生成（异步）
export async function generateAndStartPlay(room: RoomState): Promise<ChatMessage[]> {
  const messages: ChatMessage[] = [];
  room.storyLoading = true;
  messages.push(pushChat(room, { type: 'system', text: '全部已封匣，正在研墨成文…' }));
  // 收集玩家词：双生双形态贡献两词（同一 playerId，两段皆归其所有）
  const words: StoryWord[] = [];
  for (const p of room.players) {
    if (p.alive && p.secretWord) {
      words.push({ playerId: p.id, word: p.secretWord });
      if (p.role === '双生' && p.dualForm === 'double' && p.secretWord2) {
        words.push({ playerId: p.id, word: p.secretWord2 });
      }
    }
  }
  const multiplier = DIFFICULTY_INFO[room.difficulty].multiplier;
  // 识人：每局揭示一名未晓玩家词长（封匣后推进一次；至全部知晓止）
  revealShirenOne(room);
  // 立意：收集存活立意玩家，各补齐主题（未选则随机）；多人同选则生成多故事
  const liyiAlive = room.players.filter((p) => p.role === '立意' && p.alive);
  for (const lp of liyiAlive) {
    if (!lp.themeChoice) {
      lp.themeChoice = ALL_THEMES[Math.floor(Math.random() * ALL_THEMES.length)];
    }
  }
  let story: { text: string; segments: Segment[]; unembedded: number[] };
  try {
    if (liyiAlive.length >= 2 && words.length >= 2) {
      story = await generateMultiStory(words, multiplier, liyiAlive);
      room.theme = null; // 多立意：无单一主题
      messages.push(pushChat(room, { type: 'system', text: `立意 ${liyiAlive.length} 人同局，分作 ${liyiAlive.length} 段叙事，词随机分配。` }));
    } else {
      // 单立意或无立意：单故事；单立意时同步 room.theme 兼容旧逻辑
      const theme = liyiAlive.length === 1 ? liyiAlive[0].themeChoice : null;
      room.theme = theme;
      story = await generateStory(words, multiplier, theme);
    }
  } catch {
    story = { text: '', segments: [], unembedded: words.map((w) => w.playerId) };
  }
  room.storyText = story.text;
  room.segments = story.segments;
  room.phase = 'play';
  room.subRound = 1;
  room.storyLoading = false;
  // 省笔：开局自动拭去等于玩家人数之字
  const shengbi = room.players.find((p) => p.role === '省笔' && p.alive);
  if (shengbi && room.storyText.length > 0) {
    const wiped = autoPrune(room, room.players.length);
    if (wiped > 0) {
      messages.push(pushChat(room, { type: 'system', text: `省笔开匣拭去 ${wiped} 字。` }));
    }
  }
  for (const p of room.players) {
    if (p.alive) {
      p.guessesUsed = 0;
      // 双生双形态满命（2命）时不可猜词，直接落定
      p.done = (p.role === '双生' && p.dualForm === 'double' && p.lives >= 2);
      p.prunedThisRound = false;
      p.betOn = null;
    }
  }
  room.pendingGuesses = {};
  await buildDuanmoChoices(room);
  messages.push(pushChat(room, { type: 'system', text: `叙事已成（${story.text.length}字），第 1 轮猜词开始。` }));
  if (story.unembedded.length > 0) {
    messages.push(pushChat(room, { type: 'system', text: '有词语未能嵌入叙事，相关玩家本局无法被猜中出局。' }));
  }
  // 借命在场通报：第一局开局宣告，众人获自杀之技（可破借命之术）
  if (room.currentRound === 1) {
    const jieming = room.players.find((p) => p.role === '借命' && p.alive);
    if (jieming) {
      messages.push(pushChat(room, { type: 'system', text: '借命在场！众人获自杀之技：可自猜己词赌命，若借命绑定己身则反噬借命，借命亡而己续其词（不知所得）。' }));
    }
  }
  return messages;
}

// 构建断墨候选词块：候选总数 = 3 + 人数*2，恰含 1 个真实玩家词
// 干扰块优先由 AI（DeepSeek）从故事中自然断句得到，不足再用随机切片兜底
// 优化1：首轮一次性请求多轮用量缓存于 room.duanmoCache，后续子轮从缓存取，不够再补，避免每子轮都调 AI
// 优化2：AI 返回的 3-4 字词会展开成 2/3/4 字多形态（如"天下无敌"→"天下"/"无敌"/"天下无敌"），
//        既防候选不足，又让非两字玩家词不致在一堆两字候选中过于突兀
// 优化3：轮次过长、候选实在没新的时，允许复用（重叠）已有干扰块，保证数量足够
export async function buildDuanmoChoices(room: RoomState): Promise<void> {
  room.duanmoChoices = [];
  room.duanmoTarget = null;
  const duanmo = room.players.find((p) => p.role === '断墨' && p.alive);
  if (!duanmo) return;
  if (room.storyText.length === 0) return;
  // 可被断墨猜中的目标：存活、非断墨自己、词已嵌入叙事
  const eligible = room.players.filter(
    (p) => p.alive && p.id !== duanmo.id && room.segments.some((s) => s.ownerId === p.id),
  );
  if (eligible.length === 0) return;
  const target = eligible[Math.floor(Math.random() * eligible.length)];
  const targetSeg = room.segments.find((s) => s.ownerId === target.id)!;
  room.duanmoTarget = target.id;

  // 干扰块数量：3 + 总人数*2（与真实词合计 4 + 总人数*2）。数量增多以平衡断墨过强
  const decoyCount = 3 + room.players.length * 2;
  const decoys: Segment[] = [];

  // AI 自然断句：把玩家词文本作为避让词传入，避免生成与玩家词重叠的候选
  const avoidWords = room.segments.map((s) => room.storyText.slice(s.start, s.end));

  // 校验单个候选字符串是否"永久可用"：长度 2-4、在原文中、不与任何玩家词重叠、不含标点
  // 返回定位后的 Segment；与"本轮已有干扰块冲突"不算永久无效，故不在此判定
  const locateValid = (w: string): Segment | null => {
    const chars = Array.from(w);
    if (chars.length < 2 || chars.length > 4) return null;
    const idx = room.storyText.indexOf(w);
    if (idx === -1) return null;
    const start = idx;
    const end = idx + w.length;
    if (room.segments.some((s) => !(end <= s.start || start >= s.end))) return null;
    for (let i = start; i < end; i++) {
      if (PUNCT.test(room.storyText[i])) return null;
    }
    return { start, end };
  };

  // 多形态展开：把一个 3-4 字词切成 2/3/4 字的多形态候选
  // 例如 "天下无敌" → ["天下","无敌","天下无敌"]；"月光下" → ["月光","光下","月光下"]
  const expandForms = (w: string): string[] => {
    const chars = Array.from(w);
    const n = chars.length;
    if (n < 2 || n > 4) return n >= 2 && n <= 4 ? [w] : [];
    const forms = new Set<string>();
    forms.add(w); // 原形保留
    // 切出所有 2 字子串
    for (let i = 0; i + 2 <= n; i++) forms.add(chars.slice(i, i + 2).join(''));
    // 3-4 字词额外切 3 字子串
    if (n >= 3) {
      for (let i = 0; i + 3 <= n; i++) forms.add(chars.slice(i, i + 3).join(''));
    }
    return Array.from(forms);
  };

  // 从缓存消费。force=false：仅取不冲突的，冲突者跳过保留；force=true：候选实在不足，允许复用冲突项
  const consumeFromCache = (force: boolean): void => {
    let i = 0;
    while (decoys.length < decoyCount && i < room.duanmoCache.length) {
      const w = room.duanmoCache[i];
      // 先做多形态展开，逐个形态定位；任一形态可用即取
      const forms = expandForms(w);
      let picked: Segment | null = null;
      for (const f of forms) {
        const seg = locateValid(f);
        if (seg === null) continue;
        const conflict = decoys.some((d) => !(seg.end <= d.start || seg.start >= d.end));
        if (!conflict || force) {
          picked = seg;
          break;
        }
      }
      if (picked === null) {
        // 所有形态均永久无效 → 丢弃；均仅冲突且非 force → 保留给后续
        const anyValid = forms.some((f) => locateValid(f) !== null);
        if (!anyValid) room.duanmoCache.splice(i, 1);
        else i++;
        continue;
      }
      decoys.push(picked);
      room.duanmoCache.splice(i, 1); // 已用
    }
  };

  const requestBatch = async (requestCount: number): Promise<void> => {
    const batch = await generateDuanmoCandidates(room.storyText, avoidWords, requestCount);
    room.duanmoCache.push(...batch);
  };

  // 首次（缓存不足）一次性请求多轮用量并缓存；后续子轮主要从缓存取，不够再补
  if (room.duanmoCache.length < decoyCount) {
    await requestBatch(Math.max(decoyCount * 3, 30));
  }
  consumeFromCache(false);
  // 仍不足则补一次 AI
  if (decoys.length < decoyCount) {
    await requestBatch(Math.max(decoyCount, 16));
    consumeFromCache(false);
  }
  // 实在没有新的不冲突候选，允许复用（重叠）兜底，保证数量足够
  if (decoys.length < decoyCount) {
    consumeFromCache(true);
  }

  // AI 不够或失败，随机切片兜底（含标点过滤、玩家词避让；允许与已有干扰块复用以补足数量）
  let attempts = 0;
  while (decoys.length < decoyCount && attempts < 600) {
    attempts++;
    const len = 2 + Math.floor(Math.random() * 3); // 2-4 字
    if (room.storyText.length < len) break;
    const start = Math.floor(Math.random() * (room.storyText.length - len + 1));
    const end = start + len;
    // 不可与任何玩家词重叠（永久规则）
    if (room.segments.some((s) => !(end <= s.start || start >= s.end))) continue;
    // 不可含标点
    let hasPunct = false;
    for (let i = start; i < end; i++) {
      if (PUNCT.test(room.storyText[i])) { hasPunct = true; break; }
    }
    if (hasPunct) continue;
    decoys.push({ start, end });
  }

  // 合并真实词 + 干扰块，打乱
  const all: Segment[] = [{ start: targetSeg.start, end: targetSeg.end }, ...decoys];
  for (let i = all.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [all[i], all[j]] = [all[j], all[i]];
  }
  room.duanmoChoices = all;
}

export function submitGuess(
  room: RoomState,
  playerId: number,
  payload: { start: number; end: number } | { choiceIndex: number }
): { ok: boolean; error?: string; messages: ChatMessage[] } {
  if (room.phase !== 'play') return { ok: false, error: '当前不可猜词', messages: [] };
  if (room.storyLoading) return { ok: false, error: '叙事生成中', messages: [] };
  const p = room.players.find((x) => x.id === playerId);
  if (!p) return { ok: false, error: '玩家不存在', messages: [] };
  if (!p.alive) return { ok: false, error: '你已出局', messages: [] };
  // 双生双形态满命前不可猜
  if (p.role === '双生' && p.dualForm === 'double' && p.lives >= 2) {
    return { ok: false, error: '失一命前不可猜词', messages: [] };
  }
  if (p.guessesUsed >= p.guessesPerRound) return { ok: false, error: '本轮猜词次数已用尽', messages: [] };

  let guessPayload: { start: number; end: number };
  if ('choiceIndex' in payload) {
    if (p.role !== '断墨') return { ok: false, error: '仅断墨可用候选方式', messages: [] };
    const choice = room.duanmoChoices[payload.choiceIndex];
    if (!choice) return { ok: false, error: '选择无效', messages: [] };
    guessPayload = { start: choice.start, end: choice.end };
  } else {
    if (p.role === '断墨') return { ok: false, error: '断墨须用候选方式', messages: [] };
    const seg = room.segments.find((s) => s.start === payload.start && s.end === payload.end);
    // 不可猜自己的词；但借命互换后 blinded 状态下可自猜（自杀）
    if (seg && seg.ownerId === playerId && !p.blinded) return { ok: false, error: '不可猜自己的词', messages: [] };
    if (payload.start < 0 || payload.end > room.storyText.length || payload.start >= payload.end) {
      return { ok: false, error: '选择无效', messages: [] };
    }
    guessPayload = { start: payload.start, end: payload.end };
  }

  if (!room.pendingGuesses[playerId]) room.pendingGuesses[playerId] = [];
  room.pendingGuesses[playerId].push(guessPayload);
  p.guessesUsed += 1;
  if (p.guessesUsed >= p.guessesPerRound) p.done = true;
  const messages: ChatMessage[] = [];
  const alive = room.players.filter((x) => x.alive);
  const done = alive.filter((x) => x.done).length;
  // 多次猜词时只在第一次提示，避免刷屏
  if (p.guessesUsed === 1) {
    messages.push(pushChat(room, { type: 'system', text: `${nick(room, playerId)} 已落定 (${done}/${alive.length})` }));
  }
  return { ok: true, messages };
}

export function allGuessesSubmitted(room: RoomState): boolean {
  const alive = room.players.filter((p) => p.alive);
  if (alive.length === 0) return true;
  // 断线中的玩家视为已放弃本轮猜词，不阻塞推进
  return alive.every((p) => p.done || p.disconnectedAt !== null);
}

// 自杀：借命在场时众人可自猜己词（打破不可猜己词之规）
// 若借命本轮绑定己身则反噬：借命亡、己续其词（blinded）；否则己正常出局
export function submitSuicide(room: RoomState, playerId: number): { ok: boolean; error?: string; messages: ChatMessage[] } {
  if (room.phase !== 'play') return { ok: false, error: '当前不可猜词', messages: [] };
  if (room.storyLoading) return { ok: false, error: '叙事生成中', messages: [] };
  const p = room.players.find((x) => x.id === playerId);
  if (!p) return { ok: false, error: '玩家不存在', messages: [] };
  if (!p.alive) return { ok: false, error: '你已出局', messages: [] };
  // 借命本身不可自杀（其自猜走 blinded 逻辑）
  if (p.role === '借命') return { ok: false, error: '借命不可使用自杀', messages: [] };
  if (p.guessesUsed >= p.guessesPerRound) return { ok: false, error: '本轮猜词次数已用尽', messages: [] };
  // 找到自己的未揭示词段
  const seg = room.segments.find((s) => s.ownerId === playerId && !s.revealed);
  if (!seg) return { ok: false, error: '无己方词可自猜', messages: [] };
  // 直接提交（绕过不可猜己词限制）
  if (!room.pendingGuesses[playerId]) room.pendingGuesses[playerId] = [];
  room.pendingGuesses[playerId].push({ start: seg.start, end: seg.end });
  p.guessesUsed += 1;
  if (p.guessesUsed >= p.guessesPerRound) p.done = true;
  const messages: ChatMessage[] = [];
  const alive = room.players.filter((x) => x.alive);
  const done = alive.filter((x) => x.done).length;
  if (p.guessesUsed === 1) {
    messages.push(pushChat(room, { type: 'system', text: `${nick(room, playerId)} 决意自裁 (${done}/${alive.length})` }));
  }
  return { ok: true, messages };
}

// 结算当前子轮，并在公屏展示每人所猜之词
export async function resolveSubround(room: RoomState): Promise<ChatMessage[]> {
  const messages: ChatMessage[] = [];
  messages.push(pushChat(room, { type: 'system', text: '全部已落定，揭晓所猜：' }));

  // 收集所有猜测（每玩家可能是数组，双生单形态两次/借命自猜等）
  const allGuesses: { guesser: number; start: number; end: number }[] = [];
  for (const [pidStr, list] of Object.entries(room.pendingGuesses)) {
    const pid = Number(pidStr);
    const guesser = room.players.find((p) => p.id === pid);
    if (!guesser || !guesser.alive) continue;
    for (const g of list) allGuesses.push({ guesser: pid, start: g.start, end: g.end });
  }

  const correctGuessers: { guesser: number; target: number }[] = [];
  const hitTargetIds = new Set<number>(); // 本轮被猜中词的玩家（可能因双生未出局）
  const backfireEliminated = new Set<number>(); // 借命被反噬淘汰
  const backfireSurvived = new Set<number>(); // 自杀者因反噬存活（不扣命）

  // 公屏展示并判定命中（已 revealed 的词块不可再被猜中）
  for (const g of allGuesses) {
    const guessedText = room.storyText.slice(g.start, g.end);
    const seg = room.segments.find((s) => s.start === g.start && s.end === g.end && !s.revealed);
    const guesserPlayer = room.players.find((p) => p.id === g.guesser);
    // 命中条件：存在归属、未揭示
    // 借命 blinded 状态下自猜也算命中（自杀）
    // 非借命 blinded 自猜 = 自杀技（借命在场时众人可自猜己词）
    const isSelfBlind = seg && seg.ownerId === g.guesser && guesserPlayer?.blinded;
    const isSelfSuicide = seg && seg.ownerId === g.guesser && !guesserPlayer?.blinded;
    const hit = seg && seg.ownerId && (seg.ownerId !== g.guesser || isSelfBlind || isSelfSuicide);
    if (hit) {
      seg!.revealed = true;
      const target = seg!.ownerId!;
      if (isSelfSuicide) {
        // 自杀反噬检测：借命是否绑定己身（存活、技能未发动）
        const jieming = room.players.find(
          (p) => p.role === '借命' && p.alive && !p.scapegoatUsed && p.scapegoatTarget === g.guesser,
        );
        if (jieming) {
          // 反噬：借命亡，己续其词（blinded）
          for (const s of room.segments) {
            if (s.ownerId === jieming.id) s.ownerId = g.guesser;
          }
          // 自杀者原词段已 revealed，归属清除（blinded 仍可自猜新词）
          for (const s of room.segments) {
            if (s.ownerId === g.guesser && s.revealed) s.ownerId = undefined;
          }
          const gp = room.players.find((p) => p.id === g.guesser)!;
          gp.secretWord = jieming.secretWord;
          gp.secretWord2 = jieming.secretWord2;
          gp.wordStrokes = jieming.wordStrokes;
          gp.headStrokes = jieming.headStrokes;
          gp.tailStrokes = jieming.tailStrokes;
          gp.word2Strokes = jieming.word2Strokes;
          gp.headStrokes2 = jieming.headStrokes2;
          gp.tailStrokes2 = jieming.tailStrokes2;
          gp.blinded = true;
          jieming.scapegoatUsed = true;
          jieming.lives = 0;
          backfireEliminated.add(jieming.id);
          backfireSurvived.add(g.guesser);
          gp.score += 1; // 反噬成功得分
          messages.push(pushChat(room, { type: 'system', text: `${nick(room, g.guesser)} 自裁反噬！借命 ${nick(room, jieming.id)} 亡，${nick(room, g.guesser)} 续其词（不知所得）。` }));
        } else {
          // 无反噬：正常自裁（扣命，可能出局）
          hitTargetIds.add(target);
          messages.push(pushChat(room, { type: 'system', text: `${nick(room, g.guesser)} 猜「${guessedText}」· 自裁` }));
        }
      } else {
        correctGuessers.push({ guesser: g.guesser, target });
        hitTargetIds.add(target);
        if (isSelfBlind) {
          messages.push(pushChat(room, { type: 'system', text: `${nick(room, g.guesser)} 猜「${guessedText}」· 误伤己词（所得之词）` }));
        } else {
          messages.push(pushChat(room, { type: 'system', text: `${nick(room, g.guesser)} 猜「${guessedText}」· 命中 ${nick(room, target)}` }));
        }
      }
    } else {
      messages.push(pushChat(room, { type: 'system', text: `${nick(room, g.guesser)} 猜「${guessedText}」` }));
    }
  }

  // 得分：命中即得分（无论目标是否因双生/借命存活）
  for (const cg of correctGuessers) {
    const g = room.players.find((p) => p.id === cg.guesser);
    if (g) g.score += 1;
  }

  // 扣命：每个被命中目标扣一命；双生双形态两词各一命，扣至 0 才出局
  for (const tid of hitTargetIds) {
    const t = room.players.find((p) => p.id === tid);
    if (t && t.alive) {
      t.lives -= 1;
    }
  }

  // 候选淘汰集：命≤0 者 + 反噬淘汰的借命
  const eliminatedThisRound = new Set<number>();
  for (const tid of hitTargetIds) {
    const t = room.players.find((p) => p.id === tid);
    if (t && t.alive && t.lives <= 0) eliminatedThisRound.add(tid);
  }
  for (const jid of backfireEliminated) {
    eliminatedThisRound.add(jid);
  }

  // 借命替死：被淘汰的借命玩家若技能未发动且替死鬼未亡（不在淘汰集），则替死鬼代死、己续其词
  const swappedIn = new Set<number>(); // 借命被救活者
  for (const tid of eliminatedThisRound) {
    const t = room.players.find((p) => p.id === tid);
    if (!t || t.role !== '借命' || t.scapegoatUsed) continue;
    if (t.scapegoatTarget === null) continue;
    const sg = room.players.find((p) => p.id === t.scapegoatTarget);
    if (!sg || !sg.alive || eliminatedThisRound.has(sg.id)) continue; // 替死鬼已亡则技能失效
    // 执行替死互换
    t.lives = 1;
    t.scapegoatUsed = true;
    t.blinded = true;
    // 转移替死鬼词段归属给借命者
    for (const s of room.segments) {
      if (s.ownerId === sg.id) s.ownerId = t.id;
    }
    // 借命者原词段已 revealed，归属清除以免后续误判为己词（blinded 仍可自猜新词）
    for (const s of room.segments) {
      if (s.ownerId === t.id && s.revealed) s.ownerId = undefined;
    }
    // 续其词：同步 secretWord 与笔画（量画所见随之更新）
    t.secretWord = sg.secretWord;
    t.secretWord2 = sg.secretWord2;
    t.wordStrokes = sg.wordStrokes;
    t.headStrokes = sg.headStrokes;
    t.tailStrokes = sg.tailStrokes;
    t.word2Strokes = sg.word2Strokes;
    t.headStrokes2 = sg.headStrokes2;
    t.tailStrokes2 = sg.tailStrokes2;
    // 替死鬼出局，借命者救活
    eliminatedThisRound.delete(tid);
    eliminatedThisRound.add(sg.id);
    swappedIn.add(tid);
    messages.push(pushChat(room, { type: 'system', text: `借命 ${nick(room, tid)} 之词被猜破，替死鬼 ${nick(room, sg.id)} 代死！${nick(room, tid)} 续其词（不知所得）。` }));
  }

  // 执行出局
  for (const tid of eliminatedThisRound) {
    const t = room.players.find((p) => p.id === tid);
    if (t && t.alive) {
      t.alive = false;
      room.eliminationOrder.push(tid);
      const guessers = correctGuessers.filter((c) => c.target === tid).map((c) => nick(room, c.guesser));
      // 双生失一命但未出局时不算"出局"
      messages.push(pushChat(room, { type: 'system', text: `${nick(room, tid)} 之词被 ${guessers.join('、')} 猜破，出局！` }));
    }
  }
  // 双生失一命未出局提示
  for (const tid of hitTargetIds) {
    if (eliminatedThisRound.has(tid) || swappedIn.has(tid) || backfireSurvived.has(tid)) continue;
    const t = room.players.find((p) => p.id === tid);
    if (t && t.alive && t.lives >= 1 && t.role === '双生') {
      messages.push(pushChat(room, { type: 'system', text: `${nick(room, tid)} 一词被猜破，失一命，尚存 ${t.lives} 命。` }));
    }
  }

  // 押司结算：押司出局后方可押注，此处 !p.alive
  for (const p of room.players) {
    if (p.role === '押司' && !p.alive && p.betOn !== null) {
      const betEliminated = eliminatedThisRound.has(p.betOn);
      if (betEliminated) {
        p.score -= 1;
        messages.push(pushChat(room, { type: 'system', text: `押司 ${nick(room, p.id)} 押注的 ${nick(room, p.betOn)} 出局，扣 1 分（当前 ${p.score} 分）。` }));
      } else {
        p.score += 1;
        messages.push(pushChat(room, { type: 'system', text: `押司 ${nick(room, p.id)} 押注的 ${nick(room, p.betOn)} 存活，加 1 分（当前 ${p.score} 分）。` }));
      }
      p.betOn = null;
    }
  }

  if (correctGuessers.length === 0) {
    messages.push(pushChat(room, { type: 'system', text: '本轮无人猜中。' }));
  }

  const aliveAfter = room.players.filter((p) => p.alive);
  if (aliveAfter.length <= 1) {
    if (aliveAfter.length === 1) {
      const survivor = aliveAfter[0];
      survivor.score += 1;
      messages.push(pushChat(room, { type: 'system', text: `仅剩 ${nick(room, survivor.id)}，加 1 分，本局结束。` }));
    } else {
      messages.push(pushChat(room, { type: 'system', text: '全员出局，本局结束。' }));
    }
    room.phase = 'result';
    if (room.currentRound >= room.totalRounds) {
      room.finished = true;
      messages.push(pushChat(room, { type: 'system', text: '已达成设定局数，游戏总结算！' }));
    }
  } else {
    // 进入复盘公屏阶段：不立即推进子轮，先让玩家在公屏查看本轮众人所猜
    room.phase = 'reveal';
    messages.push(pushChat(room, { type: 'system', text: '本轮揭晓完毕，公屏复盘 10 秒后进入下一轮。' }));
  }
  return messages;
}

// 复盘结束：推进子轮、重置行动标记、构建断墨候选、回到猜词阶段
export async function continueAfterReveal(room: RoomState): Promise<ChatMessage[]> {
  const messages: ChatMessage[] = [];
  // 复盘期间可能有人断线淘汰，再次校验终局条件
  const aliveAfter = room.players.filter((p) => p.alive);
  if (aliveAfter.length <= 1) {
    if (aliveAfter.length === 1) {
      aliveAfter[0].score += 1;
      messages.push(pushChat(room, { type: 'system', text: `仅剩 ${nick(room, aliveAfter[0].id)}，加 1 分，本局结束。` }));
    } else {
      messages.push(pushChat(room, { type: 'system', text: '全员出局，本局结束。' }));
    }
    room.phase = 'result';
    if (room.currentRound >= room.totalRounds) {
      room.finished = true;
      messages.push(pushChat(room, { type: 'system', text: '已达成设定局数，游戏总结算！' }));
    }
    return messages;
  }
  room.subRound += 1;
  // 识人：每子轮揭示一名未晓玩家词长（至全部知晓止）
  revealShirenOne(room);
  // 省笔：每子轮再自动拭去一字
  const shengbi = room.players.find((p) => p.role === '省笔' && p.alive);
  if (shengbi && room.storyText.length > 0) {
    const wiped = autoPrune(room, 1);
    if (wiped > 0) {
      messages.push(pushChat(room, { type: 'system', text: `省笔拭去一字。` }));
    }
  }
  for (const p of room.players) {
    if (p.alive) {
      p.guessesUsed = 0;
      // 双生双形态满命（2命）时不可猜词，直接落定；失一命后方可猜
      p.done = (p.role === '双生' && p.dualForm === 'double' && p.lives >= 2);
      p.prunedThisRound = false;
    }
    p.betOn = null;
  }
  room.pendingGuesses = {};
  room.phase = 'play';
  await buildDuanmoChoices(room);
  messages.push(pushChat(room, { type: 'system', text: `复盘结束，进入第 ${room.subRound} 轮猜词。` }));
  return messages;
}

// 省笔：随机拭去一字（不暴露玩家词位置，玩家不选）
export function pruneRandom(room: RoomState, playerId: number): { ok: boolean; error?: string; messages: ChatMessage[] } {
  if (room.phase !== 'play') return { ok: false, error: '当前不可拭字', messages: [] };
  const p = room.players.find((x) => x.id === playerId);
  if (!p || p.role !== '省笔' || !p.alive) return { ok: false, error: '不可使用', messages: [] };
  if (p.prunedThisRound) return { ok: false, error: '本轮已拭过字', messages: [] };
  // 合法字符：非玩家词、非已拭、非标点
  const eligible: number[] = [];
  for (let i = 0; i < room.storyText.length; i++) {
    if (room.pruned.includes(i)) continue;
    if (room.segments.some((s) => i >= s.start && i < s.end)) continue;
    if (PUNCT.test(room.storyText[i])) continue;
    eligible.push(i);
  }
  if (eligible.length === 0) return { ok: false, error: '无可拭之字', messages: [] };
  const idx = eligible[Math.floor(Math.random() * eligible.length)];
  room.pruned.push(idx);
  p.prunedThisRound = true;
  const messages: ChatMessage[] = [
    pushChat(room, { type: 'system', text: `省笔 ${nick(room, playerId)} 拭去了一字。` }),
  ];
  return { ok: true, messages };
}

export function placeBet(room: RoomState, playerId: number, targetId: number): { ok: boolean; error?: string; messages: ChatMessage[] } {
  if (room.phase !== 'play') return { ok: false, error: '当前不可下注', messages: [] };
  const p = room.players.find((x) => x.id === playerId);
  if (!p || p.role !== '押司') return { ok: false, error: '仅押司可下注', messages: [] };
  if (p.alive) return { ok: false, error: '押司需出局后方可下注', messages: [] };
  if (room.eliminationOrder.length === 0) return { ok: false, error: '尚无玩家出局，无法下注', messages: [] };
  if (targetId === playerId) return { ok: false, error: '不可押注自己', messages: [] };
  const target = room.players.find((x) => x.id === targetId);
  if (!target || !target.alive) return { ok: false, error: '目标无效', messages: [] };
  p.betOn = targetId;
  return { ok: true, messages: [] };
}

export function nextRound(room: RoomState): { ok: boolean; error?: string; messages: ChatMessage[] } {
  if (room.phase !== 'result') return { ok: false, error: '当前不可进入下一局', messages: [] };
  if (room.finished) return { ok: false, error: '游戏已结束', messages: [] };
  if (room.currentRound >= room.totalRounds) {
    room.finished = true;
    return { ok: false, error: '游戏已结束', messages: [] };
  }
  room.currentRound += 1;
  room.phase = 'words';
  resetRoundWords(room);
  const messages: ChatMessage[] = [
    pushChat(room, { type: 'system', text: `第 ${room.currentRound} 局开始，请各自封匣入词。` }),
  ];
  return { ok: true, messages };
}

// 超时处理：未行动存活玩家直接淘汰，返回是否应推进
export function timeoutPending(room: RoomState): { messages: ChatMessage[]; shouldAdvance: boolean } {
  const messages: ChatMessage[] = [];
  if (room.phase === 'words') {
    // 封匣阶段超时：所有未封匣的存活玩家（含断线）本局出局，下局可重新加入
    for (const p of room.players) {
      if (p.alive && !p.wordSubmitted) {
        p.alive = false;
        p.disconnectedAt = null;
        room.eliminationOrder.push(p.id);
        messages.push(pushChat(room, { type: 'system', text: `${nick(room, p.id)} 未封匣，逐出本局（下局可重新加入）。` }));
      }
    }
    const readyAlive = room.players.filter((p) => p.alive);
    if (readyAlive.length >= 2) {
      return { messages, shouldAdvance: true };
    }
    // 不足2人，结束本局
    if (readyAlive.length === 1) {
      readyAlive[0].score += 1;
      messages.push(pushChat(room, { type: 'system', text: `仅剩 ${nick(room, readyAlive[0].id)} 封匣，加 1 分，本局结束。` }));
    } else {
      messages.push(pushChat(room, { type: 'system', text: '全员未封匣，本局结束。' }));
    }
    room.phase = 'result';
    if (room.currentRound >= room.totalRounds) {
      room.finished = true;
      messages.push(pushChat(room, { type: 'system', text: '已达成设定局数，游戏总结算！' }));
    }
    return { messages, shouldAdvance: false };
  }
  if (room.phase === 'play' && !room.storyLoading) {
    for (const p of room.players) {
      if (p.alive && !p.done && p.disconnectedAt === null) {
        p.alive = false;
        room.eliminationOrder.push(p.id);
        messages.push(pushChat(room, { type: 'system', text: `${nick(room, p.id)} 超时未猜词，逐出本局。` }));
      }
    }
    return { messages, shouldAdvance: true };
  }
  return { messages, shouldAdvance: false };
}

// 收割断线超时玩家：超过宽限期仍未重连的存活玩家判出局
// 返回被淘汰的玩家 id 列表（供调用方推送消息与广播）
export function reapDisconnected(room: RoomState, now: number, graceMs: number): number[] {
  const reaped: number[] = [];
  for (const p of room.players) {
    if (p.alive && p.disconnectedAt !== null && now - p.disconnectedAt >= graceMs) {
      p.alive = false;
      p.disconnectedAt = null;
      room.eliminationOrder.push(p.id);
      reaped.push(p.id);
    }
  }
  return reaped;
}

// 主动退出：淘汰该玩家，返回消息
export function exitPlayer(room: RoomState, playerId: number): { ok: boolean; messages: ChatMessage[] } {
  const p = room.players.find((x) => x.id === playerId);
  if (!p) return { ok: false, messages: [] };
  const messages: ChatMessage[] = [];
  if (p.alive) {
    p.alive = false;
    room.eliminationOrder.push(p.id);
    messages.push(pushChat(room, { type: 'system', text: `${nick(room, playerId)} 离匣，本局出局。` }));
  }
  return { ok: true, messages };
}

export function emojiCooldownOk(room: RoomState, playerId: number): boolean {
  const now = Date.now();
  const last = room.lastEmojiTs[playerId] || 0;
  return now - last >= 3000;
}

export function setRole(room: RoomState, playerId: number, role: Role): { ok: boolean; error?: string } {
  if (room.phase !== 'lobby') return { ok: false, error: '游戏已开始' };
  if (room.disabledRoles.includes(role)) return { ok: false, error: '该角色已被禁用' };
  const p = room.players.find((x) => x.id === playerId);
  if (!p) return { ok: false, error: '玩家不存在' };
  p.role = role;
  // 选双生时默认单形态；改选其他角色时清空形态
  p.dualForm = role === '双生' ? 'single' : null;
  return { ok: true };
}

// 双生：封匣前双击角色卡切换形态（single=1命2猜 / double=2词2命失一命后方可猜）
export function setDualForm(room: RoomState, playerId: number, form: DualForm): { ok: boolean; error?: string } {
  if (room.phase !== 'lobby') return { ok: false, error: '游戏已开始，不可切换形态' };
  const p = room.players.find((x) => x.id === playerId);
  if (!p) return { ok: false, error: '玩家不存在' };
  if (p.role !== '双生') return { ok: false, error: '仅双生可切换形态' };
  p.dualForm = form;
  return { ok: true };
}

// 借命：第3子轮起猜词阶段可指定一玩家为替死鬼（未发动前可重新指定；发动后不可再改）
export function setScapegoat(room: RoomState, playerId: number, targetId: number): { ok: boolean; error?: string } {
  if (room.phase !== 'play') return { ok: false, error: '当前不可指定替死鬼' };
  if (room.subRound < 3) return { ok: false, error: '第3子轮起方可指定替死鬼' };
  const p = room.players.find((x) => x.id === playerId);
  if (!p) return { ok: false, error: '玩家不存在' };
  if (p.role !== '借命') return { ok: false, error: '仅借命可指定替死鬼' };
  if (!p.alive) return { ok: false, error: '你已出局' };
  if (p.scapegoatUsed) return { ok: false, error: '技能已发动，不可再指定' };
  if (targetId === playerId) return { ok: false, error: '不可指定自己为替死鬼' };
  const target = room.players.find((x) => x.id === targetId);
  if (!target || !target.alive) return { ok: false, error: '目标无效' };
  p.scapegoatTarget = targetId;
  return { ok: true };
}

// 立意玩家在封匣阶段选定本局主题（仅立意自己可调，主题仅己知晓；多人立意各持各主题）
export function setTheme(room: RoomState, playerId: number, theme: Theme): { ok: boolean; error?: string } {
  if (room.phase !== 'words') return { ok: false, error: '当前不可择题' };
  const p = room.players.find((x) => x.id === playerId);
  if (!p) return { ok: false, error: '玩家不存在' };
  if (p.role !== '立意') return { ok: false, error: '仅立意可择题' };
  if (!p.alive) return { ok: false, error: '你已出局' };
  if (!ALL_THEMES.includes(theme)) return { ok: false, error: '主题无效' };
  p.themeChoice = theme;
  return { ok: true };
}

export function setNickname(room: RoomState, playerId: number, nickname: string): { ok: boolean; error?: string } {
  const p = room.players.find((x) => x.id === playerId);
  if (!p) return { ok: false, error: '玩家不存在' };
  const n = (nickname || '').trim().slice(0, 12);
  if (n) p.nickname = n;
  return { ok: true };
}
