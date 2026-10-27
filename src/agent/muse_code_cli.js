/**
 * Muse Code CLI - Autonomous Execution Wrapper
 *
 * Replaces legacy harness wrappers with Meta Muse Code CLI interface.
 * Handles local file read/write operations, shell execution, and effect verification
 * on the VM persistent workspace.
 */

import fs from "node:fs";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export class MuseCodeExecutor {
  constructor(workspaceDir) {
    this.workspaceDir = workspaceDir || path.resolve(process.cwd());
  }

  /**
   * Safely writes a generated game module or patch to the workspace
   */
  async writeFile(relativePath, content) {
    const safePath = path.resolve(this.workspaceDir, relativePath);
    if (!safePath.startsWith(this.workspaceDir)) {
      throw new Error("Security violation: Path traversal outside workspace");
    }

    const dir = path.dirname(safePath);
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.writeFile(safePath, content, "utf8");
    return { success: true, path: safePath, size: Buffer.byteLength(content) };
  }

  /**
   * Reads an existing workspace file
   */
  async readFile(relativePath) {
    const safePath = path.resolve(this.workspaceDir, relativePath);
    if (!safePath.startsWith(this.workspaceDir)) {
      throw new Error("Security violation: Path traversal outside workspace");
    }
    return await fs.promises.readFile(safePath, "utf8");
  }

  /**
   * Executes a verified shell command (e.g. build verification or test suite)
   */
  async runCommand(command, args = [], options = {}) {
    try {
      const { stdout, stderr } = await execFileAsync(command, args, {
        cwd: this.workspaceDir,
        timeout: 30000,
        ...options,
      });
      return { success: true, stdout, stderr };
    } catch (err) {
      return { success: false, error: err.message, stderr: err.stderr };
    }
  }
}
