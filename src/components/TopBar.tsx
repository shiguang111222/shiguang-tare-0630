import { useEffect, useState } from "react";
import { useGame } from "../store";
import { cn } from "@/lib/utils";
import { playSound, isMuted, toggleMuted, VOICE_CHARS, previewVoice } from "@/lib/sound";
import { Volume2, VolumeX, Music } from "lucide-react";

const PHASE_LABEL: Record<string, string> = {
  lobby: "待开",
  words: "封匣",
  play: "猜词",
  reveal: "复盘",
  result: "结算",
};

export default function TopBar() {
  const view = useGame((s) => s.view)!;
  const tab = useGame((s) => s.tab);
  const setTab = useGame((s) => s.setTab);
  const secondsLeft = useGame((s) => s.secondsLeft);
  const leaveRoom = useGame((s) => s.leaveRoom);
  const voiceChar = useGame((s) => s.voiceChar);
  const setVoiceChar = useGame((s) => s.setVoiceChar);
  const [confirmExit, setConfirmExit] = useState(false);
  const [muted, setMutedState] = useState(isMuted());
  const [showVoice, setShowVoice] = useState(false);

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

  const showTimer = (view.phase === "words" || view.phase === "play" || view.phase === "reveal") && secondsLeft > 0;
  const urgent = secondsLeft > 0 && secondsLeft <= 5;
  const isReveal = view.phase === "reveal";

  // 倒计时进度条：复盘按 10s 归一化，其余按 waitTime
  const denom = isReveal ? 10 : view.waitTime;
  const pct = denom > 0 ? Math.max(0, Math.min(100, (secondsLeft / denom) * 100)) : 0;

  // 最后 5 秒每秒一声滴答
  useEffect(() => {
    if (showTimer && secondsLeft > 0 && secondsLeft <= 5) {
      playSound("tick");
    }
  }, [secondsLeft, showTimer]);

  const onToggleMute = () => {
    const m = toggleMuted();
    setMutedState(m);
    if (!m) playSound("submit");
  };

  // 音色面板展开时点击外部关闭
  useEffect(() => {
    if (!showVoice) return;
    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest("[data-voice-panel]")) setShowVoice(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [showVoice]);

  return (
    <header className="relative shrink-0 px-3 pt-3 pb-2 flex items-center justify-between gap-2 border-b border-gold-soft/25">
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
              {isReveal ? `复盘 ${secondsLeft}s` : `${secondsLeft}s`}
            </span>
          )}
        </div>
        <div className="text-paper/45 text-[11px] truncate">{roundLabel}</div>
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        {/* 音效开关 */}
        <button
          onClick={onToggleMute}
          className="p-1.5 rounded-sm border border-gold-soft/30 text-gold/70 active:bg-gold-soft/15"
          title={muted ? "开启音效" : "静音"}
        >
          {muted ? <VolumeX size={15} /> : <Volume2 size={15} />}
        </button>

        {/* 音色切换 */}
        <div className="relative" data-voice-panel>
          <button
            onClick={() => setShowVoice((v) => !v)}
            className={cn(
              "p-1.5 rounded-sm border text-gold/70 active:bg-gold-soft/15 flex items-center gap-1",
              showVoice ? "border-cinnabar/60 text-cinnabar-light" : "border-gold-soft/30",
            )}
            title="切换音色"
          >
            <Music size={15} />
          </button>
          {showVoice && (
            <div className="absolute right-0 top-full mt-1.5 z-50 w-48 rounded-sm border border-gold-soft/40 bg-ink-deep/95 backdrop-blur p-2 space-y-1 shadow-xl">
              <p className="text-paper/45 text-[10px] font-sub px-1 pb-1">择一音色 · 点击试听</p>
              {VOICE_CHARS.map((v) => {
                const selected = voiceChar === v.id;
                return (
                  <button
                    key={v.id}
                    onClick={() => {
                      setVoiceChar(v.id);
                      previewVoice(v.id);
                    }}
                    className={cn(
                      "w-full text-left px-2.5 py-2 rounded-sm border transition-colors",
                      selected
                        ? "border-cinnabar bg-cinnabar/15"
                        : "border-gold-soft/20 bg-ink-soft/50 active:bg-gold-soft/10",
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-brush text-base text-gold">{v.name}</span>
                      {selected && (
                        <span className="text-[9px] text-cinnabar-light font-sub">已选</span>
                      )}
                    </div>
                    <p className="text-[9px] text-paper/45 mt-0.5 leading-relaxed">{v.desc}</p>
                  </button>
                );
              })}
              <button
                onClick={() => setShowVoice(false)}
                className="w-full text-center text-paper/40 text-[10px] font-sub py-1 mt-0.5"
              >
                收起
              </button>
            </div>
          )}
        </div>

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

      {/* 倒计时进度条：最后 5 秒转朱砂红 */}
      {showTimer && (
        <div className="absolute left-0 right-0 bottom-0 h-[3px] bg-ink-soft/60 overflow-hidden">
          <div
            className={cn(
              "h-full transition-all duration-500 ease-linear",
              urgent ? "bg-cinnabar" : "bg-gradient-to-r from-cinnabar to-gold",
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </header>
  );
}
