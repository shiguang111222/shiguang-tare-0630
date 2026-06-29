// 游戏状态机：阶段流转、猜词结算、角色技能、断墨候选、超时淘汰、公屏猜词展示
import type { ChatMessage, Role, Segment } from '../shared/types.js';
import { DIFFICULTY_INFO } from '../shared/types.js';
import { type RoomState, type Player, pushChat } from './store.js';
import { generateStory } from './story.js';

function nick(room: RoomState, id: number): string {
  return room.players.find((p) => p.id === id)?.nickname || `玩家${id}`;
}

function isChineseWord(w: string): boolean {
  const chars = Array.from(w);
  if (chars.length < 2 || chars.length > 4) return false;
  return chars.every((c) => /[\u4e00-\u9fff]/.test(c));
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
}

export function submitWord(room: RoomState, playerId: number, word: string): { ok: boolean; error?: string; messages: ChatMessage[] } {
  if (room.phase !== 'words') return { ok: false, error: '当前不可填词', messages: [] };
  const p = room.players.find((x) => x.id === playerId);
  if (!p) return { ok: false, error: '玩家不存在', messages: [] };
  if (!p.alive) return { ok: false, error: '你已出局', messages: [] };
  const w = (word || '').trim();
  if (!isChineseWord(w)) return { ok: false, error: '词需为 2-4 个汉字', messages: [] };
  const dup = room.players.find((x) => x.id !== playerId && x.secretWord === w);
  p.secretWord = w;
  p.wordSubmitted = true;
  p.done = true;
  const messages: ChatMessage[] = [];
  const done = room.players.filter((x) => x.alive && x.wordSubmitted).length;
  const total = room.players.filter((x) => x.alive).length;
  messages.push(pushChat(room, { type: 'system', text: `${nick(room, playerId)} 已封匣 (${done}/${total})` }));
  if (dup) messages.push(pushChat(room, { type: 'system', text: '提示：有玩家给出了相同的词。' }));
  return { ok: true, messages };
}

// 仅统计存活玩家是否全部封匣
export function allWordsSubmitted(room: RoomState): boolean {
  const alive = room.players.filter((p) => p.alive);
  if (alive.length < 2) return false;
  return alive.every((p) => p.wordSubmitted);
}

// 全部封匣后触发故事生成（异步）
export async function generateAndStartPlay(room: RoomState): Promise<ChatMessage[]> {
  const messages: ChatMessage[] = [];
  room.storyLoading = true;
  messages.push(pushChat(room, { type: 'system', text: '全部已封匣，正在研墨成文…' }));
  const words = room.players
    .filter((p) => p.alive && p.secretWord)
    .map((p) => ({ playerId: p.id, word: p.secretWord }));
  const multiplier = DIFFICULTY_INFO[room.difficulty].multiplier;
  let story;
  try {
    story = await generateStory(words, multiplier);
  } catch {
    story = { text: '', segments: [], unembedded: words.map((w) => w.playerId) };
  }
  room.storyText = story.text;
  room.segments = story.segments;
  room.phase = 'play';
  room.subRound = 1;
  room.storyLoading = false;
  for (const p of room.players) {
    if (p.alive) {
      p.done = false;
      p.prunedThisRound = false;
      p.betOn = null;
    }
  }
  room.pendingGuesses = {};
  buildDuanmoChoices(room);
  messages.push(pushChat(room, { type: 'system', text: `叙事已成（${story.text.length}字），第 1 轮猜词开始。` }));
  if (story.unembedded.length > 0) {
    messages.push(pushChat(room, { type: 'system', text: '有词语未能嵌入叙事，相关玩家本局无法被猜中出局。' }));
  }
  return messages;
}

