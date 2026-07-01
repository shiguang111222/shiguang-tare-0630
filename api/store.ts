// 房间状态存储（内存态，服务端权威）
import type { Role, Phase, Segment, ChatMessage, Difficulty, Theme, DualForm } from '../shared/types.js';

export interface Player {
  id: number;
  socketId: string | null;
  nickname: string;
  role: Role | null;
  secretWord: string;
  secretWord2: string;       // 双生双形态：第二词
  word2Strokes: number;      // 第二词笔画总数
  headStrokes2: number;      // 第二词首字笔画
  tailStrokes2: number;      // 第二词尾字笔画
  word2Submitted: boolean;   // 双生双形态：第二词是否已封匣
  wordStrokes: number;      // 注入词笔画总数（量画技能：开局即知）
  headStrokes: number;      // 注入词首字笔画（量画技能：第3子轮起可知）
  tailStrokes: number;      // 注入词尾字笔画（量画技能：第5子轮起可知）
  themeChoice: Theme | null; // 立意玩家本局所选主题（仅立意自己知晓；多人立意时各持各主题）
  lives: number;             // 剩余命（双生双形态=2，其余=1）
  guessesPerRound: number;   // 每子轮可猜词次数（双生单形态=2，其余=1）
  guessesUsed: number;       // 本子轮已猜词次数
  dualForm: DualForm | null; // 双生形态（single/double）；非双生为 null
  scapegoatTarget: number | null; // 借命：当前指定的替死鬼 id
  scapegoatUsed: boolean;    // 借命：技能是否已发动
  blinded: boolean;          // 借命：替死互换后不知己方所得之词，可自猜
  score: number;
  alive: boolean;
  betOn: number | null;
  wordSubmitted: boolean;
  done: boolean;
  prunedThisRound: boolean;
  disconnectedAt: number | null; // 断线时间戳；非空表示处于宽限期，重连可恢复
}

export interface RoomState {
  code: string;
  hostId: number;
  maxPlayers: number;
  totalRounds: number;
  disabledRoles: Role[];
  difficulty: Difficulty;
  waitTime: number;          // 每阶段行动限时（秒）
  currentRound: number;
  phase: Phase;
  subRound: number;
  storyText: string;
  segments: Segment[];      // 玩家整词位置（含 ownerId）
  duanmoChoices: Segment[]; // 断墨候选词块（含真实词，序列化时脱敏）
  duanmoTarget: number | null; // 本子轮断墨目标玩家 id（服务端校验用）
  pruned: number[];
  players: Player[];
  pendingGuesses: Record<number, { start: number; end: number }[]>; // 每玩家本子轮所猜词块列表（双生单形态可猜两次）
  eliminationOrder: number[];
  chat: ChatMessage[];
  storyLoading: boolean;
  lastEmojiTs: Record<number, number>;
  finished: boolean;
  theme: Theme | null;      // 本局立意玩家所选主题（仅立意自己可见）
  lastActivity: number;        // 最近一次玩家活动时间戳（用于闲置清理）
  pendingDeleteAt: number | null; // 空置房间延迟删除时间戳；非空且到期则清理
  duanmoCache: string[];       // 断墨候选词块缓存（AI 原始字符串，跨子轮复用以减少 API 调用）
  shirenRevealed: number[];    // 识人已知晓词长的玩家 id 列表（每局新增一个，至全部知晓止）
}

