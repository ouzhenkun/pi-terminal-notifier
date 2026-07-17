import { execFile as execFileCallback } from "node:child_process";

export function execFile(
  command: string,
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFileCallback(command, args, { encoding: "utf8" }, (error, stdout, stderr) => {
      if (error) return reject(error);
      resolve({ stdout: stdout || "", stderr: stderr || "" });
    });
  });
}
