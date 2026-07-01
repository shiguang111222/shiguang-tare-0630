import { useEffect, useRef } from "react";
import { useGame } from "../store";
import { playVoice } from "@/lib/sound";

export default function Result() {
  const view = useGame((s) => s.view)!;
  const nextRound = useGame((s) => s.nextRound);
  const leaveRoom = useGame((s) => s.leaveRoom);

  const isFinal = !!view.finalRanking;
  const ranking = isFinal
    ? view.finalRanking!
    : [...view.players].sort((a, b) => b.score - a.score);
  const eliminatedSet = new Set(view.eliminationOrder);

  // 赢家判定：终局看总榜第一；单局结算看是否存活（最后存活者为本局赢家）
  const me = view.players.find((p) => p.id === view.myId);
  const iWin = isFinal
    ? view.finalRanking![0]?.playerId === view.myId
    : !!me?.alive;

  // 进入结算时，赢家播胜利语音（防 StrictMode 双调用）
  const playedRef = useRef(false);
  useEffect(() => {
    if (playedRef.current) return;
    playedRef.current = true;
    if (iWin) playVoice("05_victory");
  }, [iWin]);

  return (
    <div className="px-5 py-6 min-h-full flex flex-col">
      <div className="text-center">
        <p className="text-paper/40 text-xs font-sub tracking-widest">
          {isFinal ? "终局" : `第 ${view.currentRound} 局 · 结算`}
        </p>
        <h2 className="font-brush text-4xl text-gold mt-1">
          {isFinal ? "词 匣 终 录" : "揭 匣 见 词"}
        </h2>
      </div>

      {/* 本局揭示词 */}
      {!isFinal && view.revealedWords && view.revealedWords.length > 0 && (
        <div className="mt-6">
          <p className="text-paper/50 text-xs font-sub mb-2 px-1">本局众人之词</p>
          <div className="grid grid-cols-2 gap-2">
            {view.revealedWords.map((w) => {
              const out = eliminatedSet.has(w.ownerId);
              return (
                <div
                  key={w.ownerId}
                  className={`px-3 py-2 rounded-sm border text-center ${
                    out
                      ? "border-cinnabar/40 bg-cinnabar/10"
                      : "border-gold-soft/30 bg-ink-soft/40"
                  }`}
                >
                  <div className="font-brush text-2xl text-paper">{w.word}</div>
                  <div className="text-[10px] text-paper/45 font-sub mt-0.5">
                    {w.nickname}
                    {out && <span className="text-cinnabar-light"> · 出局</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 排名 */}
      <div className="mt-6">
        <p className="text-paper/50 text-xs font-sub mb-2 px-1">
          {isFinal ? "终录榜" : "当前积分"}
        </p>
        <div className="space-y-1.5">
          {ranking.map((p, i) => {
            const isMe = p.playerId === view.myId || p.id === view.myId;
            const pid = isFinal ? p.playerId : p.id;
            const name = isFinal ? p.nickname : view.players.find((x) => x.id === pid)?.nickname ?? "?";
            const score = isFinal ? p.score : view.players.find((x) => x.id === pid)?.score ?? 0;
            const role = isFinal ? p.role : view.players.find((x) => x.id === pid)?.role ?? null;
            return (
              <div
                key={pid}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-sm border ${
                  i === 0
                    ? "border-gold/60 bg-gold-soft/15"
                    : isMe
                      ? "border-gold/40 bg-gold-soft/5"
                      : "border-gold-soft/20 bg-ink-soft/40"
                }`}
              >
                <span
                  className={`font-brush text-xl w-7 text-center ${
                    i === 0 ? "text-gold" : "text-paper/50"
                  }`}
                >
                  {i === 0 ? "魁" : i + 1}
                </span>
                <span className="font-sub text-paper flex-1 truncate">{name}</span>
                {role && <span className="text-[11px] text-cinnabar-light font-sub">{role}</span>}
                <span className="font-brush text-2xl text-gold w-10 text-right">{score}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* 操作 */}
      <div className="mt-auto pt-6 space-y-2">
        {isFinal ? (
          <button
            onClick={leaveRoom}
            className="seal-btn w-full py-3.5 rounded-sm text-lg tracking-[0.4em]"
          >
            再 启 新 局
          </button>
        ) : view.isHost ? (
          <button
            onClick={nextRound}
            className="seal-btn w-full py-3.5 rounded-sm text-lg tracking-[0.4em]"
          >
            开 启 下 一 局
          </button>
        ) : (
          <div className="text-center text-paper/45 text-sm font-sub py-2">
            静候房主开启下一局…
          </div>
        )}
      </div>
    </div>
  );
}
