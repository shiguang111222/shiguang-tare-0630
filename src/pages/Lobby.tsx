import { useEffect, useState } from "react";
import { useGame } from "../store";
import { ALL_ROLES, ROLE_INFO } from "../../shared/types";

export default function Lobby() {
  const view = useGame((s) => s.view)!;
  const setProfile = useGame((s) => s.setProfile);
  const start = useGame((s) => s.start);

  const me = view.players.find((p) => p.id === view.myId)!;
  const [nick, setNick] = useState(me.nickname);
  const [copied, setCopied] = useState<null | "code" | "link">(null);

  useEffect(() => {
    setNick(me.nickname);
  }, [me.nickname]);

  const sendProfile = (role: typeof me.role) => {
    setProfile({ nickname: nick.trim() || me.nickname, role: role! });
  };

  const onNickBlur = () => {
    if (nick.trim() && nick.trim() !== me.nickname) {
      setProfile({ nickname: nick.trim(), role: me.role ?? ALL_ROLES[0] });
    }
  };

  const copyCode = () => {
    navigator.clipboard?.writeText(view.roomCode).then(() => {
      setCopied("code");
      setTimeout(() => setCopied(null), 1500);
    });
  };

  const copyLink = () => {
    const url = `${window.location.origin}${window.location.pathname}?room=${view.roomCode}`;
    navigator.clipboard?.writeText(url).then(() => {
      setCopied("link");
      setTimeout(() => setCopied(null), 1500);
    });
  };

  const allReady = view.players.length >= 2 && view.players.every((p) => p.role);

  return (
    <div className="px-5 py-5 space-y-5">
      {/* 房号 */}
      <div className="flex flex-col items-center">
        <p className="text-paper/40 text-xs font-sub tracking-widest">房号 · 告予同游者</p>
        <button
          onClick={copyCode}
          className="mt-1 flex items-center gap-2 group"
        >
          <span className="font-brush text-6xl text-gold tracking-[0.25em]">
            {view.roomCode}
          </span>
        </button>
        <span className="text-paper/40 text-[11px] font-sub h-4">
          {copied === "code" ? "房号已抄录" : "点房号抄录"}
        </span>
        <button
          onClick={copyLink}
          className="mt-2 px-3 py-1.5 rounded-sm border border-gold-soft/40 text-gold/80 text-xs font-sub tracking-wider active:bg-gold-soft/15"
        >
          {copied === "link" ? "邀请链接已抄录" : "复制邀请链接"}
        </button>
      </div>

      <div className="ink-rule" />

      {/* 玩家列表 */}
      <div>
        <div className="flex items-baseline justify-between mb-2 px-1">
          <span className="font-sub text-paper/60 text-sm tracking-wider">同匣之人</span>
          <span className="text-paper/40 text-xs font-sub">
            {view.players.length}/8 · {view.totalRounds}局 · {view.difficulty} · {view.waitTime}s
          </span>
        </div>
        <div className="space-y-1.5">
          {view.players.map((p) => (
            <div
              key={p.id}
              className={`flex items-center justify-between px-3 py-2 rounded-sm border ${
                p.id === view.myId
                  ? "border-gold/50 bg-gold-soft/10"
                  : "border-gold-soft/20 bg-ink-soft/40"
              }`}
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-sub text-paper truncate">{p.nickname}</span>
                {p.isHost && (
                  <span className="seal-stamp text-[9px] px-1 py-0.5 leading-none">主</span>
                )}
                {p.id === view.myId && (
                  <span className="text-gold/70 text-[10px] font-sub">你</span>
                )}
              </div>
              <span
                className={`text-xs font-sub shrink-0 ${
                  p.role ? "text-cinnabar-light" : "text-paper/30"
                }`}
              >
                {p.role ?? "未定"}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="ink-rule" />

      {/* 自署名 */}
      <div>
        <label className="block text-paper/50 text-xs font-sub mb-1.5 px-1">署名</label>
        <input
          value={nick}
          onChange={(e) => setNick(e.target.value.slice(0, 12))}
          onBlur={onNickBlur}
          placeholder="请署名"
          className="w-full bg-ink-soft/70 border border-gold-soft/30 text-paper font-sub tracking-wider px-3 py-2.5 rounded-sm outline-none focus:border-cinnabar/60 text-center"
        />
      </div>

      {/* 角色选择 */}
      <div>
        <label className="block text-paper/50 text-xs font-sub mb-1.5 px-1">择一司职</label>
        <div className="grid grid-cols-1 gap-2">
          {ALL_ROLES.map((r) => {
            const disabled = view.disabledRoles.includes(r);
            const selected = me.role === r;
            return (
              <button
                key={r}
                disabled={disabled}
                onClick={() => sendProfile(r)}
                className={`text-left px-3 py-2.5 rounded-sm border transition-colors ${
                  selected
                    ? "border-cinnabar bg-cinnabar/15"
                    : disabled
                      ? "border-ink-mist/40 bg-ink-soft/30 opacity-40"
                      : "border-gold-soft/30 bg-ink-soft/50 active:bg-gold-soft/10"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-brush text-xl text-gold">{r}</span>
                  <span className="text-[10px] text-paper/40 font-sub">{ROLE_INFO[r].name}</span>
                </div>
                <p className="text-[11px] text-paper/55 mt-1 leading-relaxed">
                  {ROLE_INFO[r].skill}
                </p>
              </button>
            );
          })}
        </div>
      </div>

      {/* 开始 / 离开 */}
      {view.isHost ? (
        <button
          disabled={!allReady}
          onClick={start}
          className="seal-btn w-full py-3.5 rounded-sm text-lg tracking-[0.4em]"
        >
          {allReady ? "开 启 词 匣" : "待 众 人 择 职"}
        </button>
      ) : (
        <div className="text-center text-paper/40 text-sm font-sub py-2">
          静候房主开启词匣…
        </div>
      )}

    </div>
  );
}
