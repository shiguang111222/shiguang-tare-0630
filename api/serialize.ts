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
  // 借命 blinded（替死互换后不知所得之词）：连自己的 ownerId 也隐藏，否则可从叙事中读出
  const isBlinded = me?.blinded === true;
  const segments: Segment[] = room.segments.map((s) => ({
    start: s.start,
    end: s.end,
    ownerId: !isBlinded && s.ownerId === playerId ? s.ownerId : undefined,
  }));

  // 断墨候选：仅对断墨下发，且不泄露 ownerId（全是候选块）
  const isDuanmo = me?.role === '断墨';
  const duanmoChoices: Segment[] = isDuanmo
    ? room.duanmoChoices.map((c) => ({ start: c.start, end: c.end }))
    : [];

  // 识人：封匣即知众人所选角色（他人角色）；每局渐进知晓一名未晓玩家词长
  const isShiren = me?.role === '识人';
  const roleHints = isShiren
    ? room.players
        .filter((p) => p.id !== playerId && p.role)
        .map((p) => ({ ownerId: p.id, role: p.role as Role }))
    : [];
  const segmentHints = isShiren
    ? room.players
        .filter((p) =>
          p.id !== playerId &&
          p.secretWord &&
          p.alive &&
          room.shirenRevealed.includes(p.id),
        )
        .map((p) => ({ ownerId: p.id, length: p.secretWord.length }))
    : [];

  // 量画：各玩家注入词笔画总数（封匣后可知）；第3子轮起加首字笔画；第5子轮起加尾字笔画
  const isLianghua = me?.role === '量画';
  const showHead = room.subRound >= 3;
  const showTail = room.subRound >= 5;
  const strokeHints = isLianghua
    ? room.players
        .filter((p) => p.wordSubmitted && p.secretWord)
        .map((p) => ({
          ownerId: p.id,
          strokes: p.wordStrokes,
          ...(showHead ? { head: p.headStrokes } : {}),
          ...(showTail ? { tail: p.tailStrokes } : {}),
        }))
    : [];

  // 立意：仅立意自己知晓本局所选主题（多人立意各持各主题）
  const isLiyi = me?.role === '立意';
  const myTheme = isLiyi ? (me?.themeChoice ?? null) : undefined;

  let done = 0;
  let total = 0;
  if (room.phase === 'words') {
    total = room.players.filter((p) => p.alive).length;
    done = room.players.filter((p) => p.alive && p.wordSubmitted).length;
  } else if (room.phase === 'play' || room.phase === 'reveal') {
    total = alivePlayers.length;
    done = alivePlayers.filter((p) => p.done).length;
  }

  const canBet = me?.role === '押司' && !me.alive && room.phase === 'play' && room.eliminationOrder.length > 0;
  const canPrune = me?.role === '省笔' && me.alive && room.phase === 'play' && !me.prunedThisRound;

  // 押司死后可见所有玩家注入词（便于押注决策）；result 阶段全员可见
  const isDeadYasi = me?.role === '押司' && !me?.alive;
  const revealedWords = (room.phase === 'result' || isDeadYasi)
    ? room.players
        .filter((p) => p.secretWord)
        .map((p) => ({ ownerId: p.id, word: p.secretWord, nickname: p.nickname }))
    : undefined;

  // 借命在场（存活）：众人获自杀之技
  const jiemingPresent = room.players.some((p) => p.role === '借命' && p.alive);
  // 可自杀：借命在场、己非借命、存活、有己方词段、且在猜词阶段
  const canSuicide = jiemingPresent
    && me?.role !== '借命'
    && me?.alive === true
    && room.phase === 'play'
    && room.segments.some((s) => s.ownerId === playerId && !s.revealed);

  const finalRanking = room.finished
    ? [...room.players]
        .sort((a, b) => b.score - a.score)
        .map((p) => ({ playerId: p.id, nickname: p.nickname, role: (p.role || '断墨') as Role, score: p.score }))
    : undefined;

  return {
    screen: screenFor(room, me),
    roomCode: room.code,
    myId: playerId,
    // 借命 blinded 时不知所得之词，隐藏己方词
    mySecretWord: isBlinded ? '' : (me?.secretWord || ''),
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
    roleHints,
    strokeHints,
    myTheme,
    // 双生：命/猜词次数/形态/第二词（仅双生双形态自己可见第二词）
    myLives: me?.lives ?? 1,
    myGuessesPerRound: me?.guessesPerRound ?? 1,
    myGuessesUsed: me?.guessesUsed ?? 0,
    myDualForm: me?.dualForm ?? null,
    mySecretWord2: me?.role === '双生' && me?.dualForm === 'double' ? (me?.secretWord2 || '') : '',
    // 借命：替死鬼目标与技能状态（仅借命自己可见）
    scapegoatTarget: me?.role === '借命' ? (me?.scapegoatTarget ?? null) : null,
    scapegoatUsed: me?.role === '借命' ? (me?.scapegoatUsed ?? false) : false,
    blinded: isBlinded,
    // 省笔：本局已自动拭去字数（展示用）
    shengbiWiped: room.pruned.length,
    // 借命在场与自杀技
    jiemingPresent,
    canSuicide,
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
  if (room.phase === 'play' || room.phase === 'reveal') return 'play';
  return 'result';
}
