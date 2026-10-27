/**
 * Muse Code CLI - Official Meta Agent Bridge
 *
 * Invokes Meta's native `muse` binary (Muse Code 1.4.13) in headless execution mode (`muse exec`).
 * Powered by Meta Muse models over Meta Model API with OS sandbox protection.
 */

import { spawn } from "node:child_process";
import path from "node:path";
import os from "node:os";

const MUSE_BIN = path.join(os.homedir(), ".local", "bin", "muse");

export class OfficialMuseCodeCLI {
  constructor(options = {}) {
    this.workspaceDir = options.workspaceDir || path.resolve(process.cwd());
    this.model = options.model || "muse-wonder-1.0";
    this.apiKey =
      options.apiKey || process.env.MODEL_API_KEY || process.env.META_API_KEY;
  }

  /**
   * Runs an autonomous task via Meta's `muse exec`
   * @param {string} prompt - Instruction for the coding agent
   * @returns {Promise<{ success: boolean, output: string }>}
   */
  async executeTask(prompt) {
    if (!prompt) throw new Error("Task prompt is required");

    return new Promise((resolve, reject) => {
      const args = ["exec", "--model", this.model, prompt];

      const env = {
        ...process.env,
        MODEL_API_KEY: this.apiKey,
        META_API_KEY: this.apiKey,
      };

      const child = spawn(MUSE_BIN, args, {
        cwd: this.workspaceDir,
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      child.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      child.on("close", (code) => {
        if (code === 0) {
          resolve({ success: true, output: stdout.trim() });
        } else {
          resolve({
            success: false,
            output: stdout,
            error: stderr.trim(),
            code,
          });
        }
      });

      child.on("error", (err) => {
        reject(err);
      });
    });
  }
}
