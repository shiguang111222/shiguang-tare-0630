// 《词匣》前后端共享类型定义

export type Role = '断墨' | '省笔' | '窥简' | '押司';

export const ALL_ROLES: Role[] = ['断墨', '省笔', '窥简', '押司'];

export interface RoleInfo {
  role: Role;
  name: string;        // 释义
  skill: string;       // 技能描述
  ui: string;          // 界面差异描述
}

export const ROLE_INFO: Record<Role, RoleInfo> = {
  断墨: { role: '断墨', name: '笔断墨开，字字成块', skill: '每轮从若干候选词块中择一猜之，恰有一为玩家词', ui: '点选候选词块即猜' },
  省笔: { role: '省笔', name: '省去闲笔，渐露真意', skill: '每子轮可随机拭去一字（不暴露玩家词位置）', ui: '点「拭去一字」按钮，随机抹去闲字' },
  窥简: { role: '窥简', name: '窥简量长，先知其度', skill: '开局即知每位玩家所持词字数', ui: '顶部常驻词长面板' },
  押司: { role: '押司', name: '押司坐庄，下注生死', skill: '出局后可押注存活玩家，存活+1/淘汰-1（可负分）', ui: '点选存活玩家下注' },
};

export type Difficulty = '新手' | '简单' | '困难' | '噩梦';

export const ALL_DIFFICULTIES: Difficulty[] = ['新手', '简单', '困难', '噩梦'];

export const DIFFICULTY_INFO: Record<Difficulty, { multiplier: number; desc: string }> = {
  新手: { multiplier: 10, desc: '叙事约 10+人数×10 字' },
  简单: { multiplier: 15, desc: '叙事约 10+人数×15 字' },
  困难: { multiplier: 20, desc: '叙事约 10+人数×20 字' },
  噩梦: { multiplier: 40, desc: '叙事约 10+人数×40 字' },
};

export const WAIT_TIMES = [20, 30, 60] as const;

export interface Segment {
  start: number;
  end: number; // exclusive
  ownerId?: number; // 仅对该词主可见（脱敏后）
}

export interface ChatMessage {
  id: string;
  type: 'system' | 'emoji';
  playerId?: number;
  nickname?: string;
  emoji?: string;
  text?: string;
  ts: number;
}

export type Phase = 'lobby' | 'words' | 'play' | 'result';

// 下发给单个玩家的脱敏视图
export interface PlayerView {
  screen: 'home' | 'lobby' | 'words' | 'play' | 'result';
  roomCode: string;
  myId: number;
  mySecretWord: string;
  myRole: Role | null;
  disabledRoles: Role[];
  difficulty: Difficulty;
  waitTime: number;
  isHost: boolean;
  players: PublicPlayer[];
  totalRounds: number;
  currentRound: number;
  phase: Phase;
  subRound: number;
  storyText: string;
  segments: Segment[];        // 含自己的 ownerId；他人词无 ownerId
  duanmoChoices: Segment[];   // 仅断墨有值：候选词块（无 ownerId 泄露）
  pruned: number[];           // 已拭去的字符索引
  segmentHints: { ownerId: number; length: number }[]; // 窥简：各玩家词长（仅窥简有值）
  completion: { done: number; total: number };
  eliminationOrder: number[];
  revealedWords?: { ownerId: number; word: string; nickname: string }[]; // result 阶段
  finalRanking?: { playerId: number; nickname: string; role: Role; score: number }[]; // 总结算
  chat: ChatMessage[];
  myDone: boolean;
  myBetOn?: number | null;
  canBet: boolean;
  canPrune: boolean;
  storyLoading: boolean;
}

export interface PublicPlayer {
  id: number;
  nickname: string;
  role: Role | null;
  score: number;
  alive: boolean;
  wordSubmitted: boolean;
  done: boolean;
  isHost: boolean;
}

// 客户端 → 服务端事件载荷
export interface ClientEvents {
  'room:create': (payload: { nickname: string; totalRounds: number; disabledRoles: Role[]; difficulty: Difficulty; waitTime: number }, ack: (res: { ok: boolean; roomCode?: string; playerId?: number; error?: string }) => void) => void;
  'room:join': (payload: { roomCode: string; nickname: string }, ack: (res: { ok: boolean; playerId?: number; error?: string }) => void) => void;
  'room:rejoin': (payload: { roomCode: string; playerId: number }, ack: (res: { ok: boolean; error?: string }) => void) => void;
  'room:leave': () => void;
  'lobby:profile': (payload: { nickname: string; role: Role }) => void;
  'lobby:start': () => void;
  'words:submit': (payload: { word: string }) => void;
  'guess:submit': (payload: { start: number; end: number }) => void;
  'guess:submitChoice': (payload: { choiceIndex: number }) => void;
  'skill:prune': () => void;
  'skill:bet': (payload: { targetPlayerId: number }) => void;
  'chat:emoji': (payload: { emoji: string }) => void;
  'round:next': () => void;
}

export interface ServerEvents {
  'room:state': (view: PlayerView) => void;
  'room:tick': (payload: { seconds: number }) => void;
  'chat:message': (message: ChatMessage) => void;
  'error': (payload: { message: string }) => void;
}
