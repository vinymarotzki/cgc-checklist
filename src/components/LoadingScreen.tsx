"use client";

type LoadingScreenProps = {
  message?: string;
};

// Logo SASI com animação "signal pulse" — mesma tela em todas as telas de
// carregamento do app (ver c:\Users\SASI\Downloads\sasi-logo-signal-pulse.html
// pra referência original).
export default function LoadingScreen({ message = "Carregando..." }: LoadingScreenProps) {
  return (
    <div style={{ background: "#0F1117", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ width: 100, height: 100, margin: "0 auto 16px" }}>
          <svg width="100%" height="100%" viewBox="0 0 401 401" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path className="signal-wave-3" d="M373.866 311.343C388.222 311.939 400.784 300.607 400.186 286.294C398.99 253.492 392.41 221.286 380.446 190.273C365.491 151.507 342.162 115.723 312.851 86.4988C282.942 57.2751 247.649 34.0154 208.767 19.1053C177.661 7.17729 145.359 0.616862 112.459 0.0204597C98.1025 -0.575943 86.7369 11.9485 87.3351 26.8586C87.9333 41.1722 100.495 52.5039 115.45 53.1003C141.172 54.2931 166.296 59.6607 190.223 68.6067C222.525 80.5348 251.836 99.6197 276.362 124.072C300.887 148.525 320.029 177.152 331.993 209.358C340.966 233.214 346.35 258.263 348.144 283.908C348.144 298.222 359.51 310.746 373.866 311.343Z" fill="#E8EAF0" />
            <path className="signal-wave-2" d="M275.763 319.692C290.12 321.481 303.28 311.343 303.28 297.029C303.28 275.558 299.69 254.088 292.512 233.214C282.343 204.586 266.192 178.345 244.657 156.278C223.123 134.807 196.803 118.108 168.09 107.969C147.751 100.812 125.618 97.234 104.084 96.6376C89.7273 96.6376 79.5582 109.759 81.3528 124.072C83.1473 138.386 96.3074 148.525 110.664 149.121C124.422 149.717 138.18 152.699 151.341 156.874C172.875 164.031 192.017 176.556 208.168 192.658C224.319 208.761 236.283 227.846 243.461 249.317C247.648 262.438 250.639 276.155 251.237 289.872C251.836 304.782 261.407 317.903 275.763 319.692Z" fill="#E8EAF0" />
            <path className="signal-wave-1" d="M101.692 400.207C157.854 400.207 203.383 354.813 203.383 298.818C203.383 242.823 157.854 197.43 101.692 197.43C45.5289 197.43 0 242.823 0 298.818C0 354.813 45.5289 400.207 101.692 400.207Z" fill="#E8EAF0" />
            <path className="signal-dot" d="M101.692 376.35C144.64 376.35 179.456 341.638 179.456 298.818C179.456 255.998 144.64 221.286 101.692 221.286C58.7439 221.286 23.9277 255.998 23.9277 298.818C23.9277 341.638 58.7439 376.35 101.692 376.35Z" fill="#E42415" />
          </svg>
        </div>
        <style>{`
          .signal-dot { animation: dot-pulse 1.8s ease-in-out infinite; transform-origin: 101.692px 298.818px; }
          .signal-wave-1 { animation: wave-pulse 1.8s ease-in-out infinite; transform-origin: 101.692px 298.818px; }
          .signal-wave-2 { animation: wave-pulse 1.8s ease-in-out infinite; animation-delay: 0.2s; transform-origin: 101.692px 298.818px; }
          .signal-wave-3 { animation: wave-pulse 1.8s ease-in-out infinite; animation-delay: 0.4s; transform-origin: 101.692px 298.818px; }
          @keyframes dot-pulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.75; transform: scale(1.06); } }
          @keyframes wave-pulse { 0% { opacity: 0.25; } 20% { opacity: 1; } 55% { opacity: 0.25; } 100% { opacity: 0.25; } }
        `}</style>
        <p style={{ color: "#E8EAF0", fontSize: 14 }}>{message}</p>
      </div>
    </div>
  );
}
