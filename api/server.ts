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
  pruneRandom,
  placeBet,
  nextRound,
  emojiCooldownOk,
  setRole,
  setNickname,
  timeoutPending,
  exitPlayer,
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

// 阶段到期：淘汰未行动者，按需推进
function onPhaseExpire(room: RoomState): void {
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
        startPhaseTimer(room);
      })
      .catch(() => broadcastRoomState(room));
  } else if (room.phase === 'play') {
    resolveSubround(room);
    broadcastRoomState(room);
    if (room.phase === 'play') startPhaseTimer(room);
    else clearTimer(room.code);
  }
}

function startPhaseTimer(room: RoomState): void {
  clearTimer(room.code);
  if (room.phase !== 'words' && room.phase !== 'play') return;
  if (room.storyLoading) return;
  let left = room.waitTime;
  emitTick(room, left);
  const timer = setInterval(() => {
    left -= 1;
    if (left <= 0) {
      clearTimer(room.code);
      onPhaseExpire(room);
    } else {
      emitTick(room, left);
    }
  }, 1000);
  phaseTimers.set(room.code, timer);
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
  socket.on('room:leave', () => {
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
        resolveSubround(room);
        if (room.phase === 'play') startPhaseTimer(room);
        else clearTimer(room.code);
      }
    }
    broadcastRoomState(room);
  });

  // ---------- 大厅 ----------
  socket.on('lobby:profile', (payload) => {
    const ctx = getPlayerBySocket(socket.id);
    if (!ctx) return emitError(socket, '未加入房间');
    setNickname(ctx.room, ctx.player.id, payload.nickname);
    const r = setRole(ctx.room, ctx.player.id, payload.role);
    if (!r.ok) return emitError(socket, r.error || '角色设置失败');
    broadcastRoomState(ctx.room);
  });

  socket.on('lobby:start', () => {
    const ctx = getPlayerBySocket(socket.id);
    if (!ctx) return;
    if (ctx.player.id !== ctx.room.hostId) return emitError(socket, '仅房主可开始');
    const r = startGame(ctx.room);
    if (!r.ok) return emitError(socket, r.error || '开始失败');
    broadcastRoomState(ctx.room);
    startPhaseTimer(ctx.room);
  });

  // ---------- 入词 ----------
  socket.on('words:submit', (payload) => {
    const ctx = getPlayerBySocket(socket.id);
    if (!ctx) return;
    const r = submitWord(ctx.room, ctx.player.id, payload.word);
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

  // ---------- 猜词 ----------
  socket.on('guess:submit', (payload) => {
    const ctx = getPlayerBySocket(socket.id);
    if (!ctx) return;
    const r = submitGuess(ctx.room, ctx.player.id, payload);
    if (!r.ok) return emitError(socket, r.error || '提交失败');
    broadcastRoomState(ctx.room);
    if (allGuessesSubmitted(ctx.room)) {
      resolveSubround(ctx.room);
      broadcastRoomState(ctx.room);
      if (ctx.room.phase === 'play') startPhaseTimer(ctx.room);
      else clearTimer(ctx.room.code);
    }
  });

  socket.on('guess:submitChoice', (payload) => {
    const ctx = getPlayerBySocket(socket.id);
    if (!ctx) return;
    const r = submitGuess(ctx.room, ctx.player.id, payload);
    if (!r.ok) return emitError(socket, r.error || '提交失败');
    broadcastRoomState(ctx.room);
    if (allGuessesSubmitted(ctx.room)) {
      resolveSubround(ctx.room);
      broadcastRoomState(ctx.room);
      if (ctx.room.phase === 'play') startPhaseTimer(ctx.room);
      else clearTimer(ctx.room.code);
    }
  });

  // ---------- 角色技能 ----------
  socket.on('skill:prune', () => {
    const ctx = getPlayerBySocket(socket.id);
    if (!ctx) return;
    const r = pruneRandom(ctx.room, ctx.player.id);
    if (!r.ok) return emitError(socket, r.error || '拭字失败');
    broadcastRoomState(ctx.room);
  });

  socket.on('skill:bet', (payload) => {
    const ctx = getPlayerBySocket(socket.id);
    if (!ctx) return;
    const r = placeBet(ctx.room, ctx.player.id, payload.targetPlayerId);
    if (!r.ok) return emitError(socket, r.error || '下注失败');
    broadcastRoomState(ctx.room);
  });

  // ---------- 公屏表情 ----------
  socket.on('chat:emoji', (payload) => {
    const ctx = getPlayerBySocket(socket.id);
    if (!ctx) return;
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
    const r = nextRound(ctx.room);
    if (!r.ok) return emitError(socket, r.error || '推进失败');
    broadcastRoomState(ctx.room);
    startPhaseTimer(ctx.room);
  });

  // ---------- 断线 ----------
  socket.on('disconnect', () => {
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
      // 游戏中断线 = 退出 = 淘汰
      exitPlayer(room, player.id);
      pushChat(room, { type: 'system', text: `${player.nickname} 断线离匣。` });
      if (room.phase === 'words' && allWordsSubmitted(room)) {
        generateAndStartPlay(room)
          .then(() => {
            broadcastRoomState(room);
            startPhaseTimer(room);
          })
          .catch(() => broadcastRoomState(room));
      } else if (room.phase === 'play' && allGuessesSubmitted(room)) {
        resolveSubround(room);
        if (room.phase === 'play') startPhaseTimer(room);
        else clearTimer(room.code);
      }
    }
    broadcastRoomState(room);
    console.log('[io] disconnected', socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`Server ready on port ${PORT} (http + socket.io)`);
  console.log(`[env] AI story engine: ${process.env.DEEPSEEK_API_KEY ? "DeepSeek online" : "fallback (no key)"}`);
});

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
