// earlyDevBanner.js
(() => {
  if (document.getElementById("early-dev-banner")) return;

  const banner = document.createElement("div");
  banner.id = "early-dev-banner";
  banner.textContent = "Development Version — for testing only";

  Object.assign(banner.style, {
    position: "fixed",
    left: "50%",
    bottom: "12px",
    transform: "translateX(-50%)",
    zIndex: "2147483647",

    font: "600 14px system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
    color: "rgba(255,255,255,0.9)",
    background: "rgba(128,0,0,0.50)",
    border: "1px solid rgba(255,165,0,0.35)",
    borderRadius: "999px",
    padding: "6px 14px",

    pointerEvents: "none",
    backdropFilter: "blur(2px)",
    WebkitBackdropFilter: "blur(2px)"
  });

  document.addEventListener("DOMContentLoaded", () => {
    document.body.appendChild(banner);
  });
})();
