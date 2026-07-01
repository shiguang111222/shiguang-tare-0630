import { useEffect, useRef } from "react";
import { useGame } from "../store";
import { cn } from "@/lib/utils";

const EMOJIS = ["🤔", "😏", "😆", "😱", "🥸", "🎭", "✍️", "🍵"];

export default function Chat() {
  const view = useGame((s) => s.view)!;
  const secondsLeft = useGame((s) => s.secondsLeft);
  const sendEmoji = useGame((s) => s.sendEmoji);
  const me = view.myId;
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [view.chat.length]);

  const isReveal = view.phase === "reveal";

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="px-4 pt-3 pb-2 flex items-center gap-2">
        <span className="font-brush text-2xl text-gold">公屏</span>
        <span className="text-paper/40 text-xs font-sub">系统消息与表情</span>
      </div>
      <div className="ink-rule mx-4" />

      {/* 复盘公屏倒计时条幅 */}
      {isReveal && secondsLeft > 0 && (
        <div
          className={cn(
            "mx-4 mt-2 px-3 py-2 rounded-sm border text-center",
            secondsLeft <= 3
              ? "border-cinnabar bg-cinnabar/15 animate-shimmer"
              : "border-gold-soft/40 bg-gold-soft/10",
          )}
        >
          <span className="font-brush text-lg text-gold">复 盘 中</span>
          <span className="text-paper/55 text-xs font-sub ml-2">
            · {secondsLeft}s 后进入第 {view.subRound + 1} 轮猜词
          </span>
        </div>
      )}

      <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto no-scrollbar px-4 py-3 space-y-2.5">
        {view.chat.length === 0 && (
          <div className="text-center text-paper/30 text-sm font-sub py-10">
            尚无声息，且静候之。
          </div>
        )}
        {view.chat.map((m) => {
          if (m.type === "system") {
            return (
              <div key={m.id} className="flex flex-col items-center py-1">
                <div className="text-paper/55 text-[12px] font-sub tracking-wide text-center leading-relaxed px-3">
                  {m.text}
                </div>
                <div className="ink-rule w-16 mt-1 opacity-50" />
              </div>
            );
          }
          const mine = m.playerId === me;
          return (
            <div
              key={m.id}
              className={`flex items-end gap-1.5 ${mine ? "flex-row-reverse" : ""}`}
            >
              <span className="text-2xl leading-none">{m.emoji}</span>
              <span
                className={`text-[10px] font-sub px-1.5 py-0.5 rounded-sm ${
                  mine ? "bg-gold-soft/30 text-gold-pale" : "bg-ink-soft text-paper/50"
                }`}
              >
                {m.nickname}
              </span>
            </div>
          );
        })}
      </div>

      <div className="shrink-0 px-3 pt-2 pb-3 border-t border-gold-soft/20 bg-ink/60">
        <div className="grid grid-cols-8 gap-1.5">
          {EMOJIS.map((e) => (
            <button
              key={e}
              onClick={() => sendEmoji(e)}
              className="aspect-square flex items-center justify-center text-2xl rounded-sm bg-ink-soft/60 active:bg-gold-soft/20 transition-colors"
            >
              {e}
            </button>
          ))}
        </div>
        <p className="text-center text-paper/30 text-[10px] font-sub mt-1.5">
          表情冷却三息，以防刷屏
        </p>
      </div>
    </div>
  );
}
