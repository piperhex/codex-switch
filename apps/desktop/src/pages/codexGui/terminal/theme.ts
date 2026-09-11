import type { ITheme } from "@xterm/xterm";

export function terminalTheme(dark: boolean): ITheme {
  return dark ? {
    background: "#000000", foreground: "#e5e5e5", cursor: "#e5e5e5", cursorAccent: "#000000",
    selectionBackground: "#ffffff40", black: "#000000", brightBlack: "#767676",
    red: "#f14c4c", green: "#23d18b", yellow: "#f5f543", blue: "#3b8eea",
    magenta: "#d670d6", cyan: "#29b8db", white: "#e5e5e5",
  } : {
    background: "#ffffff", foreground: "#242424", cursor: "#242424", cursorAccent: "#ffffff",
    selectionBackground: "#00000025", black: "#242424", brightBlack: "#666666",
    red: "#b52020", green: "#137333", yellow: "#8a6500", blue: "#1554b0",
    magenta: "#922b91", cyan: "#087c8c", white: "#b5b5b5",
  };
}
