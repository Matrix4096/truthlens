import { lazy, Suspense } from "react";
import { Routes, Route } from "react-router";
import SiteHeader from "./components/SiteHeader";
import Preloader from "./components/Preloader";
import PageWipe from "./components/PageWipe";
import Home from "./pages/Home";
import { useAuth } from "./lib/auth";

const History = lazy(() => import("./pages/History"));
const Auth = lazy(() => import("./pages/Auth"));
const Admin = lazy(() => import("./pages/Admin"));
const Settings = lazy(() => import("./pages/Settings"));

export default function App() {
  const { sessionError, retrySession } = useAuth();
  return (
    <div className="bg-chrome min-h-screen">
      <Preloader />
      <SiteHeader />
      {sessionError && (
        <div role="alert" className="bg-panel flex flex-wrap items-center justify-center gap-3 border-b border-panel-line px-4 py-3 font-mono2 text-xs text-panel-soft">
          暂时无法读取登录状态，请检查网络后重新连接。
          <button type="button" onClick={retrySession} className="border border-panel-line px-3 py-1">重新连接</button>
        </div>
      )}
      <PageWipe>
        <Suspense fallback={<div role="status" className="mono-label px-8 py-20 text-center">正在加载页面…</div>}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/history" element={<History />} />
            <Route path="/auth" element={<Auth />} />
            <Route path="/admin" element={<Admin />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<Home />} />
          </Routes>
        </Suspense>
      </PageWipe>
    </div>
  );
}
