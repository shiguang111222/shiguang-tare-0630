import { useEffect, useState } from "react";
import { useGame } from "../store";
import { ALL_ROLES, ROLE_INFO, ALL_DIFFICULTIES, DIFFICULTY_INFO, WAIT_TIMES, type Role, type Difficulty } from "../../shared/types";
import { InkInput } from "../components/ui";
import { cn } from "@/lib/utils";

export default function Home() {
  const createRoom = useGame((s) => s.createRoom);
  const joinRoom = useGame((s) => s.joinRoom);
  const [mode, setMode] = useState<"create" | "join">("create");
  const [nick, setNick] = useState("");
  const [rounds, setRounds] = useState(3);
  const [disabled, setDisabled] = useState<Role[]>([]);
  const [difficulty, setDifficulty] = useState<Difficulty>("简单");
  const [waitTime, setWaitTime] = useState<number>(30);
  const [code, setCode] = useState("");

  // 从 URL 读取房号（分享链接场景）：?room=ABCD
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const room = params.get("room");
    if (room) {
      const cleaned = room.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4);
      if (cleaned) {
        setMode("join");
        setCode(cleaned);
      }
    }
  }, []);

  const toggleRole = (r: Role) =>
    setDisabled((d) => (d.includes(r) ? d.filter((x) => x !== r) : [...d, r]));

  const canCreate = nick.trim().length >= 1;
  const canJoin = nick.trim().length >= 1 && code.trim().length === 4;

  return (
    <div className="mx-auto w-full max-w-[440px] min-h-full flex flex-col surface-ink">
      <div className="flex-1 flex flex-col px-6 pt-14 pb-8">
        {/* 标题 */}
        <div className="flex flex-col items-center animate-inkfade">
          <div className="flex items-end gap-3">
            <h1 className="font-brush text-8xl text-gold leading-none drop-shadow-[0_2px_12px_rgba(201,162,75,0.25)]">
              词匣
            </h1>
            <span className="seal-stamp text-base px-1.5 py-1 mb-2 animate-sealstamp">封</span>
          </div>
          <p className="font-sub text-paper/60 mt-3 tracking-[0.3em] text-sm">一段叙事 · 藏众人之词</p>
          <p className="font-sub text-paper/35 text-xs tracking-[0.3em]">一匣之秘 · 待君来揭</p>
        </div>

        {/* 模式切换 */}
        <div className="mt-10 flex bg-ink-soft/70 rounded-full p-1 border border-gold-soft/25">
          <button
            onClick={() => setMode("create")}
            className={`flex-1 py-2 rounded-full font-sub tracking-widest text-sm transition-colors ${
              mode === "create" ? "bg-cinnabar text-paper" : "text-paper/55"
            }`}
          >
            开房
          </button>
          <button
            onClick={() => setMode("join")}
            className={`flex-1 py-2 rounded-full font-sub tracking-widest text-sm transition-colors ${
              mode === "join" ? "bg-cinnabar text-paper" : "text-paper/55"
            }`}
          >
            入房
          </button>
        </div>

        {/* 表单 */}
        <div className="mt-6 space-y-4">
          {mode === "create" ? (
            <>
              <div>
                <label className="block text-paper/50 text-xs font-sub mb-1.5 px-1">署名</label>
                <InkInput
                  value={nick}
                  onChange={(e) => setNick(e.target.value.slice(0, 12))}
                  placeholder="请署名"
                />
              </div>

              <div>
                <label className="block text-paper/50 text-xs font-sub mb-1.5 px-1">局数</label>
                <div className="flex items-center justify-center gap-6">
                  <button
                    onClick={() => setRounds((r) => Math.max(1, r - 1))}
                    className="w-10 h-10 rounded-full border border-gold-soft/40 text-gold text-xl font-sub active:bg-gold-soft/20"
                  >
                    −
                  </button>
                  <span className="font-brush text-5xl text-gold w-12 text-center">{rounds}</span>
                  <button
                    onClick={() => setRounds((r) => Math.min(5, r + 1))}
                    className="w-10 h-10 rounded-full border border-gold-soft/40 text-gold text-xl font-sub active:bg-gold-soft/20"
                  >
                    +
                  </button>
                </div>
              </div>

              {/* 难度 */}
              <div>
                <label className="block text-paper/50 text-xs font-sub mb-1.5 px-1">
                  难度 <span className="text-paper/30">（叙事字数）</span>
                </label>
                <div className="grid grid-cols-4 gap-1.5">
                  {ALL_DIFFICULTIES.map((d) => {
                    const sel = difficulty === d;
                    return (
                      <button
                        key={d}
                        onClick={() => setDifficulty(d)}
                        className={cn(
                          "py-2 rounded-sm border font-sub text-sm transition-colors",
                          sel
                            ? "border-cinnabar bg-cinnabar/20 text-paper"
                            : "border-gold-soft/30 bg-ink-soft/50 text-paper/60 active:bg-gold-soft/10",
                        )}
                      >
                        {d}
                      </button>
                    );
                  })}
                </div>
                <p className="text-[10px] text-paper/35 font-sub mt-1 px-0.5">
                  {DIFFICULTY_INFO[difficulty].desc} 字
                </p>
              </div>

              {/* 等待时间 */}
              <div>
                <label className="block text-paper/50 text-xs font-sub mb-1.5 px-1">
                  等待时间 <span className="text-paper/30">（超时淘汰）</span>
                </label>
                <div className="grid grid-cols-3 gap-1.5">
                  {WAIT_TIMES.map((t) => {
                    const sel = waitTime === t;
                    return (
                      <button
                        key={t}
                        onClick={() => setWaitTime(t)}
                        className={cn(
                          "py-2 rounded-sm border font-sub text-sm transition-colors",
                          sel
                            ? "border-cinnabar bg-cinnabar/20 text-paper"
                            : "border-gold-soft/30 bg-ink-soft/50 text-paper/60 active:bg-gold-soft/10",
                        )}
                      >
                        {t}s
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="block text-paper/50 text-xs font-sub mb-1.5 px-1">
                  禁用角色 <span className="text-paper/30">（可选，禁后全员不可选）</span>
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {ALL_ROLES.map((r) => {
                    const off = disabled.includes(r);
                    return (
                      <button
                        key={r}
                        onClick={() => toggleRole(r)}
                        className={`text-left px-3 py-2 rounded-sm border transition-colors ${
                          off
                            ? "border-cinnabar/40 bg-cinnabar/10 text-paper/40 line-through"
                            : "border-gold-soft/30 bg-ink-soft/50 text-paper"
                        }`}
                      >
                        <div className="font-sub text-sm">{r}</div>
                        <div className="text-[10px] text-paper/40 leading-tight mt-0.5">
                          {ROLE_INFO[r].skill}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <button
                disabled={!canCreate}
                onClick={() =>
                  createRoom(
                    { nickname: nick.trim(), totalRounds: rounds, disabledRoles: disabled, difficulty, waitTime },
                    () => {},
                  )
                }
                className="seal-btn w-full py-3 rounded-sm text-lg tracking-[0.4em] mt-2"
              >
                封 匣 开 局
              </button>
            </>
          ) : (
            <>
              <div>
                <label className="block text-paper/50 text-xs font-sub mb-1.5 px-1">房号</label>
                <InkInput
                  value={code}
                  onChange={(e) =>
                    setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4))
                  }
                  placeholder="四字房号"
                  className="text-3xl tracking-[0.5em] font-brush"
                  inputMode="text"
                  autoCapitalize="characters"
                />
              </div>
              <div>
                <label className="block text-paper/50 text-xs font-sub mb-1.5 px-1">署名</label>
                <InkInput
                  value={nick}
                  onChange={(e) => setNick(e.target.value.slice(0, 12))}
                  placeholder="请署名"
                />
              </div>
              <button
                disabled={!canJoin}
                onClick={() => joinRoom({ roomCode: code, nickname: nick.trim() }, () => {})}
                className="seal-btn w-full py-3 rounded-sm text-lg tracking-[0.4em] mt-2"
              >
                入 匣 同 游
              </button>
            </>
          )}
        </div>

        <p className="mt-auto pt-8 text-center text-paper/25 text-[11px] font-sub leading-relaxed">
          二至八人 · 各持一词藏于叙事<br />
          猜中他人之词即令其出局
        </p>
      </div>
    </div>
  );
}
