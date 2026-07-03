import { useEffect, useMemo, useRef, useState } from "react";
import { useGame } from "../store";
import { ROLE_INFO } from "../../shared/types";
import { cn } from "@/lib/utils";
import { playSound, playVoice } from "@/lib/sound";

const MAX_LEN = 4;
const LONG_PRESS_MS = 450;
const PUNCT = /[，。！？、；：""''「」（）()\[\]【】…—\-\s,.;:!?]/;

export default function Play() {
  const view = useGame((s) => s.view)!;
  const secondsLeft = useGame((s) => s.secondsLeft);
  const submitGuess = useGame((s) => s.submitGuess);
  const submitChoice = useGame((s) => s.submitChoice);
  const prune = useGame((s) => s.prune);
  const scapegoat = useGame((s) => s.scapegoat);
  const suicide = useGame((s) => s.suicide);

  const me = view.players.find((p) => p.id === view.myId)!;
  const isDuanmo = view.myRole === "断墨";
  // 双生：双形态满命（2命）前不可猜；单形态每子轮可猜两词
  const isShuangsheng = view.myRole === "双生";
  const shuangLocked = isShuangsheng && view.myDualForm === "double" && view.myLives >= 2;
  const guessesLeft = view.myGuessesPerRound - view.myGuessesUsed;
  // 借命：第3子轮起可指定替死鬼（技能未发动时）
  const isJieming = view.myRole === "借命";
  const canPickScapegoat = isJieming && view.subRound >= 3 && !view.scapegoatUsed && me.alive;
  // 微信式选区：长按起手，两端手柄拖拽调长度。selStart/selEnd 闭区间字符索引。
  const [selStart, setSelStart] = useState<number | null>(null);
  const [selEnd, setSelEnd] = useState<number | null>(null);
  const [selChoice, setSelChoice] = useState<number | null>(null);

  // 长按定时器、拖拽中标记
  const longPressTimer = useRef<number | null>(null);
  const longPressStartIdx = useRef<number | null>(null);
  const dragHandle = useRef<"start" | "end" | null>(null);
  const charRefs = useRef<(HTMLSpanElement | null)[]>([]);

  // 子轮切换或已提交时清空选择
  useEffect(() => {
    setSelStart(null);
    setSelEnd(null);
    setSelChoice(null);
  }, [view.subRound, view.myDone]);

  // 结算反馈音效 + 出局动画：play→reveal（继续）/ play→result（终局）即为本轮揭晓时刻
  const [showEliminate, setShowEliminate] = useState(false);
  const prevElimLen = useRef(view.eliminationOrder.length);
  const prevPhase = useRef(view.phase);
  const prevAlive = useRef(me.alive);
  useEffect(() => {
    const resolved =
      prevPhase.current === "play" && (view.phase === "reveal" || view.phase === "result");
    const elimGrew = view.eliminationOrder.length > prevElimLen.current;
    const iDied = !me.alive && prevAlive.current;

    if (resolved) {
      // 出局→落败语音；有人出局且非我→猜对语音；无人出局→猜错语音
      if (iDied) playVoice("06_lose");
      else if (elimGrew) playVoice("01_correct");
      else playVoice("02_wrong");
    }
    let t: number | undefined;
    if (iDied) {
      setShowEliminate(true);
      t = window.setTimeout(() => setShowEliminate(false), 1300);
    }

    prevElimLen.current = view.eliminationOrder.length;
    prevPhase.current = view.phase;
    prevAlive.current = me.alive;

    return () => {
      if (t !== undefined) window.clearTimeout(t);
    };
  }, [view.phase, view.eliminationOrder.length, me.alive]);

  // 猜词倒计时催促：play 阶段最后 5 秒，每子轮播一次
  const guessUrgeKey = useRef("");
  useEffect(() => {
    if (view.phase !== "play") return;
    if (me.alive && !me.done && secondsLeft > 0 && secondsLeft <= 5) {
      const key = `${view.subRound}`;
      if (guessUrgeKey.current !== key) {
        guessUrgeKey.current = key;
        playVoice("04_guess_urge");
      }
    }
  }, [secondsLeft, view.phase, view.subRound, me.alive, me.done]);

  const ownRanges = useMemo(
    () => view.segments.filter((s) => s.ownerId === view.myId),
    [view.segments, view.myId],
  );

  const prunedSet = useMemo(() => new Set(view.pruned), [view.pruned]);
  const isOwn = (i: number) => ownRanges.some((r) => i >= r.start && i < r.end);

  if (view.storyLoading) return <StoryLoading />;

  const eliminated = !me.alive;
  const readOnly = view.myDone || eliminated;

  const hasSel = selStart !== null && selEnd !== null;
  const selLen = hasSel ? selEnd! - selStart! + 1 : 0;

  // 找到字符索引落在哪个字符上（基于 data-idx）
  // 跨行换行时 elementFromPoint 可能命中字间缝隙/父容器，退化为最近矩形匹配
  const idxFromPoint = (x: number, y: number): number | null => {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    if (el) {
      const attr = el.getAttribute("data-idx");
      if (attr !== null) {
        const n = parseInt(attr, 10);
        if (!isNaN(n)) return n;
      }
    }
    // 兜底：遍历字元矩形，命中或最近者
    let best: number | null = null;
    let bestDist = Infinity;
    for (let i = 0; i < view.storyText.length; i++) {
      const r = charRefs.current[i]?.getBoundingClientRect();
      if (!r) continue;
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return i;
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const d = Math.hypot(x - cx, y - cy);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    return best;
  };

  // 标点判断：选词起手与拖拽均跳过标点，避免选区含标点
  const isPunct = (i: number) => PUNCT.test(view.storyText[i]);

  // 长按起手：触摸开始时记录索引并启动定时器
  const onCharTouchStart = (i: number) => {
    if (readOnly || isDuanmo) return;
    if (isPunct(i)) return; // 标点不可起选
    if (longPressTimer.current) window.clearTimeout(longPressTimer.current);
    longPressStartIdx.current = i;
    longPressTimer.current = window.setTimeout(() => {
      // 长按触发：以该字为起点，向后选 2 字（若到末尾或下一字为标点则向前）
      const len = view.storyText.length;
      let a = i;
      let b = i;
      if (i + 1 < len && !isPunct(i + 1)) b = i + 1;
      else if (i - 1 >= 0 && !isPunct(i - 1)) a = i - 1;
      setSelStart(a);
      setSelEnd(b);
      if (navigator.vibrate) navigator.vibrate(15);
    }, LONG_PRESS_MS);
  };

  // 触摸移动或结束 → 取消长按定时器（如果还没触发）
  const cancelLongPress = () => {
    if (longPressTimer.current) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  // PC 鼠标：按下立即起选区（不需要长按）
  const onCharMouseDown = (i: number) => {
    if (readOnly || isDuanmo) return;
    if (isPunct(i)) return; // 标点不可起选
    // 仅在无选区或点在选区外时重置；点在手柄上的逻辑由手柄接管
    if (hasSel && i >= selStart! && i <= selEnd!) return;
    const len = view.storyText.length;
    let a = i;
    let b = i;
    if (i + 1 < len && !isPunct(i + 1)) b = i + 1;
    else if (i - 1 >= 0 && !isPunct(i - 1)) a = i - 1;
    setSelStart(a);
    setSelEnd(b);
  };

  // 手柄按下：进入拖拽模式
  const onHandleDown = (e: React.PointerEvent, which: "start" | "end") => {
    if (!hasSel) return;
    e.preventDefault();
    e.stopPropagation();
    dragHandle.current = which;
  };

  // 全局指针移动：处理手柄拖拽（同时兼容触摸和鼠标）
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!dragHandle.current || !hasSel) return;
      const idx = idxFromPoint(e.clientX, e.clientY);
      if (idx === null) return;
      if (isPunct(idx)) return; // 标点不可纳入选区
      e.preventDefault();
      const start = selStart!;
      const end = selEnd!;
      if (dragHandle.current === "start") {
        // 起点手柄：不能超过 end，不能让长度超 MAX_LEN
        if (idx > end) return;
        if (end - idx + 1 > MAX_LEN) return;
        if (idx !== start) setSelStart(idx);
      } else {
        // 末点手柄：不能小于 start，不能超 MAX_LEN
        if (idx < start) return;
        if (idx - start + 1 > MAX_LEN) return;
        if (idx !== end) setSelEnd(idx);
      }
    };
    const onUp = () => {
      dragHandle.current = null;
    };
    document.addEventListener("pointermove", onMove, { passive: false });
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onUp);
    return () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onUp);
    };
  }, [hasSel, selStart, selEnd]);

  const clearSel = () => {
    setSelStart(null);
    setSelEnd(null);
  };

  const doGuess = () => {
    if (!hasSel || selLen < 2) return;
    playSound("submit");
    submitGuess(selStart!, selEnd! + 1);
    clearSel();
  };

  const doChoiceGuess = () => {
    if (selChoice === null) return;
    playSound("submit");
    submitChoice(selChoice);
    setSelChoice(null);
  };

  return (
    <div className="h-full flex flex-col relative">
      {/* 出局动画：朱砂"出局"印章一闪而过 */}
      {showEliminate && (
        <div className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center">
          <div className="font-brush text-7xl text-cinnabar seal-stamp px-10 py-5 animate-eliminate">
            出 局
          </div>
        </div>
      )}
      {/* 头部信息 */}
      <div className="shrink-0 px-5 pt-4 pb-2">
        <div className="flex items-baseline justify-between">
          <span className="font-brush text-2xl text-gold">猜 词</span>
          <span className="text-paper/45 text-xs font-sub">
            第{view.currentRound}局 · 第{view.subRound}轮
          </span>
        </div>
        <div className="flex items-center gap-2 mt-1.5">
          <div className="flex-1 h-1 rounded-full bg-ink-soft overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-cinnabar to-gold transition-all"
              style={{
                width: `${view.completion.total ? (view.completion.done / view.completion.total) * 100 : 0}%`,
              }}
            />
          </div>
          <span className="text-gold font-sub text-xs">
            {view.completion.done}/{view.completion.total}
          </span>
        </div>
      </div>

      {/* 识人 · 渐进词长面板：每局揭示一名未晓玩家词长 */}
      {view.myRole === "识人" && view.segmentHints.length > 0 && (
        <div className="shrink-0 mx-5 mb-2 px-3 py-2 rounded-sm border border-jade/40 bg-jade/10">
          <span className="font-sub text-jade text-[11px]">识人 · 已晓词长：</span>
          {view.segmentHints.map((h) => {
            const nick = view.players.find((p) => p.id === h.ownerId)?.nickname ?? "?";
            return (
              <span key={h.ownerId} className="text-paper/70 text-[11px] font-sub ml-1.5">
                {nick}{h.length}字
              </span>
            );
          })}
        </div>
      )}

      {/* 量画笔画面板：笔画总数（第3子轮加首字、第5子轮加尾字） */}
      {view.myRole === "量画" && view.strokeHints.length > 0 && (
        <div className="shrink-0 mx-5 mb-2 px-3 py-2 rounded-sm border border-jade/40 bg-jade/10">
          <span className="font-sub text-jade text-[11px]">量画 · 众人词笔画：</span>
          {view.strokeHints.map((h) => {
            const nick = view.players.find((p) => p.id === h.ownerId)?.nickname ?? "?";
            const isMe = h.ownerId === view.myId;
            const headStr = h.head !== undefined ? ` 首${h.head}` : "";
            const tailStr = h.tail !== undefined ? ` 尾${h.tail}` : "";
            return (
              <span key={h.ownerId} className="text-paper/70 text-[11px] font-sub ml-1.5">
                {nick}{isMe ? "(己)" : ""}{h.strokes}画{headStr}{tailStr}
              </span>
            );
          })}
        </div>
      )}

      {/* 双生 · 命与猜词次数面板 */}
      {isShuangsheng && (
        <div className="shrink-0 mx-5 mb-2 px-3 py-2 rounded-sm border border-gold-soft/30 bg-ink-soft/40">
          {shuangLocked ? (
            <span className="font-sub text-cinnabar-light text-[11px]">
              双生 · 双形态满命（{view.myLives}命）· 失一命后方可猜词
            </span>
          ) : (
            <span className="font-sub text-gold/80 text-[11px]">
              双生 · {view.myDualForm === "double" ? "双形态" : "单形态"} · 命 {view.myLives}
              {view.myDualForm === "double" ? "/2" : "/1"}
              {" · 本轮可猜 "}{guessesLeft}/{view.myGuessesPerRound}
            </span>
          )}
        </div>
      )}

      {/* 借命 · 替死鬼面板（第3子轮起、技能未发动时可指定） */}
      {isJieming && (
        <div className="shrink-0 mx-5 mb-2 px-3 py-2 rounded-sm border border-gold-soft/30 bg-ink-soft/40">
          {view.blinded ? (
            <span className="font-sub text-cinnabar-light text-[11px]">
              借命 · 替死已发动 · 不知所得之词 · 可自猜（慎防自杀）
            </span>
          ) : view.scapegoatUsed ? (
            <span className="font-sub text-paper/45 text-[11px]">
              借命 · 技能已发动，不可再指定替死鬼
            </span>
          ) : canPickScapegoat ? (
            <div>
              <p className="font-sub text-gold/80 text-[11px] mb-1.5">
                借命 · 择一替死鬼{view.scapegoatTarget !== null ? "（可改选）" : ""}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {view.players.filter((p) => p.alive && p.id !== view.myId).map((p) => {
                  const sel = view.scapegoatTarget === p.id;
                  return (
                    <button
                      key={p.id}
                      onClick={() => scapegoat(p.id)}
                      className={cn(
                        "px-2.5 py-1 rounded-sm border font-sub text-[11px] transition-colors",
                        sel
                          ? "border-cinnabar bg-cinnabar/20 text-cinnabar-light"
                          : "border-gold-soft/30 bg-ink-soft/50 text-paper/70 active:bg-gold-soft/15",
                      )}
                    >
                      {p.nickname}{sel ? " · 替死" : ""}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <span className="font-sub text-paper/45 text-[11px]">
              借命 · 第3子轮起可指定替死鬼
            </span>
          )}
        </div>
      )}

      {/* 省笔 · 自动拭字计数 */}
      {view.myRole === "省笔" && view.shengbiWiped > 0 && (
        <div className="shrink-0 mx-5 mb-2 px-3 py-2 rounded-sm border border-gold-soft/30 bg-ink-soft/40">
          <span className="font-sub text-gold/70 text-[11px]">
            省笔 · 本局已拭去 {view.shengbiWiped} 字
          </span>
        </div>
      )}

      {/* 角色提示 */}
      {view.myRole && (
        <div className="shrink-0 mx-5 mb-2 text-[11px] text-paper/40 font-sub px-1">
          〔{view.myRole}〕{ROLE_INFO[view.myRole].ui}
        </div>
      )}

      {/* 叙事主体 */}
      <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar px-5">
        <div className="surface-paper rounded-sm p-5 shadow-scroll leading-[2.1] text-[17px] font-serifsc text-ink">
          {eliminated && view.myRole !== "押司" && (
            <div className="mb-3 text-center text-cinnabar-deep text-xs font-sub">
              你已出局 · 静观其变
            </div>
          )}
          <div className="flex flex-wrap">
            {Array.from({ length: view.storyText.length }).map((_, i) => {
              const c = view.storyText[i];
              const pr = prunedSet.has(i);
              const own = isOwn(i);
              const isSel = hasSel && i >= selStart! && i <= selEnd!;
              const isEdgeStart = hasSel && i === selStart!;
              const isEdgeEnd = hasSel && i === selEnd;
              return (
                <span
                  key={i}
                  ref={(el) => { charRefs.current[i] = el; }}
                  data-idx={i}
                  onTouchStart={(e) => { e.stopPropagation(); onCharTouchStart(i); }}
                  onTouchMove={(e) => { e.stopPropagation(); cancelLongPress(); }}
                  onTouchEnd={(e) => { e.stopPropagation(); cancelLongPress(); }}
                  onMouseDown={(e) => { e.stopPropagation(); onCharMouseDown(i); }}
                  style={{ touchAction: "manipulation" }}
                  className={cn(
                    "relative transition-colors select-none",
                    "px-0.5 leading-[2.1]",
                    !readOnly && !isDuanmo && "cursor-pointer",
                    own && !isSel && "border-b-2 border-gold/70",
                    pr && "line-through opacity-25",
                    isSel && "bg-cinnabar/30 text-ink rounded-sm",
                    isSel && isEdgeStart && "rounded-l-sm",
                    isSel && isEdgeEnd && "rounded-r-sm",
                  )}
                >
                  {c}
                  {/* 起点手柄：选区第一个字左下方的小蓝点 */}
                  {isEdgeStart && (
                    <span
                      onPointerDown={(e) => onHandleDown(e, "start")}
                      style={{ touchAction: "none" }}
                      className="absolute -left-1 -bottom-0.5 w-3 h-3 rounded-full bg-cinnabar border border-paper shadow-md cursor-ew-resize z-10"
                    />
                  )}
                  {/* 末点手柄：选区最后字右下方的小蓝点 */}
                  {isEdgeEnd && (
                    <span
                      onPointerDown={(e) => onHandleDown(e, "end")}
                      style={{ touchAction: "none" }}
                      className="absolute -right-1 -bottom-0.5 w-3 h-3 rounded-full bg-cinnabar border border-paper shadow-md cursor-ew-resize z-10"
                    />
                  )}
                </span>
              );
            })}
          </div>
        </div>

        {/* 断墨候选词块 */}
        {isDuanmo && view.duanmoChoices.length > 0 && (
          <div className="mt-4">
            <p className="text-center text-gold/80 text-xs font-sub mb-2 tracking-wider">
              断墨 · 候选词块（恰一为玩家词）
            </p>
            <div className="flex flex-wrap gap-2 justify-center">
              {view.duanmoChoices.map((seg, idx) => {
                const text = view.storyText.slice(seg.start, seg.end);
                const sel = selChoice === idx;
                return (
                  <button
                    key={idx}
                    disabled={readOnly}
                    onClick={() => !readOnly && setSelChoice(sel ? null : idx)}
                    className={cn(
                      "px-3 py-1.5 rounded-sm border font-serifsc text-lg transition-colors",
                      sel
                        ? "border-cinnabar bg-cinnabar text-paper"
                        : "border-gold-soft/40 bg-ink-soft/40 text-paper active:bg-gold-soft/15",
                      readOnly && "opacity-50 cursor-default",
                    )}
                  >
                    {text}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {readOnly && !eliminated && (
          <div className="text-center text-paper/45 text-sm font-sub py-4 animate-inkfade">
            {view.phase === "reveal"
              ? "复盘公屏中 · 可切公屏查看众人所猜"
              : shuangLocked
                ? "双形态满命 · 失一命后方可猜词…"
                : "已提交 · 静候他人猜词…"}
          </div>
        )}
      </div>

      {/* 操作区 */}
      <div className="shrink-0 px-5 pt-2 pb-4 border-t border-gold-soft/20 bg-ink/40">
        {eliminated && view.myRole === "押司" ? (
          <BetPanel />
        ) : readOnly ? (
          <div className="text-center text-paper/40 text-xs font-sub py-2">
            可切至公屏查看系统消息
          </div>
        ) : isDuanmo ? (
          <div className="space-y-2">
            <button
              disabled={selChoice === null}
              onClick={doChoiceGuess}
              className="seal-btn w-full py-3 rounded-sm tracking-[0.3em]"
            >
              {selChoice !== null ? "猜 此 块" : "点选一候选词块"}
            </button>
            {selChoice !== null && (
              <button
                onClick={() => setSelChoice(null)}
                className="ghost-btn w-full py-2 rounded-sm text-sm"
              >
                清除
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {/* 省笔拭字按钮：随机拭去一字，玩家不选 */}
            {view.myRole === "省笔" && view.canPrune && (
              <button
                onClick={() => prune()}
                className="ghost-btn w-full py-2.5 rounded-sm tracking-[0.3em] text-sm"
              >
                拭 去 一 字
              </button>
            )}
            {/* 自杀：借命在场时可自猜己词，反噬借命或自裁 */}
            {view.canSuicide && (
              <button
                onClick={() => suicide()}
                className="w-full py-2.5 rounded-sm tracking-[0.3em] text-sm border border-cinnabar/60 bg-cinnabar/10 text-cinnabar-light active:bg-cinnabar/20"
              >
                自 裁（自猜己词）
              </button>
            )}
            {hasSel ? (
              <>
                <button
                  onClick={doGuess}
                  disabled={selLen < 2}
                  className="seal-btn w-full py-3 rounded-sm tracking-[0.3em]"
                >
                  {selLen >= 2
                    ? `猜此段 · ${selLen}字${view.myGuessesPerRound > 1 ? `（剩余${guessesLeft}猜）` : ""}`
                    : `拖动蓝点扩到2字（${selLen}/2）`}
                </button>
                <button onClick={clearSel} className="ghost-btn w-full py-2 rounded-sm text-sm">
                  清除选区
                </button>
              </>
            ) : (
              <p className="text-center text-paper/40 text-xs font-sub py-2 leading-relaxed">
                {view.myRole === "省笔"
                  ? view.canPrune
                    ? "可拭去一字 · 或长按故事选段猜词"
                    : "长按故事选段 · 拖两端蓝点调长度"
                  : view.blinded
                    ? "不知己词 · 长按选段猜词（慎防自猜）"
                    : view.myGuessesPerRound > 1
                      ? `本轮可猜 ${guessesLeft}/${view.myGuessesPerRound} · 长按故事选段`
                      : "长按故事选段 · 拖两端蓝点调长度"}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function BetPanel() {
  const view = useGame((s) => s.view)!;
  const bet = useGame((s) => s.bet);
  const alive = view.players.filter((p) => p.alive);
  const myBet = view.myBetOn ?? null;

  return (
    <div className="space-y-2">
      {/* 押司死后见词：展示所有玩家注入词（便于押注决策） */}
      {view.revealedWords && view.revealedWords.length > 0 && (
        <div className="mb-2 px-3 py-2 rounded-sm border border-jade/40 bg-jade/10">
          <p className="font-sub text-jade text-[11px] mb-1.5">押司 · 众人注入词（死后方知）：</p>
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {view.revealedWords.map((r) => {
              const isMe = r.ownerId === view.myId;
              return (
                <span key={r.ownerId} className="text-paper/80 text-[11px] font-sub">
                  {r.nickname}{isMe ? "(己)" : ""}：
                  <span className="text-cinnabar-light font-serifsc tracking-wider">{r.word}</span>
                </span>
              );
            })}
          </div>
        </div>
      )}
      <p className="text-center text-gold font-sub text-xs tracking-wider">
        押司 · 押注一存活者 · 存活+1 / 出局-1
      </p>
      <div className="grid grid-cols-2 gap-2">
        {alive.map((p) => (
          <button
            key={p.id}
            onClick={() => bet(p.id)}
            className={cn(
              "py-2.5 rounded-sm border font-sub text-sm transition-colors",
              myBet === p.id
                ? "border-cinnabar bg-cinnabar/20 text-paper"
                : "border-gold-soft/30 bg-ink-soft/50 text-paper active:bg-gold-soft/15",
            )}
          >
            {p.nickname}
            {myBet === p.id && <span className="text-[10px] text-cinnabar-light ml-1">已押</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

function StoryLoading() {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-4">
      <div className="w-14 h-14 rounded-full border-2 border-gold/40 border-t-gold animate-spin" />
      <p className="font-brush text-2xl text-gold">研 墨 成 文</p>
      <p className="text-paper/40 text-xs font-sub">故事织手正在编织叙事…</p>
    </div>
  );
}
