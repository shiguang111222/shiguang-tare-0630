import { create } from "zustand";
import { socket } from "./lib/socket";
import type { PlayerView, Role, Difficulty, Theme, DualForm } from "../shared/types";
import { getVoiceChar, setVoiceChar as persistVoiceChar, type VoiceChar } from "./lib/sound";

const SESSION_KEY = "cihxia.session";

interface Session {
  roomCode: string;
  playerId: number;
}

function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}
function saveSession(s: Session) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(s));
}
function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

export type Tab = "game" | "chat";

interface GameStore {
  view: PlayerView | null;
  tab: Tab;
  connected: boolean;
  error: string | null;
  rejoinTried: boolean;
  secondsLeft: number;

  init: () => void;
  setTab: (tab: Tab) => void;
  clearError: () => void;
  leaveRoom: () => void;
  voiceChar: VoiceChar;
  setVoiceChar: (v: VoiceChar) => void;

  createRoom: (
    p: { nickname: string; totalRounds: number; disabledRoles: Role[]; difficulty: Difficulty; waitTime: number },
    ack: (ok: boolean, roomCode?: string, error?: string) => void,
  ) => void;
  joinRoom: (
    p: { roomCode: string; nickname: string },
    ack: (ok: boolean, error?: string) => void,
  ) => void;

  setProfile: (p: { nickname: string; role: Role }) => void;
  setDualForm: (form: DualForm) => void;
  start: () => void;
  submitWord: (word: string, word2?: string) => void;
  setTheme: (theme: Theme) => void;
  submitGuess: (start: number, end: number) => void;
  submitChoice: (choiceIndex: number) => void;
  prune: () => void;
  bet: (targetPlayerId: number) => void;
  scapegoat: (targetPlayerId: number) => void;
  suicide: () => void;
  sendEmoji: (emoji: string) => void;
  nextRound: () => void;
}

export const useGame = create<GameStore>((set, get) => ({
  view: null,
  tab: "game",
  connected: false,
  error: null,
  rejoinTried: false,
  secondsLeft: 0,
  voiceChar: getVoiceChar(),

  setVoiceChar: (v) => {
    persistVoiceChar(v);
    set({ voiceChar: v });
  },

  init: () => {
    if (socket.connected) return;
    socket.connect();

    socket.on("connect", () => {
      set({ connected: true });
      const sess = loadSession();
      if (sess && !get().rejoinTried) {
        set({ rejoinTried: true });
        socket.emit("room:rejoin", { roomCode: sess.roomCode, playerId: sess.playerId }, (res) => {
          if (!res.ok) {
            clearSession();
            set({ view: null });
          }
        });
      }
    });

    socket.on("disconnect", () => set({ connected: false, rejoinTried: false, secondsLeft: 0 }));

    socket.on("room:state", (view) => {
      const prev = get().view;
      set({ view, error: null });
      // 进入复盘公屏 → 自动切到公屏；复盘结束回到猜词 → 自动切回游戏
      if (prev && prev.phase !== "reveal" && view.phase === "reveal") {
        set({ tab: "chat" });
      } else if (prev && prev.phase === "reveal" && view.phase === "play") {
        set({ tab: "game" });
      }
    });

    socket.on("room:tick", (payload) => set({ secondsLeft: payload.seconds }));

    socket.on("error", (payload) => {
      set({ error: payload.message });
      // 错误提示自动消散
      setTimeout(() => {
        if (get().error === payload.message) set({ error: null });
      }, 2600);
    });
  },

  setTab: (tab) => set({ tab }),
  clearError: () => set({ error: null }),

  leaveRoom: () => {
    socket.emit("room:leave");
    clearSession();
    set({ view: null, tab: "game", rejoinTried: false, secondsLeft: 0 });
  },

  createRoom: (p, ack) => {
    socket.emit("room:create", p, (res) => {
      if (res.ok && res.roomCode && res.playerId != null) {
        saveSession({ roomCode: res.roomCode, playerId: res.playerId });
        set({ rejoinTried: true });
        ack(true, res.roomCode);
      } else {
        ack(false, undefined, res.error);
        set({ error: res.error });
      }
    });
  },

  joinRoom: (p, ack) => {
    socket.emit("room:join", p, (res) => {
      if (res.ok && res.playerId != null) {
        // ack 在 room:state 下发之前到达，故用房号入参落盘会话
        saveSession({ roomCode: p.roomCode.toUpperCase(), playerId: res.playerId });
        set({ rejoinTried: true });
        ack(true);
      } else {
        ack(false, res.error);
        set({ error: res.error });
      }
    });
  },

  setProfile: (p) => socket.emit("lobby:profile", p),
  setDualForm: (form) => socket.emit("lobby:dualForm", { form }),
  start: () => socket.emit("lobby:start"),
  submitWord: (word, word2) => socket.emit("words:submit", word2 ? { word, word2 } : { word }),
  setTheme: (theme) => socket.emit("words:theme", { theme }),
  submitGuess: (start, end) => socket.emit("guess:submit", { start, end }),
  submitChoice: (choiceIndex) => socket.emit("guess:submitChoice", { choiceIndex }),
  prune: () => socket.emit("skill:prune"),
  bet: (targetPlayerId) => socket.emit("skill:bet", { targetPlayerId }),
  scapegoat: (targetPlayerId) => socket.emit("skill:scapegoat", { targetPlayerId }),
  suicide: () => socket.emit("skill:suicide"),
  sendEmoji: (emoji) => socket.emit("chat:emoji", { emoji }),
  nextRound: () => socket.emit("round:next"),
}));
