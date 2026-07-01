/**
 * 本地开发服务器入口：Express + Socket.IO
 * 承载《词匣》实时联机的所有 ClientEvents 绑定 + 阶段计时器
 */
import 'dotenv/config';
import http from 'http';
import { Server } from 'socket.io';
import app from './app.js';
import {
  createRoom,
  joinRoom,
  rejoinRoom,
  getPlayerBySocket,
  removeSocket,
  pushChat,
  deleteRoom,
  transferHostIfNeeded,
  touchRoom,
  hasConnectedPlayers,
  setPendingDelete,
  runRoomCleanup,
  allRooms,
  type RoomState,
} from './store.js';
import {
  startGame,
  submitWord,
  generateAndStartPlay,
  allWordsSubmitted,
  submitGuess,
  allGuessesSubmitted,
  resolveSubround,
  continueAfterReveal,
  pruneRandom,
  placeBet,
  nextRound,
  emojiCooldownOk,
  setRole,
  setNickname,
  setTheme,
  setDualForm,
  setScapegoat,
  submitSuicide,
  timeoutPending,
  exitPlayer,
  reapDisconnected,
} from './game.js';
import { serializeForPlayer } from './serialize.js';
import type { ClientEvents, ServerEvents } from '../shared/types.js';
import type { Socket } from 'socket.io';

const PORT = (process.env.PORT as string) || '3001';

const server = http.createServer(app);
const io = new Server<ClientEvents, ServerEvents>(server, {
  cors: { origin: true, credentials: true },
});

// 按玩家视角脱敏后，向房间内每个 socket 单独下发 room:state
function broadcastRoomState(room: RoomState): void {
  for (const p of room.players) {
    if (!p.socketId) continue;
    const view = serializeForPlayer(room, p.id);
    io.to(p.socketId).emit('room:state', view);
  }
}

function emitError(socket: Socket<ClientEvents, ServerEvents>, message: string): void {
  socket.emit('error', { message });
}

// ---------- 阶段计时器 ----------
const phaseTimers = new Map<string, ReturnType<typeof setInterval>>();
const REVEAL_SECONDS = 10;
const WORDS_SECONDS = 60;   // 封匣阶段固定 60 秒（给足重连与思考时间）

function clearTimer(roomCode: string): void {
  const t = phaseTimers.get(roomCode);
  if (t) {
    clearInterval(t);
    phaseTimers.delete(roomCode);
  }
  io.to(roomCode).emit('room:tick', { seconds: 0 });
}

function emitTick(room: RoomState, seconds: number): void {
  io.to(room.code).emit('room:tick', { seconds });
}

// 复盘到期：推进到下一子轮
async function onRevealExpire(room: RoomState): Promise<void> {
  await continueAfterReveal(room);
  broadcastRoomState(room);
  startTimerForPhase(room);
}

// 阶段到期：淘汰未行动者，按需推进
async function onPhaseExpire(room: RoomState): Promise<void> {
  if (room.phase === 'reveal') {
    await onRevealExpire(room);
    return;
  }
  if (room.phase !== 'words' && room.phase !== 'play') {
    clearTimer(room.code);
    return;
  }
  const res = timeoutPending(room);
  broadcastRoomState(room);
  if (!res.shouldAdvance) return;

  if (room.phase === 'words') {
    // 全部存活者已封匣 → 生成叙事
    generateAndStartPlay(room)
      .then(() => {
        broadcastRoomState(room);
        startTimerForPhase(room);
      })
      .catch(() => broadcastRoomState(room));
  } else if (room.phase === 'play') {
    await resolveSubround(room);
    broadcastRoomState(room);
    startTimerForPhase(room);
  }
}

function startPhaseTimer(room: RoomState): void {
  clearTimer(room.code);
  if (room.phase !== 'words' && room.phase !== 'play') return;
  if (room.storyLoading) return;
  // 封匣阶段固定 60 秒；猜词阶段用房间设定时长
  let left = room.phase === 'words' ? WORDS_SECONDS : room.waitTime;
  emitTick(room, left);
  const timer = setInterval(() => {
    left -= 1;
    if (left <= 0) {
      clearTimer(room.code);
      onPhaseExpire(room).catch(() => {});
    } else {
      emitTick(room, left);
    }
  }, 1000);
  phaseTimers.set(room.code, timer);
}

// 复盘公屏倒计时：到点自动进入下一子轮
function startRevealTimer(room: RoomState): void {
  clearTimer(room.code);
  let left = REVEAL_SECONDS;
  emitTick(room, left);
  const timer = setInterval(() => {
    left -= 1;
    if (left <= 0) {
      clearTimer(room.code);
      onRevealExpire(room).catch(() => {});
    } else {
      emitTick(room, left);
    }
  }, 1000);
  phaseTimers.set(room.code, timer);
}

