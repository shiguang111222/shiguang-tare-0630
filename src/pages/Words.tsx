import { useState } from "react";
import { useGame } from "../store";
import { ROLE_INFO, ALL_THEMES, type Theme } from "../../shared/types";
import { cn } from "@/lib/utils";

export default function Words() {
  const view = useGame((s) => s.view)!;
  const submitWord = useGame((s) => s.submitWord);
  const setTheme = useGame((s) => s.setTheme);
  const [word, setWord] = useState("");

  const me = view.players.find((p) => p.id === view.myId)!;
  const submitted = me.wordSubmitted;
  const valid = Array.from(word).length >= 2 && Array.from(word).length <= 4 && /^[\u4e00-\u9fff]+$/.test(word);
  const isLiyi = view.myRole === "立意";
  const themePicked = view.myTheme ?? null;

  const onChange = (v: string) => {
    const filtered = Array.from(v).filter((c) => /[\u4e00-\u9fff]/.test(c)).slice(0, 4).join("");
    setWord(filtered);
  };

  const submit = () => {
    if (!valid) return;
    submitWord(word);
  };

  const pickTheme = (t: Theme) => {
    setTheme(t);
  };

  const roleInfo = view.myRole ? ROLE_INFO[view.myRole] : null;

  return (
    <div className="px-5 py-6 flex flex-col min-h-full">
      <div className="text-center">
        <p className="text-paper/40 text-xs font-sub tracking-widest">
          第 {view.currentRound} 局 · 封匣入词
        </p>
        <h2 className="font-brush text-4xl text-gold mt-1">藏 一 词 入 匣</h2>
        <p className="text-paper/45 text-xs font-sub mt-1">二至四字 · 将由故事织手编入叙事</p>
      </div>

      {roleInfo && (
        <div className="mt-5 px-3 py-2.5 rounded-sm border border-gold-soft/25 bg-ink-soft/40">
          <div className="flex items-center gap-2">
            <span className="font-brush text-lg text-gold">{view.myRole}</span>
            <span className="text-[10px] text-paper/40 font-sub">{roleInfo.name}</span>
          </div>
          <p className="text-[11px] text-paper/55 mt-1 leading-relaxed">{roleInfo.skill}</p>
        </div>
      )}

      {/* 立意 · 择题面板 */}
      {isLiyi && (
        <div className="mt-4 px-3 py-3 rounded-sm border border-cinnabar/40 bg-cinnabar/10">
          <div className="flex items-center justify-between mb-2">
            <span className="font-brush text-lg text-cinnabar-light">立意 · 择一主题</span>
            <span className="text-[10px] text-paper/50 font-sub">仅你知晓</span>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {ALL_THEMES.map((t) => {
              const sel = themePicked === t;
              return (
                <button
                  key={t}
                  onClick={() => pickTheme(t)}
                  className={cn(
                    "py-1.5 rounded-sm border font-sub text-sm transition-colors",
                    sel
                      ? "border-cinnabar bg-cinnabar text-paper"
                      : "border-gold-soft/30 bg-ink-soft/50 text-paper active:bg-gold-soft/15",
                  )}
                >
                  {t}
                </button>
              );
            })}
          </div>
          <p className="text-[10px] text-paper/45 font-sub mt-2 leading-relaxed">
            {themePicked ? `已择「${themePicked}」为主题，叙事将循此成文。` : "未择则全员封匣后随机定之。"}
          </p>
        </div>
      )}

      <div className="flex-1 flex flex-col justify-center py-6">
        {!submitted ? (
          <>
            <input
              value={word}
              onChange={(e) => onChange(e.target.value)}
              placeholder="封入一词"
              className="w-full text-center font-brush text-5xl text-paper bg-ink-soft/60 border border-gold-soft/30 rounded-sm py-6 outline-none focus:border-cinnabar/60 tracking-[0.2em] placeholder:text-paper/20"
              inputMode="text"
            />
            <p className="text-center text-paper/35 text-[11px] font-sub mt-2">
              仅限汉字 · {Array.from(word).length}/4
            </p>
            <button
              disabled={!valid}
              onClick={submit}
              className="seal-btn w-full py-3.5 rounded-sm text-lg tracking-[0.4em] mt-5"
            >
              封 匣
            </button>
          </>
        ) : (
          <div className="text-center py-8 animate-inkfade">
            <div className="font-brush text-2xl text-gold mb-2">已 封 匣</div>
            <p className="text-paper/45 text-sm font-sub">静候众人封匣完毕…</p>
            <div className="mt-6 mx-auto w-40 h-40 flex items-center justify-center">
              <div className="w-16 h-16 rounded-full border-2 border-gold/40 border-t-gold animate-spin" />
            </div>
          </div>
        )}
      </div>

      {/* 进度 */}
      <div className="shrink-0">
        <div className="flex items-baseline justify-between mb-1.5 px-1">
          <span className="text-paper/50 text-xs font-sub">封匣进度</span>
          <span className="text-gold font-sub text-sm">
            {view.completion.done}/{view.completion.total}
          </span>
        </div>
        <div className="h-1.5 rounded-full bg-ink-soft overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-cinnabar to-gold transition-all duration-500"
            style={{ width: `${view.completion.total ? (view.completion.done / view.completion.total) * 100 : 0}%` }}
          />
        </div>
        <p className="text-center text-paper/30 text-[11px] font-sub mt-2">
          全员封匣后研墨成文 · 可切至公屏闲叙
        </p>
      </div>
    </div>
  );
}
