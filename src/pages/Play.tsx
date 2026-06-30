import { useEffect, useMemo, useState } from "react";
import { useGame } from "../store";
import { ROLE_INFO } from "../../shared/types";
import { cn } from "@/lib/utils";

export default function Play() {
  const view = useGame((s) => s.view)!;
  const submitGuess = useGame((s) => s.submitGuess);
  const submitChoice = useGame((s) => s.submitChoice);
  const prune = useGame((s) => s.prune);

  const me = view.players.find((p) => p.id === view.myId)!;
  const isDuanmo = view.myRole === "断墨";
  const [anchor, setAnchor] = useState<number | null>(null);
  const [head, setHead] = useState<number | null>(null);
  const [selChoice, setSelChoice] = useState<number | null>(null);

  // 子轮切换或已提交时清空选择
  useEffect(() => {
    setAnchor(null);
    setHead(null);
    setSelChoice(null);
  }, [view.subRound, view.myDone]);

  const ownRanges = useMemo(
    () => view.segments.filter((s) => s.ownerId === view.myId),
    [view.segments, view.myId],
  );

  const prunedSet = useMemo(() => new Set(view.pruned), [view.pruned]);
  const isOwn = (i: number) => ownRanges.some((r) => i >= r.start && i < r.end);

  if (view.storyLoading) return <StoryLoading />;

  const eliminated = !me.alive;
  const readOnly = view.myDone || eliminated;

  const range =
    anchor !== null && head !== null
      ? { a: Math.min(anchor, head), b: Math.max(anchor, head) }
      : null;

  const onCharTap = (i: number) => {
    if (readOnly || isDuanmo) return;
    if (anchor === null) {
      setAnchor(i);
      setHead(null);
    } else if (head === null) {
      if (i === anchor) {
        setAnchor(null);
      } else {
        setHead(i);
      }
    } else {
      setAnchor(i);
      setHead(null);
    }
  };

  const clearSel = () => {
    setAnchor(null);
    setHead(null);
  };

  const doGuess = () => {
    if (!range) return;
    submitGuess(range.a, range.b + 1);
    clearSel();
  };

  const doChoiceGuess = () => {
    if (selChoice === null) return;
    submitChoice(selChoice);
    setSelChoice(null);
  };

  const selLen = range ? range.b - range.a + 1 : 0;

  return (
    <div className="h-full flex flex-col">
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

      {/* 窥简词长面板 */}
      {view.myRole === "窥简" && view.segmentHints.length > 0 && (
        <div className="shrink-0 mx-5 mb-2 px-3 py-2 rounded-sm border border-jade/40 bg-jade/10">
          <span className="font-sub text-jade text-[11px]">窥简 · 他人词长：</span>
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

      {/* 量画笔画面板：各玩家注入词笔画总数 */}
      {view.myRole === "量画" && view.strokeHints.length > 0 && (
        <div className="shrink-0 mx-5 mb-2 px-3 py-2 rounded-sm border border-jade/40 bg-jade/10">
          <span className="font-sub text-jade text-[11px]">量画 · 众人词笔画：</span>
          {view.strokeHints.map((h) => {
            const nick = view.players.find((p) => p.id === h.ownerId)?.nickname ?? "?";
            const isMe = h.ownerId === view.myId;
            return (
              <span key={h.ownerId} className="text-paper/70 text-[11px] font-sub ml-1.5">
                {nick}{isMe ? "(己)" : ""}{h.strokes}画
              </span>
            );
          })}
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
              const isSel = range ? i >= range.a && i <= range.b : false;
              return (
                <span
                  key={i}
                  onClick={() => onCharTap(i)}
                  className={cn(
                    "transition-colors",
                    !readOnly && !isDuanmo && "cursor-pointer",
                    own && !isSel && "border-b-2 border-gold/70",
                    pr && "line-through opacity-25",
                    isSel && "bg-cinnabar text-paper rounded-sm px-0.5",
                  )}
                >
                  {c}
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
            已提交 · 静候他人猜词…
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
            {range ? (
              <>
                <button
                  onClick={doGuess}
                  className="seal-btn w-full py-3 rounded-sm tracking-[0.3em]"
                >
                  猜此段 · {selLen}字
                </button>
                <button onClick={clearSel} className="ghost-btn w-full py-2 rounded-sm text-sm">
                  清除
                </button>
              </>
            ) : (
              <p className="text-center text-paper/40 text-xs font-sub py-2">
                {view.myRole === "省笔"
                  ? view.canPrune
                    ? "可拭去一字 · 或点首末字成段猜词"
                    : "点首字与末字 · 择段猜词"
                  : "点首字与末字 · 择段猜词"}
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
