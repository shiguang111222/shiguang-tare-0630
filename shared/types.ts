// 《词匣》前后端共享类型定义

export type Role = '断墨' | '省笔' | '识人' | '押司' | '量画' | '立意' | '双生' | '借命';

export const ALL_ROLES: Role[] = ['断墨', '省笔', '识人', '押司', '量画', '立意', '双生', '借命'];

// 双生形态：single=一命每子轮猜两词（默认）；double=藏两词两命、失一命前不可猜
export type DualForm = 'single' | 'double';

export interface RoleInfo {
  role: Role;
  name: string;        // 释义
  skill: string;       // 技能描述
  ui: string;          // 界面差异描述
}

export const ROLE_INFO: Record<Role, RoleInfo> = {
  断墨: { role: '断墨', name: '笔断墨开，字字成块', skill: '每轮从若干候选词块中择一猜之，恰有一为玩家词', ui: '点选候选词块即猜' },
  省笔: { role: '省笔', name: '省去闲笔，渐露真意', skill: '开局自动拭去等于玩家人数之字，此后每子轮再自动拭去一字（不暴露玩家词位置）', ui: '被动技能，叙事生成时自动拭字' },
  识人: { role: '识人', name: '识人辨位，知长知短', skill: '封匣即知众人所选角色；每局随机知晓一名未晓玩家注入词之字数，至全部知晓止', ui: '封匣阶段见众人角色，猜词阶段渐进显示词长' },
  押司: { role: '押司', name: '押司坐庄，下注生死', skill: '出局后可押注存活玩家，存活+1/淘汰-1（可负分）', ui: '点选存活玩家下注' },
  量画: { role: '量画', name: '量画知数，毫芒可计', skill: '开局知各玩家注入词笔画总数；第3子轮加知首字笔画；第5子轮加知尾字笔画', ui: '猜词界面常驻笔画面板' },
  立意: { role: '立意', name: '立意定题，叙事循旨', skill: '每局秘密择一主题，叙事依此成文（仅己知晓）；多人同选时各生成独立故事', ui: '封匣阶段从十大主题中择一' },
  双生: { role: '双生', name: '双生双命，或一命双猜', skill: '双击角色卡切换形态：双形态藏两词两命、失一命后方可猜；单形态一命、每子轮可猜两词（开局默认单形态）', ui: '封匣前双击角色卡切换形态' },
  借命: { role: '借命', name: '借命替死，影移他身', skill: '前两子轮白板；第三子轮起可指定一玩家为替死鬼，若己词被猜中而替死鬼未亡，则替死鬼代死、己续其词（仅一次；己不知所得之词，或自猜而亡）', ui: '第三子轮起猜词界面可指定替死鬼' },
};

// 立意可选的叙事主题（范围宽广，不限制 AI 发挥）
export type Theme = '科幻' | '玄幻' | '历史' | '军事' | '动漫' | '武侠' | '都市' | '末日' | '探险' | '校园';

export const ALL_THEMES: Theme[] = ['科幻', '玄幻', '历史', '军事', '动漫', '武侠', '都市', '末日', '探险', '校园'];

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
  revealed?: boolean; // 该词已被猜中（双生失命/借命互换后仍留存），不可再被猜
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

export type Phase = 'lobby' | 'words' | 'play' | 'reveal' | 'result';

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
  segmentHints: { ownerId: number; length: number }[]; // 识人：渐进式知晓的玩家词长（每局新增一个，至全部知晓止）
  roleHints: { ownerId: number; role: Role }[];        // 识人：封匣即知众人所选角色（仅识人有值）
  strokeHints: { ownerId: number; strokes: number; head?: number; tail?: number }[]; // 量画：词笔画总数，第3子轮加首字笔画，第5子轮加尾字笔画
  myTheme?: Theme | null;  // 立意：本局所选主题（仅立意自己有值）
  myLives: number;          // 双生：当前剩余命（1或2）；其他角色恒为1
  myGuessesPerRound: number; // 每子轮可猜词次数（双生单形态=2，其余=1）
  myGuessesUsed: number;    // 本子轮已猜词次数
  myDualForm?: DualForm | null; // 双生：当前形态（single/double）；非双生为 null
  mySecretWord2: string;    // 双生双形态：第二词（仅双生双形态自己可见）
  scapegoatTarget: number | null; // 借命：当前指定的替死鬼 id（仅借命自己可见，未指定为 null）
  scapegoatUsed: boolean;   // 借命：技能是否已发动（已发动则不可再用）
  blinded: boolean;         // 借命：替死互换后不知己方所得之词，可自猜（自杀）
  shengbiWiped: number;     // 省笔：本局已自动拭去字数（展示用）
  jiemingPresent: boolean;  // 借命在场（存活）：众人获自杀之技
  canSuicide: boolean;      // 可自杀：借命在场、己非借命、存活、有己方词段
  completion: { done: number; total: number };
  eliminationOrder: number[];
  revealedWords?: { ownerId: number; word: string; nickname: string }[]; // result 阶段或押司死后
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
  'lobby:dualForm': (payload: { form: DualForm }) => void;
  'lobby:start': () => void;
  'words:submit': (payload: { word: string; word2?: string }) => void;
  'words:theme': (payload: { theme: Theme }) => void;
  'guess:submit': (payload: { start: number; end: number }) => void;
  'guess:submitChoice': (payload: { choiceIndex: number }) => void;
  'skill:prune': () => void;
  'skill:bet': (payload: { targetPlayerId: number }) => void;
  'skill:scapegoat': (payload: { targetPlayerId: number }) => void;
  'skill:suicide': () => void;
  'chat:emoji': (payload: { emoji: string }) => void;
  'round:next': () => void;
}

export interface ServerEvents {
  'room:state': (view: PlayerView) => void;
  'room:tick': (payload: { seconds: number }) => void;
  'chat:message': (message: ChatMessage) => void;
  'error': (payload: { message: string }) => void;
}
