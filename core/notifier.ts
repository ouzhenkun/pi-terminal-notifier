import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";
import { execFile } from "./process.ts";
import type { NotifyActivation, TerminalContext } from "./terminal.ts";

export interface NotifyOptions {
  subtitle?: string;
  sound?: string;
  force?: boolean;
  activation?: NotifyActivation;
  group?: string;
}

export interface Notifier {
  send(title: string, body: string, options?: NotifyOptions): Promise<void>;
}

const DEFAULT_GROUP = "pi-agent";

async function findNotifierBinary(packageRoot: string): Promise<string | null> {
  const binary = path.join(
    packageRoot,
    "vendor",
    "pi-terminal-notifier.app",
    "Contents",
    "MacOS",
    "pi-terminal-notifier",
  );
  try {
    await access(binary);
    return binary;
  } catch {
    return null;
  }
}

function buildNotifyArgs(
  title: string,
  body: string,
  activation?: NotifyActivation,
  subtitle?: string,
  group?: string,
): string[] {
  const args = ["-title", title];
  if (subtitle) args.push("-subtitle", subtitle);
  args.push("-message", body || " ", "-group", group || DEFAULT_GROUP);

  if (activation?.type === "activate") args.push("-activate", activation.bundleId);
  else if (activation?.type === "execute") args.push("-execute", activation.command);

  return args;
}

async function cleanupStaleNotifiers(binary: string): Promise<void> {
  try {
    await execFile("pkill", ["-f", binary]);
  } catch {
    // No previous notifier process is running.
  }
}

export function createNotifier(packageRoot: string, terminal: TerminalContext): Notifier {
  let notifierBinary: string | null = null;
  let binaryReady = false;

  findNotifierBinary(packageRoot)
    .then((binary) => {
      notifierBinary = binary;
      binaryReady = true;
    })
    .catch(() => {
      binaryReady = true;
    });

  return {
    async send(title: string, body: string, options?: NotifyOptions): Promise<void> {
      if (!binaryReady || !notifierBinary) return;
      if (!options?.force && (await terminal.isVisible())) return;

      const args = buildNotifyArgs(
        title,
        body,
        options?.activation ?? terminal.getActivation(),
        options?.subtitle ?? path.basename(process.cwd()),
        options?.group,
      );

      if (options?.sound) {
        const sound = spawn(
          "afplay",
          [path.join(packageRoot, "sounds", options.sound + ".aiff")],
          { stdio: "ignore", detached: true },
        );
        sound.unref();
      }

      await cleanupStaleNotifiers(notifierBinary);
      const child = spawn(notifierBinary, args, { stdio: "ignore", detached: true });
      child.unref();
    },
  };
}
