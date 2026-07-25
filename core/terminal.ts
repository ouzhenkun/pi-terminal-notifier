import path from "node:path";
import { execFile } from "./process.ts";

export type NotifyActivation =
  | { type: "activate"; bundleId: string }
  | { type: "execute"; command: string };

type TerminalApp = "ghostty" | "vscode" | "zed" | "terminal" | "iterm2" | "unknown";

interface TerminalInfo {
  bundleId: string;
  processName: string;
}

export interface TerminalContext {
  getActivation(): NotifyActivation | undefined;
  isVisible(): Promise<boolean>;
}

const TERMINALS: Record<TerminalApp, TerminalInfo> = {
  ghostty: { bundleId: "com.mitchellh.ghostty", processName: "ghostty" },
  vscode: { bundleId: "com.microsoft.VSCode", processName: "Code" },
  zed: { bundleId: "dev.zed.Zed", processName: "zed" },
  terminal: { bundleId: "com.apple.Terminal", processName: "Terminal" },
  iterm2: { bundleId: "com.googlecode.iterm2", processName: "iTerm2" },
  unknown: { bundleId: "", processName: "" },
};

function detectTerminal(): TerminalApp {
  const terminalProgram = (process.env.TERM_PROGRAM ?? "").toLowerCase();
  if (terminalProgram === "ghostty") return "ghostty";
  if (terminalProgram === "vscode") return "vscode";
  if (terminalProgram === "zed") return "zed";
  if (terminalProgram === "iterm.app" || terminalProgram === "iterm2") return "iterm2";
  if (terminalProgram === "apple_terminal") return "terminal";
  if (terminalProgram === "tmux" && process.env.GHOSTTY_RESOURCES_DIR) return "ghostty";
  return "unknown";
}

async function getFrontmostApp(): Promise<string> {
  try {
    const { stdout } = await execFile("osascript", [
      "-e",
      `tell application "System Events" to get name of first application process whose frontmost is true`,
    ]);
    return stdout.trim().toLowerCase();
  } catch {
    return "";
  }
}

async function isTmuxPaneActive(): Promise<boolean> {
  if (!process.env.TMUX || !process.env.TMUX_PANE) return true;
  try {
    const { stdout } = await execFile("tmux", [
      "display-message",
      "-p",
      "-t",
      process.env.TMUX_PANE,
      "#{pane_active}#{window_active}",
    ]);
    return stdout.trim() === "11";
  } catch {
    return true;
  }
}

async function checkVisibility(app: TerminalApp, processName: string): Promise<boolean> {
  const frontmost = await getFrontmostApp();

  if (app === "zed") {
    if (frontmost !== "zed") return false;
    try {
      const { stdout } = await execFile("osascript", [
        "-e",
        `tell application "System Events" to tell process "zed" to get name of front window`,
      ]);
      // Zed titles are "<project> — <active file>", the reverse of VS Code's order.
      const title = stdout.trim();
      const separator = title.indexOf(" — ");
      const workspace = separator > 0 ? title.slice(0, separator) : title;
      const cwd = process.cwd();
      if (!(workspace === path.basename(cwd) || cwd.includes(workspace))) return false;
      return isTmuxPaneActive();
    } catch {
      return false;
    }
  }

  if (app !== "vscode") {
    if (frontmost !== processName.toLowerCase()) return false;
    return isTmuxPaneActive();
  }

  if (frontmost !== "code") return false;

  try {
    const { stdout } = await execFile("osascript", [
      "-e",
      `tell application "System Events" to tell process "Code" to get name of front window`,
    ]);
    const title = stdout.trim();
    const separator = title.lastIndexOf(" — ");
    const workspace = separator > 0 ? title.slice(separator + 3) : title;
    const cwd = process.cwd();
    if (!(workspace === path.basename(cwd) || cwd.includes(workspace))) return false;
    return isTmuxPaneActive();
  } catch {
    return false;
  }
}

function terminalOpenCommand(app: TerminalApp, bundleId: string): string {
  if (app === "vscode") return `open -b com.microsoft.VSCode '${process.cwd()}'`;
  if (app === "zed") return `open -b dev.zed.Zed '${process.cwd()}'`;
  if (app === "ghostty") return "open -a Ghostty";
  if (app === "terminal") return "open -a Terminal";
  if (app === "iterm2") return "open -a iTerm";
  return `open -b '${bundleId}'`;
}

export function createTerminalContext(): TerminalContext {
  const app = detectTerminal();
  const { bundleId, processName } = TERMINALS[app];
  const tmuxPane = process.env.TMUX_PANE ?? null;
  const tmuxSocket = process.env.TMUX?.split(",")[0] ?? null;
  let tmuxWindowTarget: string | null = null;

  if (tmuxPane && tmuxSocket) {
    execFile("tmux", [
      "-S",
      tmuxSocket,
      "display-message",
      "-p",
      "-t",
      tmuxPane,
      "#{session_name}:#{window_index}",
    ])
      .then(({ stdout }) => {
        tmuxWindowTarget = stdout.trim();
      })
      .catch(() => {});
  }

  return {
    getActivation(): NotifyActivation | undefined {
      if (!bundleId) return undefined;

      if (tmuxSocket && tmuxPane && tmuxWindowTarget) {
        const navigation = `tmux -S '${tmuxSocket}' select-window -t '${tmuxWindowTarget}' && tmux -S '${tmuxSocket}' select-pane -t '${tmuxPane}'`;
        return {
          type: "execute",
          command: `${navigation} && ${terminalOpenCommand(app, bundleId)}`,
        };
      }

      if (app === "vscode") {
        return { type: "execute", command: `open -b com.microsoft.VSCode '${process.cwd()}'` };
      }

      if (app === "zed") {
        return { type: "execute", command: `open -b dev.zed.Zed '${process.cwd()}'` };
      }

      return { type: "activate", bundleId };
    },

    async isVisible(): Promise<boolean> {
      return Promise.race([
        checkVisibility(app, processName),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 2000)),
      ]);
    },
  };
}