// 按当前阶段启动对应计时器
function startTimerForPhase(room: RoomState): void {
  if (room.phase === 'words' || room.phase === 'play') startPhaseTimer(room);
  else if (room.phase === 'reveal') startRevealTimer(room);
  else clearTimer(room.code);
}

io.on('connection', (socket) => {
  console.log('[io] connected', socket.id);

  // ---------- 房间生命周期 ----------
  socket.on('room:create', (payload, ack) => {
    const room = createRoom(
      {
        nickname: payload.nickname,
        totalRounds: payload.totalRounds,
        disabledRoles: payload.disabledRoles,
        difficulty: payload.difficulty,
        waitTime: payload.waitTime,
      },
      socket.id,
    );
    socket.join(room.code);
    ack({ ok: true, roomCode: room.code, playerId: room.hostId });
    broadcastRoomState(room);
  });

  socket.on('room:join', (payload, ack) => {
    const res = joinRoom(payload.roomCode, payload.nickname, socket.id);
    if (!res.ok || !res.room) {
      ack({ ok: false, error: res.error });
      return;
    }
    socket.join(res.room.code);
    ack({ ok: true, playerId: res.playerId });
    broadcastRoomState(res.room);
  });

  socket.on('room:rejoin', (payload, ack) => {
    const res = rejoinRoom(payload.roomCode, payload.playerId, socket.id);
    if (!res.ok || !res.room) {
      ack({ ok: false, error: res.error });
      return;
    }
    socket.join(res.room.code);
    ack({ ok: true });
    broadcastRoomState(res.room);
  });

  // 主动离匣
  socket.on('room:leave', async () => {
    const ctx = getPlayerBySocket(socket.id);
    if (!ctx) return;
    const { room, player } = ctx;
    socket.leave(room.code);
    removeSocket(socket.id);
    player.socketId = null;
    if (room.phase === 'lobby') {
      // 大厅离匣：直接移出房间
      room.players = room.players.filter((p) => p.id !== player.id);
      pushChat(room, { type: 'system', text: `${player.nickname} 离开了房间。` });
      transferHostIfNeeded(room);
      if (room.players.length === 0) {
        clearTimer(room.code);
        deleteRoom(room.code);
        return;
      }
    } else {
      exitPlayer(room, player.id);
      // 退出后检查是否可推进
      if (room.phase === 'words' && allWordsSubmitted(room)) {
        generateAndStartPlay(room)
          .then(() => {
            broadcastRoomState(room);
            startPhaseTimer(room);
          })
          .catch(() => broadcastRoomState(room));
      } else if (room.phase === 'play' && allGuessesSubmitted(room)) {
        await resolveSubround(room);
        startTimerForPhase(room);
      }
    }
    // 已成结算/终局且无人在线 → 延迟删除
    if ((room.phase === 'result' || room.finished) && !hasConnectedPlayers(room)) {
      setPendingDelete(room);
    }
    broadcastRoomState(room);
  });

  // ---------- 大厅 ----------
  socket.on('lobby:profile', (payload) => {
    const ctx = getPlayerBySocket(socket.id);
    if (!ctx) return emitError(socket, '未加入房间');
    touchRoom(ctx.room);
    setNickname(ctx.room, ctx.player.id, payload.nickname);
    const r = setRole(ctx.room, ctx.player.id, payload.role);
    if (!r.ok) return emitError(socket, r.error || '角色设置失败');
    broadcastRoomState(ctx.room);
  });

  // 双生：双击角色卡切换形态（封匣前有效；开局默认单形态）
  socket.on('lobby:dualForm', (payload) => {
    const ctx = getPlayerBySocket(socket.id);
    if (!ctx) return emitError(socket, '未加入房间');
    touchRoom(ctx.room);
    const r = setDualForm(ctx.room, ctx.player.id, payload.form);
    if (!r.ok) return emitError(socket, r.error || '形态切换失败');
    broadcastRoomState(ctx.room);
  });

  socket.on('lobby:start', () => {
    const ctx = getPlayerBySocket(socket.id);
    if (!ctx) return;
    if (ctx.player.id !== ctx.room.hostId) return emitError(socket, '仅房主可开始');
    touchRoom(ctx.room);
    const r = startGame(ctx.room);
    if (!r.ok) return emitError(socket, r.error || '开始失败');
    broadcastRoomState(ctx.room);
    startPhaseTimer(ctx.room);
  });

  // ---------- 入词 ----------
  socket.on('words:submit', (payload) => {
    const ctx = getPlayerBySocket(socket.id);
    if (!ctx) return;
    touchRoom(ctx.room);
    const r = submitWord(ctx.room, ctx.player.id, payload.word, payload.word2);
    if (!r.ok) return emitError(socket, r.error || '提交失败');
    broadcastRoomState(ctx.room);
    if (allWordsSubmitted(ctx.room)) {
      generateAndStartPlay(ctx.room)
        .then(() => {
          broadcastRoomState(ctx.room);
          startPhaseTimer(ctx.room);
        })
        .catch(() => broadcastRoomState(ctx.room));
    }
  });

  // 立意玩家选定本局主题（仅立意可调，主题仅己知晓）
  socket.on('words:theme', (payload) => {
    const ctx = getPlayerBySocket(socket.id);
    if (!ctx) return;
    touchRoom(ctx.room);
    const r = setTheme(ctx.room, ctx.player.id, payload.theme);
    if (!r.ok) return emitError(socket, r.error || '择题失败');
    broadcastRoomState(ctx.room);
  });

  // ---------- 猜词 ----------
  socket.on('guess:submit', async (payload) => {
    const ctx = getPlayerBySocket(socket.id);
    if (!ctx) return;
    touchRoom(ctx.room);
    const r = submitGuess(ctx.room, ctx.player.id, payload);
    if (!r.ok) return emitError(socket, r.error || '提交失败');
    broadcastRoomState(ctx.room);
    if (allGuessesSubmitted(ctx.room)) {
      await resolveSubround(ctx.room);
      broadcastRoomState(ctx.room);
      startTimerForPhase(ctx.room);
    }
  });

  socket.on('guess:submitChoice', async (payload) => {
    const ctx = getPlayerBySocket(socket.id);
    if (!ctx) return;
    touchRoom(ctx.room);
    const r = submitGuess(ctx.room, ctx.player.id, payload);
    if (!r.ok) return emitError(socket, r.error || '提交失败');
    broadcastRoomState(ctx.room);
    if (allGuessesSubmitted(ctx.room)) {
      await resolveSubround(ctx.room);
      broadcastRoomState(ctx.room);
      startTimerForPhase(ctx.room);
    }
  });

  // ---------- 角色技能 ----------
  socket.on('skill:prune', () => {
    const ctx = getPlayerBySocket(socket.id);
    if (!ctx) return;
    touchRoom(ctx.room);
    const r = pruneRandom(ctx.room, ctx.player.id);
    if (!r.ok) return emitError(socket, r.error || '拭字失败');
    broadcastRoomState(ctx.room);
  });

  socket.on('skill:bet', (payload) => {
    const ctx = getPlayerBySocket(socket.id);
    if (!ctx) return;
    touchRoom(ctx.room);
    const r = placeBet(ctx.room, ctx.player.id, payload.targetPlayerId);
    if (!r.ok) return emitError(socket, r.error || '下注失败');
    broadcastRoomState(ctx.room);
  });

  // 借命：第3子轮起猜词阶段指定替死鬼（未发动前可改；发动后不可再用）
  socket.on('skill:scapegoat', (payload) => {
    const ctx = getPlayerBySocket(socket.id);
    if (!ctx) return;
    touchRoom(ctx.room);
    const r = setScapegoat(ctx.room, ctx.player.id, payload.targetPlayerId);
    if (!r.ok) return emitError(socket, r.error || '指定替死鬼失败');
    broadcastRoomState(ctx.room);
  });

  // 自杀：借命在场时众人可自猜己词（打破不可猜己词之规），反噬借命或自裁
  socket.on('skill:suicide', async () => {
    const ctx = getPlayerBySocket(socket.id);
    if (!ctx) return;
    touchRoom(ctx.room);
    const r = submitSuicide(ctx.room, ctx.player.id);
    if (!r.ok) return emitError(socket, r.error || '自杀失败');
    broadcastRoomState(ctx.room);
    if (allGuessesSubmitted(ctx.room)) {
      await resolveSubround(ctx.room);
      broadcastRoomState(ctx.room);
      startTimerForPhase(ctx.room);
    }
  });

  // ---------- 公屏表情 ----------
  socket.on('chat:emoji', (payload) => {
    const ctx = getPlayerBySocket(socket.id);
    if (!ctx) return;
    touchRoom(ctx.room);
    if (!emojiCooldownOk(ctx.room, ctx.player.id)) return emitError(socket, '表情冷却中');
    ctx.room.lastEmojiTs[ctx.player.id] = Date.now();
    pushChat(ctx.room, {
      type: 'emoji',
      playerId: ctx.player.id,
      nickname: ctx.player.nickname,
      emoji: payload.emoji,
    });
    broadcastRoomState(ctx.room);
  });

  // ---------- 进入下一局 ----------
  socket.on('round:next', () => {
    const ctx = getPlayerBySocket(socket.id);
    if (!ctx) return;
    if (ctx.player.id !== ctx.room.hostId) return emitError(socket, '仅房主可推进');
    touchRoom(ctx.room);
    const r = nextRound(ctx.room);
    if (!r.ok) return emitError(socket, r.error || '推进失败');
    broadcastRoomState(ctx.room);
    startPhaseTimer(ctx.room);
  });

  // ---------- 断线 ----------
  socket.on('disconnect', async () => {
    const ctx = getPlayerBySocket(socket.id);
    removeSocket(socket.id);
    if (!ctx) {
      console.log('[io] disconnected', socket.id);
      return;
    }
    const { room, player } = ctx;
    player.socketId = null;
    if (room.phase === 'lobby') {
      room.players = room.players.filter((p) => p.id !== player.id);
      pushChat(room, { type: 'system', text: `${player.nickname} 离开了房间。` });
      transferHostIfNeeded(room);
      if (room.players.length === 0) {
        clearTimer(room.code);
        deleteRoom(room.code);
        return;
      }
    } else {
      // 游戏中断线：给宽限期可重连，不立即淘汰
      player.disconnectedAt = Date.now();
      pushChat(room, { type: 'system', text: `${player.nickname} 断线，${DISCONNECT_GRACE_MS / 1000} 秒内重连可恢复。` });
      // 断线可能让本轮凑齐"全员已行动"，尝试推进
      if (room.phase === 'words' && allWordsSubmitted(room)) {
        generateAndStartPlay(room)
          .then(() => {
            broadcastRoomState(room);
            startPhaseTimer(room);
          })
          .catch(() => broadcastRoomState(room));
      } else if (room.phase === 'play' && allGuessesSubmitted(room)) {
        await resolveSubround(room);
        startTimerForPhase(room);
      }
    }
    // 已成结算/终局且无人在线 → 延迟删除（游戏中断线不算活动，不刷新闲置计时）
    if ((room.phase === 'result' || room.finished) && !hasConnectedPlayers(room)) {
      setPendingDelete(room);
    }
    broadcastRoomState(room);
    console.log('[io] disconnected', socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`Server ready on port ${PORT} (http + socket.io)`);
  console.log(`[env] AI story engine: ${process.env.DEEPSEEK_API_KEY ? "DeepSeek online" : "fallback (no key)"}`);
});

// ---------- 定时任务：断线收割 + 房间清理 ----------
// 每 60 秒扫一次：收割断线超宽限期的玩家，删除闲置超 30 分钟 / 已到期待删的房间
const DISCONNECT_GRACE_MS = 90 * 1000;   // 断线宽限期 90 秒，刷新重连可恢复
const SWEEP_INTERVAL_MS = 60 * 1000;
const ROOM_IDLE_MAX_MS = 30 * 60 * 1000;
const sweepTimer = setInterval(() => {
  const now = Date.now();
  for (const room of allRooms()) {
    const reaped = reapDisconnected(room, now, DISCONNECT_GRACE_MS);
    if (reaped.length > 0) {
      for (const pid of reaped) {
        const p = room.players.find((x) => x.id === pid);
        pushChat(room, { type: 'system', text: `${p?.nickname ?? '玩家'} 断线超时未归，逐出本局。` });
      }
      // 断线收割后可能凑齐终局或推进条件
      if (room.phase === 'play' && allGuessesSubmitted(room)) {
        resolveSubround(room)
          .then(() => {
            broadcastRoomState(room);
            startTimerForPhase(room);
          })
          .catch(() => broadcastRoomState(room));
        continue;
      }
      broadcastRoomState(room);
    }
  }
  const deleted = runRoomCleanup(now, ROOM_IDLE_MAX_MS);
  for (const code of deleted) {
    clearTimer(code);
    console.log(`[cleanup] removed stale/empty room ${code}`);
  }
}, SWEEP_INTERVAL_MS);
sweepTimer.unref?.();

process.on('SIGTERM', () => {
  console.log('SIGTERM signal received');
  server.close(() => {
    io.close();
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT signal received');
  server.close(() => {
    io.close();
    process.exit(0);
  });
});

export default app;
