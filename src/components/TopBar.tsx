import { useEffect, useState } from "react";
import { useGame } from "../store";
import { cn } from "@/lib/utils";

const PHASE_LABEL: Record<string, string> = {
  lobby: "待开",
  words: "封匣",
  play: "猜词",
  result: "结算",
};

export default function TopBar() {
  const view = useGame((s) => s.view)!;
  const tab = useGame((s) => s.tab);
  const setTab = useGame((s) => s.setTab);
  const secondsLeft = useGame((s) => s.secondsLeft);
  const leaveRoom = useGame((s) => s.leaveRoom);
  const [confirmExit, setConfirmExit] = useState(false);

  const lastId = view.chat.length ? view.chat[view.chat.length - 1].id : null;
  const [seenId, setSeenId] = useState<string | null>(lastId);
  useEffect(() => {
    if (tab === "chat") setSeenId(lastId);
  }, [tab, lastId]);
  const unread = tab === "game" && lastId !== null && lastId !== seenId;

  const phaseLabel = PHASE_LABEL[view.phase] || "";
  const roundLabel =
    view.phase === "play"
      ? `第${view.currentRound}/${view.totalRounds}局 · 第${view.subRound}轮`
      : `第${view.currentRound}/${view.totalRounds}局 · ${phaseLabel}`;

  const showTimer = (view.phase === "words" || view.phase === "play") && secondsLeft > 0;
  const urgent = secondsLeft > 0 && secondsLeft <= 5;

  return (
    <header className="shrink-0 px-3 pt-3 pb-2 flex items-center justify-between gap-2 border-b border-gold-soft/25">
      <div className="leading-tight min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-sub text-gold text-[13px] tracking-wider truncate">
            匣 {view.roomCode}
          </span>
          {showTimer && (
            <span
              className={cn(
                "font-sub text-[11px] px-1.5 py-0.5 rounded-full border tabular-nums",
                urgent
                  ? "border-cinnabar text-cinnabar-light animate-shimmer"
                  : "border-gold-soft/40 text-gold/80",
              )}
            >
              {secondsLeft}s
            </span>
          )}
        </div>
        <div className="text-paper/45 text-[11px] truncate">{roundLabel}</div>
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        {/* 退出 / 离匣 */}
        {confirmExit ? (
          <div className="flex items-center gap-1">
            <button
              onClick={() => {
                setConfirmExit(false);
                leaveRoom();
              }}
              className="px-2 py-1 rounded-sm bg-cinnabar/80 text-paper text-[11px] font-sub"
            >
              确认
            </button>
            <button
              onClick={() => setConfirmExit(false)}
              className="px-2 py-1 rounded-sm border border-gold-soft/30 text-paper/60 text-[11px] font-sub"
            >
              取消
            </button>
          </div>
        ) : (
          <button
            onClick={() => setConfirmExit(true)}
            className="px-2 py-1 rounded-sm border border-cinnabar/40 text-cinnabar-light/70 text-[11px] font-sub active:bg-cinnabar/10"
          >
            {view.phase === "lobby" ? "离匣" : "退出"}
          </button>
        )}

        <div className="flex bg-ink-soft/80 rounded-full p-0.5 border border-gold-soft/25">
          <button
            onClick={() => setTab("game")}
            className={`px-3 py-1 rounded-full text-[13px] font-sub tracking-wider transition-colors ${
              tab === "game" ? "bg-cinnabar text-paper" : "text-paper/55"
            }`}
          >
            游戏
          </button>
          <button
            onClick={() => setTab("chat")}
            className={`relative px-3 py-1 rounded-full text-[13px] font-sub tracking-wider transition-colors ${
              tab === "chat" ? "bg-cinnabar text-paper" : "text-paper/55"
            }`}
          >
            公屏
            {unread && (
              <span className="absolute top-0.5 right-1.5 w-1.5 h-1.5 rounded-full bg-gold animate-shimmer" />
            )}
          </button>
        </div>
      </div>
    </header>
  );
}