const rooms = new Map<string, RoomState>();
const socketToPlayer = new Map<string, { roomCode: string; playerId: number }>();

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function genCode(): string {
  let code = '';
  for (let i = 0; i < 4; i++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return rooms.has(code) ? genCode() : code;
}

let playerIdSeq = 1;

export function createRoom(
  host: { nickname: string; totalRounds: number; disabledRoles: Role[]; difficulty: Difficulty; waitTime: number },
  socketId: string,
): RoomState {
  const code = genCode();
  const hostId = playerIdSeq++;
  const hostPlayer: Player = {
    id: hostId,
    socketId,
    nickname: host.nickname || `玩家${hostId}`,
    role: null,
    secretWord: '',
    secretWord2: '',
    word2Strokes: 0,
    headStrokes2: 0,
    tailStrokes2: 0,
    word2Submitted: false,
    wordStrokes: 0,
    headStrokes: 0,
    tailStrokes: 0,
    themeChoice: null,
    lives: 1,
    guessesPerRound: 1,
    guessesUsed: 0,
    dualForm: null,
    scapegoatTarget: null,
    scapegoatUsed: false,
    blinded: false,
    score: 0,
    alive: true,
    betOn: null,
    wordSubmitted: false,
    done: false,
    prunedThisRound: false,
    disconnectedAt: null,
  };
  const room: RoomState = {
    code,
    hostId,
    maxPlayers: 8,
    totalRounds: host.totalRounds,
    disabledRoles: host.disabledRoles,
    difficulty: host.difficulty,
    waitTime: host.waitTime,
    currentRound: 1,
    phase: 'lobby',
    subRound: 0,
    storyText: '',
    segments: [],
    duanmoChoices: [],
    duanmoTarget: null,
    pruned: [],
    players: [hostPlayer],
    pendingGuesses: {},
    eliminationOrder: [],
    chat: [],
    storyLoading: false,
    lastEmojiTs: {},
    finished: false,
    theme: null,
    lastActivity: Date.now(),
    pendingDeleteAt: null,
    duanmoCache: [],
    shirenRevealed: [],
  };
  rooms.set(code, room);
  socketToPlayer.set(socketId, { roomCode: code, playerId: hostId });
  return room;
}

export function joinRoom(code: string, nickname: string, socketId: string): { ok: boolean; error?: string; room?: RoomState; playerId?: number } {
  const room = rooms.get(code.toUpperCase());
  if (!room) return { ok: false, error: '房间不存在' };
  if (room.phase !== 'lobby') return { ok: false, error: '游戏已开始，无法加入' };
  if (room.players.length >= room.maxPlayers) return { ok: false, error: '房间已满' };
  const id = playerIdSeq++;
  const player: Player = {
    id,
    socketId,
    nickname: nickname || `玩家${id}`,
    role: null,
    secretWord: '',
    secretWord2: '',
    word2Strokes: 0,
    headStrokes2: 0,
    tailStrokes2: 0,
    word2Submitted: false,
    wordStrokes: 0,
    headStrokes: 0,
    tailStrokes: 0,
    themeChoice: null,
    lives: 1,
    guessesPerRound: 1,
    guessesUsed: 0,
    dualForm: null,
    scapegoatTarget: null,
    scapegoatUsed: false,
    blinded: false,
    score: 0,
    alive: true,
    betOn: null,
    wordSubmitted: false,
    done: false,
    prunedThisRound: false,
    disconnectedAt: null,
  };
  room.players.push(player);
  socketToPlayer.set(socketId, { roomCode: room.code, playerId: id });
  touchRoom(room);
  return { ok: true, room, playerId: id };
}

export function rejoinRoom(code: string, playerId: number, socketId: string): { ok: boolean; error?: string; room?: RoomState } {
  const room = rooms.get(code.toUpperCase());
  if (!room) return { ok: false, error: '房间不存在' };
  const player = room.players.find((p) => p.id === playerId);
  if (!player) return { ok: false, error: '你不是该房间玩家' };
  player.socketId = socketId;
  player.disconnectedAt = null; // 重连恢复，清除断线标记
  socketToPlayer.set(socketId, { roomCode: room.code, playerId });
  touchRoom(room);
  return { ok: true, room };
}

export function getRoom(code: string): RoomState | undefined {
  return rooms.get(code.toUpperCase());
}

// 遍历所有房间（供定时任务扫描）
export function allRooms(): RoomState[] {
  return Array.from(rooms.values());
}

export function getPlayerBySocket(socketId: string): { room: RoomState; player: Player } | null {
  const mapping = socketToPlayer.get(socketId);
  if (!mapping) return null;
  const room = rooms.get(mapping.roomCode);
  if (!room) return null;
  const player = room.players.find((p) => p.id === mapping.playerId);
  if (!player) return null;
  return { room, player };
}

export function removeSocket(socketId: string): void {
  socketToPlayer.delete(socketId);
}

export function deleteRoom(code: string): void {
  rooms.delete(code.toUpperCase());
}

// 标记房间有活动：刷新闲置计时，并撤销待删除标记（如有人重连回来）
export function touchRoom(room: RoomState): void {
  room.lastActivity = Date.now();
  if (room.pendingDeleteAt !== null) room.pendingDeleteAt = null;
}

// 是否还有任何在线 socket
export function hasConnectedPlayers(room: RoomState): boolean {
  return room.players.some((p) => p.socketId !== null);
}

// 对已无人连接的房间设置延迟删除时间戳（仅 result/finished 适用）
export function setPendingDelete(room: RoomState, delayMs = 120000): void {
  if (!hasConnectedPlayers(room)) {
    room.pendingDeleteAt = Date.now() + delayMs;
  }
}

// 定时清理：删除闲置超时（默认 30 分钟）或已到期待删除的房间，返回被删房间号
export function runRoomCleanup(now = Date.now(), idleMs = 30 * 60 * 1000): string[] {
  const deleted: string[] = [];
  for (const [code, room] of rooms) {
    const idle = now - room.lastActivity > idleMs;
    const pending = room.pendingDeleteAt !== null && now >= room.pendingDeleteAt;
    if (idle || pending) {
      deleted.push(code);
      rooms.delete(code);
    }
  }
  return deleted;
}

export function transferHostIfNeeded(room: RoomState): void {
  const host = room.players.find((p) => p.id === room.hostId);
  if (!host) {
    const next = room.players[0];
    if (next) room.hostId = next.id;
  }
}

export function pushChat(room: RoomState, msg: Omit<ChatMessage, 'id' | 'ts'>): ChatMessage {
  const full: ChatMessage = { ...msg, id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, ts: Date.now() };
  room.chat.push(full);
  if (room.chat.length > 200) room.chat.shift();
  return full;
}
