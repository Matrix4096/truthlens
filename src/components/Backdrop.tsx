export default function Backdrop() {
  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-[#05080f]">
      {/* 网格 */}
      <div
        className="absolute inset-0 opacity-[0.14]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(94,234,212,0.25) 1px, transparent 1px), linear-gradient(90deg, rgba(94,234,212,0.25) 1px, transparent 1px)",
          backgroundSize: "56px 56px",
          maskImage: "radial-gradient(ellipse 90% 70% at 50% 0%, black 30%, transparent 75%)",
          WebkitMaskImage: "radial-gradient(ellipse 90% 70% at 50% 0%, black 30%, transparent 75%)",
        }}
      />
      {/* 光晕 */}
      <div className="absolute -top-40 left-1/2 h-[480px] w-[820px] -translate-x-1/2 rounded-full bg-emerald-500/12 blur-[140px]" />
      <div className="absolute top-1/3 -left-40 h-[380px] w-[380px] rounded-full bg-cyan-500/10 blur-[120px]" />
      <div className="absolute right-[-160px] bottom-[-120px] h-[420px] w-[420px] rounded-full bg-teal-500/8 blur-[130px]" />
    </div>
  );
}
