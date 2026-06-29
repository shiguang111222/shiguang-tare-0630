// 按玩家视角脱敏：生成 PlayerView，隐藏他人秘密词与词主归属
import type { PlayerView, PublicPlayer, Segment, Role } from '../shared/types.js';
import type { RoomState, Player } from './store.js';

export function serializeForPlayer(room: RoomState, playerId: number): PlayerView {
  const me = room.players.find((p) => p.id === playerId);
  const alivePlayers = room.players.filter((p) => p.alive);

  const players: PublicPlayer[] = room.players.map((p) => ({
    id: p.id,
    nickname: p.nickname,
    role: p.role,
    score: p.score,
    alive: p.alive,
    wordSubmitted: p.wordSubmitted,
    done: p.done,
    isHost: p.id === room.hostId,
  }));

  // segments 脱敏：只保留自己的 ownerId
  const segments: Segment[] = room.segments.map((s) => ({
    start: s.start,
    end: s.end,
    ownerId: s.ownerId === playerId ? s.ownerId : undefined,
  }));

  // 断墨候选：仅对断墨下发，且不泄露 ownerId（全是候选块）
  const isDuanmo = me?.role === '断墨';
  const duanmoChoices: Segment[] = isDuanmo
    ? room.duanmoChoices.map((c) => ({ start: c.start, end: c.end }))
    : [];

  // 窥简：各玩家词长
  const isKuijian = me?.role === '窥简';
  const segmentHints = isKuijian
    ? room.players
        .filter((p) => p.id !== playerId && p.secretWord)
        .map((p) => ({ ownerId: p.id, length: p.secretWord.length }))
    : [];

  let done = 0;
  let total = 0;
  if (room.phase === 'words') {
    total = room.players.filter((p) => p.alive).length;
    done = room.players.filter((p) => p.alive && p.wordSubmitted).length;
  } else if (room.phase === 'play') {
    total = alivePlayers.length;
    done = alivePlayers.filter((p) => p.done).length;
  }

  const canBet = me?.role === '押司' && !me.alive && room.phase === 'play' && room.eliminationOrder.length > 0;
  const canPrune = me?.role === '省笔' && me.alive && room.phase === 'play' && !me.prunedThisRound;

  const revealedWords = room.phase === 'result'
    ? room.players
        .filter((p) => p.secretWord)
        .map((p) => ({ ownerId: p.id, word: p.secretWord, nickname: p.nickname }))
    : undefined;

  const finalRanking = room.finished
    ? [...room.players]
        .sort((a, b) => b.score - a.score)
        .map((p) => ({ playerId: p.id, nickname: p.nickname, role: (p.role || '断墨') as Role, score: p.score }))
    : undefined;

  return {
    screen: screenFor(room, me),
    roomCode: room.code,
    myId: playerId,
    mySecretWord: me?.secretWord || '',
    myRole: me?.role || null,
    disabledRoles: room.disabledRoles,
    difficulty: room.difficulty,
    waitTime: room.waitTime,
    isHost: playerId === room.hostId,
    players,
    totalRounds: room.totalRounds,
    currentRound: room.currentRound,
    phase: room.phase,
    subRound: room.subRound,
    storyText: room.storyText,
    segments,
    duanmoChoices,
    pruned: room.pruned,
    segmentHints,
    completion: { done, total },
    eliminationOrder: room.eliminationOrder,
    revealedWords,
    finalRanking,
    chat: room.chat.slice(-60),
    myDone: me?.done || false,
    myBetOn: me?.betOn ?? null,
    canBet,
    canPrune,
    storyLoading: room.storyLoading,
  };
}

function screenFor(room: RoomState, me?: Player): PlayerView['screen'] {
  if (room.phase === 'lobby') return 'lobby';
  if (room.phase === 'words') return 'words';
  if (room.phase === 'play') return 'play';
  return 'result';
}
