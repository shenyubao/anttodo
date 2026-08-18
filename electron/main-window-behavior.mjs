/**
 * Keep the macOS main window in native window switchers while retaining the
 * tray app's close-to-background behavior.
 *
 * A hidden BrowserWindow is omitted by some macOS window switchers (including
 * common Option-Tab replacements), while a minimized regular window remains
 * discoverable and can be restored by the switcher.
 */
export function shouldMinimizeMainWindowOnClose({ platform, isQuitting }) {
  return platform === "darwin" && !isQuitting;
}
