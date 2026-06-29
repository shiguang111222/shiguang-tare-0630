import { useEffect } from "react";
import { useGame } from "./store";
import Home from "./pages/Home";
import Lobby from "./pages/Lobby";
import Words from "./pages/Words";
import Play from "./pages/Play";
import Result from "./pages/Result";
import TopBar from "./components/TopBar";
import Chat from "./components/Chat";

export default function App() {
  const init = useGame((s) => s.init);
  const view = useGame((s) => s.view);
  const tab = useGame((s) => s.tab);
  const error = useGame((s) => s.error);
  const clearError = useGame((s) => s.clearError);

  useEffect(() => {
    init();
  }, [init]);

  if (!view) return <Home />;

  return (
    <div className="mx-auto w-full max-w-[440px] h-full flex flex-col surface-ink">
      <TopBar />
      <main className="flex-1 min-h-0 flex flex-col">
        {tab === "game" ? (
          <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar">
            {view.screen === "lobby" && <Lobby />}
            {view.screen === "words" && <Words />}
            {view.screen === "play" && <Play />}
            {view.screen === "result" && <Result />}
          </div>
        ) : (
          <Chat />
        )}
      </main>

      {error && (
        <div className="px-4 pb-4 pointer-events-none">
          <button
            onClick={clearError}
            className="pointer-events-auto w-full text-center text-sm font-sub tracking-wide bg-cinnabar-deep/90 text-paper px-4 py-2.5 rounded-sm border border-cinnabar-light/40 animate-inkfade"
          >
            {error}
          </button>
        </div>
      )}
    </div>
  );
}
