/** Detect the Electron tray mini-surface hash route (`#/tray`). */
export function isTrayHash(hash = typeof window !== "undefined" ? window.location.hash : "") {
  const path = hash.replace(/^#/, "").split("?")[0] || "/";
  return path === "/tray" || path === "tray";
}
