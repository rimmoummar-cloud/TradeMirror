// ---------------------------------------------------------------------------
// Minimal toast notifications (no dependencies, no app redesign)
//
// A tiny DOM-based toast so any failure is ALWAYS visible to the user — no more
// silent infinite spinners. Called centrally from the axios error interceptor
// (so every failed API request surfaces) and from page-level catch blocks.
// ---------------------------------------------------------------------------

type ToastType = "error" | "success" | "info";

const COLORS: Record<ToastType, string> = {
  error: "#dc2626",
  success: "#16a34a",
  info: "#2563eb",
};

let containerEl: HTMLDivElement | null = null;

function container(): HTMLDivElement {
  if (containerEl && document.body.contains(containerEl)) return containerEl;
  const el = document.createElement("div");
  el.style.cssText = [
    "position:fixed",
    "top:16px",
    "right:16px",
    "z-index:99999",
    "display:flex",
    "flex-direction:column",
    "gap:8px",
    "max-width:380px",
    "font-family:system-ui,sans-serif",
  ].join(";");
  document.body.appendChild(el);
  containerEl = el;
  return el;
}

/** Show a toast. Errors stay visible longer; all are dismissible by click. */
export function showToast(message: string, type: ToastType = "error", durationMs?: number): void {
  // Guard for non-browser contexts (defensive; this module is browser-only).
  if (typeof document === "undefined") return;

  const toast = document.createElement("div");
  toast.style.cssText = [
    `background:${COLORS[type]}`,
    "color:#fff",
    "padding:12px 14px",
    "border-radius:8px",
    "box-shadow:0 4px 12px rgba(0,0,0,0.18)",
    "font-size:13px",
    "line-height:1.4",
    "cursor:pointer",
    "white-space:pre-wrap",
    "word-break:break-word",
  ].join(";");
  toast.textContent = message;
  toast.onclick = () => toast.remove();

  container().appendChild(toast);

  const ms = durationMs ?? (type === "error" ? 8000 : 4000);
  window.setTimeout(() => toast.remove(), ms);
}
