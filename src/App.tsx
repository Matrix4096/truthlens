import { Routes, Route } from "react-router";
import SiteHeader from "./components/SiteHeader";
import Preloader from "./components/Preloader";
import PageWipe from "./components/PageWipe";
import Home from "./pages/Home";
import History from "./pages/History";
import Auth from "./pages/Auth";
import Admin from "./pages/Admin";
import Settings from "./pages/Settings";

export default function App() {
  return (
    <div className="bg-chrome min-h-screen">
      <Preloader />
      <SiteHeader />
      <PageWipe>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/history" element={<History />} />
          <Route path="/auth" element={<Auth />} />
          <Route path="/admin" element={<Admin />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Home />} />
        </Routes>
      </PageWipe>
    </div>
  );
}
