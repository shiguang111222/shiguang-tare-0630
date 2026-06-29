// 故事引擎：调用 DeepSeek 生成叙事，并定位玩家词
import OpenAI from 'openai';
import type { Segment } from '../shared/types.js';

const apiKey = process.env.DEEPSEEK_API_KEY || '';
const client = apiKey
  ? new OpenAI({ apiKey, baseURL: 'https://api.deepseek.com' })
  : null;

export interface StoryWord {
  playerId: number;
  word: string;
}

export interface GeneratedStory {
  text: string;
  segments: Segment[]; // 含 ownerId
  unembedded: number[]; // 未能嵌入的 playerId
}

const PUNCT = /[，。！？、；：""''「」（）()\[\]【】…—\-\s,.;:!?]/;

function buildPrompt(words: StoryWord[], multiplier: number): { system: string; user: string } {
  const n = words.length;
  const targetLen = 10 + n * multiplier;
  const list = words.map((w, i) => `(${i + 1}) "${w.word}"`).join('、');
  const system =
    '你是一名文字游戏《词匣》的故事织手。你的任务是把若干玩家给出的词语，编织成一段连贯、完整、逻辑清晰的中文短叙事，让这些词语自然地隐藏在文脉之中，读起来不突兀。这是猜词博弈游戏：词语藏得越自然，越难被猜出。';
  const user =
    `请用以下 ${n} 个词语写成一段中文叙事：${list}\n` +
    `要求：\n` +
    `1. 每个词语必须作为不可拆分的整体、完整原样地各出现一次，不得拆字、不得改字、不得增减字。\n` +
    `2. 每个词语在全文中只出现一次，不要重复使用。\n` +
    `3. 叙事须连贯、有画面感、逻辑通顺，像一个微型小场景，可有人物、动作、环境。\n` +
    `4. 目标字数约 ${targetLen} 字（不含标点）。宁可略多，不可少于 ${Math.floor(targetLen * 0.8)} 字。字数不足是最严重的问题。\n` +
    `5. 让这些词语尽量融入语境、不显突兀，但不得添加解释性提示。\n` +
    `6. 只输出叙事正文，不要标题、不要引号、不要解释、不要换行，一段到底。`;
  return { system, user };
}

function locateWords(text: string, words: StoryWord[]): { segments: Segment[]; unembedded: number[] } {
  const segments: Segment[] = [];
  const unembedded: number[] = [];
  for (const w of words) {
    const word = w.word;
    let found = -1;
    let from = 0;
    while (true) {
      const idx = text.indexOf(word, from);
      if (idx === -1) break;
      const end = idx + word.length;
      const conflict = segments.some((s) => !(end <= s.start || idx >= s.end));
      if (!conflict) {
        found = idx;
        break;
      }
      from = idx + 1;
    }
    if (found === -1) {
      unembedded.push(w.playerId);
    } else {
      segments.push({ start: found, end: found + word.length, ownerId: w.playerId });
    }
  }
  segments.sort((a, b) => a.start - b.start);
  return { segments, unembedded };
}

export async function generateStory(words: StoryWord[], multiplier: number): Promise<GeneratedStory> {
  const valid = words.filter((w) => w.word && w.word.length >= 2);
  let text = '';
  let segments: Segment[] = [];
  let unembedded: number[] = [];

  if (!client) {
    text = fallbackLocalStory(valid, multiplier);
    const located = locateWords(text, valid);
    segments = located.segments;
    unembedded = located.unembedded;
  } else {
    const { system, user } = buildPrompt(valid, multiplier);
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const resp = await client.chat.completions.create({
          model: 'deepseek-chat',
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          temperature: 0.9,
          max_tokens: 1024,
        });
        text = (resp.choices?.[0]?.message?.content || '').trim();
      } catch {
        text = '';
      }
      if (text) {
        const located = locateWords(text, valid);
        segments = located.segments;
        unembedded = located.unembedded;
        if (unembedded.length === 0) break;
      }
    }
    if (!text) {
      text = fallbackLocalStory(valid, multiplier);
      const located = locateWords(text, valid);
      segments = located.segments;
      unembedded = located.unembedded;
    }
  }

  return { text, segments, unembedded };
}

// 本地兜底叙事：把词用连接词串成一段，按难度延展
function fallbackLocalStory(words: StoryWord[], multiplier: number): string {
  const openings = ['夜深人静，月隐云后', '暮色四合，寒鸦归巢', '雨后初晴，青石反光', '灯火阑珊，长街寂寥', '风过檐角，铜铃轻响'];
  const conns = ['，忽见', '，想起', '，远处传来', '，依稀是', '，却听得', '，恍惚间', '，只见那'];
  const tails = ['，一切归于沉寂。', '，无人应答。', '，似梦似醒。', '，便成了谜。', '，再无人提起。'];
  let s = openings[Math.floor(Math.random() * openings.length)];
  // 为凑字数，重复使用连接词扩展场景
  const fillers = ['风声渐紧', '夜色愈浓', '不知何处', '似有人语', '灯火摇曳', '月色清冷', '草木含霜', '远山如黛'];
  const targetLen = 10 + words.length * multiplier;
  let extra = Math.max(0, Math.floor((targetLen - s.length - words.reduce((a, w) => a + w.word.length, 0)) / 3));
  words.forEach((w, i) => {
    s += conns[i % conns.length] + w.word;
    if (extra > 0 && i < words.length - 1) {
      s += conns[(i + 2) % conns.length] + fillers[i % fillers.length];
      extra -= 1;
    }
  });
  while (extra > 0) {
    s += conns[extra % conns.length] + fillers[extra % fillers.length];
    extra -= 1;
  }
  s += tails[Math.floor(Math.random() * tails.length)];
  return s;
}
