// 房间状态存储（内存态，服务端权威）
import type { Role, Phase, Segment, ChatMessage, Difficulty, Theme } from '../shared/types.js';

export interface Player {
  id: number;
  socketId: string | null;
  nickname: string;
  role: Role | null;
  secretWord: string;
  wordStrokes: number;      // 注入词笔画总数（封匣后由量画技能派上用场）
  score: number;
  alive: boolean;
  betOn: number | null;
  wordSubmitted: boolean;
  done: boolean;
  prunedThisRound: boolean;
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
  pendingGuesses: Record<number, { start: number; end: number }>;
  eliminationOrder: number[];
  chat: ChatMessage[];
  storyLoading: boolean;
  lastEmojiTs: Record<number, number>;
  finished: boolean;
  theme: Theme | null;      // 本局立意玩家所选主题（仅立意自己可见）
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
    wordStrokes: 0,
    score: 0,
    alive: true,
    betOn: null,
    wordSubmitted: false,
    done: false,
    prunedThisRound: false,
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
    wordStrokes: 0,
    score: 0,
    alive: true,
    betOn: null,
    wordSubmitted: false,
    done: false,
    prunedThisRound: false,
  };
  room.players.push(player);
  socketToPlayer.set(socketId, { roomCode: room.code, playerId: id });
  return { ok: true, room, playerId: id };
}

export function rejoinRoom(code: string, playerId: number, socketId: string): { ok: boolean; error?: string; room?: RoomState } {
  const room = rooms.get(code.toUpperCase());
  if (!room) return { ok: false, error: '房间不存在' };
  const player = room.players.find((p) => p.id === playerId);
  if (!player) return { ok: false, error: '你不是该房间玩家' };
  player.socketId = socketId;
  socketToPlayer.set(socketId, { roomCode: room.code, playerId });
  return { ok: true, room };
}

export function getRoom(code: string): RoomState | undefined {
  return rooms.get(code.toUpperCase());
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