// 构建断墨候选词块：3+人数 个候选，恰含 1 个真实玩家词
export function buildDuanmoChoices(room: RoomState): void {
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

  // 干扰块数量：2 + 总人数（与真实词合计 3 + 总人数）
  const decoyCount = 2 + room.players.length;
  const decoys: Segment[] = [];
  let attempts = 0;
  while (decoys.length < decoyCount && attempts < 400) {
    attempts++;
    const len = 2 + Math.floor(Math.random() * 3); // 2-4 字
    if (room.storyText.length < len) break;
    const start = Math.floor(Math.random() * (room.storyText.length - len + 1));
    const end = start + len;
    // 不可与任何玩家词重叠
    if (room.segments.some((s) => !(end <= s.start || start >= s.end))) continue;
    // 不可与已有干扰块重叠
    if (decoys.some((d) => !(end <= d.start || start >= d.end))) continue;
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
  if (p.done) return { ok: false, error: '本轮已提交', messages: [] };

  let guessPayload: { start: number; end: number };
  if ('choiceIndex' in payload) {
    if (p.role !== '断墨') return { ok: false, error: '仅断墨可用候选方式', messages: [] };
    const choice = room.duanmoChoices[payload.choiceIndex];
    if (!choice) return { ok: false, error: '选择无效', messages: [] };
    guessPayload = { start: choice.start, end: choice.end };
  } else {
    if (p.role === '断墨') return { ok: false, error: '断墨须用候选方式', messages: [] };
    const seg = room.segments.find((s) => s.start === payload.start && s.end === payload.end);
    if (seg && seg.ownerId === playerId) return { ok: false, error: '不可猜自己的词', messages: [] };
    if (payload.start < 0 || payload.end > room.storyText.length || payload.start >= payload.end) {
      return { ok: false, error: '选择无效', messages: [] };
    }
    guessPayload = { start: payload.start, end: payload.end };
  }

  room.pendingGuesses[playerId] = guessPayload;
  p.done = true;
  const messages: ChatMessage[] = [];
  const alive = room.players.filter((x) => x.alive);
  const done = alive.filter((x) => x.done).length;
  messages.push(pushChat(room, { type: 'system', text: `${nick(room, playerId)} 已落定 (${done}/${alive.length})` }));
  return { ok: true, messages };
}

export function allGuessesSubmitted(room: RoomState): boolean {
  const alive = room.players.filter((p) => p.alive);
  if (alive.length === 0) return true;
  return alive.every((p) => p.done);
}

// 结算当前子轮，并在公屏展示每人所猜之词
export function resolveSubround(room: RoomState): ChatMessage[] {
  const messages: ChatMessage[] = [];
  messages.push(pushChat(room, { type: 'system', text: '全部已落定，揭晓所猜：' }));

  const eliminatedThisRound = new Set<number>();
  const correctGuessers: { guesser: number; target: number }[] = [];

  // 先公屏展示每人所猜词文
  for (const [pidStr, guess] of Object.entries(room.pendingGuesses)) {
    const pid = Number(pidStr);
    const guesser = room.players.find((p) => p.id === pid);
    if (!guesser || !guesser.alive) continue;
    const guessedText = room.storyText.slice(guess.start, guess.end);
    const seg = room.segments.find((s) => s.start === guess.start && s.end === guess.end);
    const hit = seg && seg.ownerId && seg.ownerId !== pid;
    if (hit) {
      correctGuessers.push({ guesser: pid, target: seg!.ownerId! });
      eliminatedThisRound.add(seg!.ownerId!);
      messages.push(pushChat(room, { type: 'system', text: `${nick(room, pid)} 猜「${guessedText}」· 命中 ${nick(room, seg!.ownerId!)}` }));
    } else {
      messages.push(pushChat(room, { type: 'system', text: `${nick(room, pid)} 猜「${guessedText}」` }));
    }
  }

  // 得分与出局
  for (const cg of correctGuessers) {
    const g = room.players.find((p) => p.id === cg.guesser);
    if (g) g.score += 1;
  }
  for (const tid of eliminatedThisRound) {
    const t = room.players.find((p) => p.id === tid);
    if (t && t.alive) {
      t.alive = false;
      room.eliminationOrder.push(tid);
      const guessers = correctGuessers.filter((c) => c.target === tid).map((c) => nick(room, c.guesser));
      messages.push(pushChat(room, { type: 'system', text: `${nick(room, tid)} 之词被 ${guessers.join('、')} 猜破，出局！` }));
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
    room.subRound += 1;
    for (const p of room.players) {
      if (p.alive) {
        p.done = false;
        p.prunedThisRound = false;
      }
      p.betOn = null;
    }
    room.pendingGuesses = {};
    buildDuanmoChoices(room);
    messages.push(pushChat(room, { type: 'system', text: `全部完成，进入下一轮（第 ${room.subRound} 轮猜词）。` }));
  }
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
    for (const p of room.players) {
      if (p.alive && !p.wordSubmitted) {
        p.alive = false;
        room.eliminationOrder.push(p.id);
        messages.push(pushChat(room, { type: 'system', text: `${nick(room, p.id)} 超时未封匣，逐出本局。` }));
      }
    }
    return { messages, shouldAdvance: allWordsSubmitted(room) };
  }
  if (room.phase === 'play' && !room.storyLoading) {
    for (const p of room.players) {
      if (p.alive && !p.done) {
        p.alive = false;
        room.eliminationOrder.push(p.id);
        messages.push(pushChat(room, { type: 'system', text: `${nick(room, p.id)} 超时未猜词，逐出本局。` }));
      }
    }
    return { messages, shouldAdvance: true };
  }
  return { messages, shouldAdvance: false };
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
  return { ok: true };
}

export function setNickname(room: RoomState, playerId: number, nickname: string): { ok: boolean; error?: string } {
  const p = room.players.find((x) => x.id === playerId);
  if (!p) return { ok: false, error: '玩家不存在' };
  const n = (nickname || '').trim().slice(0, 12);
  if (n) p.nickname = n;
  return { ok: true };
}
