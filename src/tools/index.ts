import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { execSync } from 'node:child_process';

// ─── Tool Interface ────────────────────────────────────────────────

export interface Tool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  execute(input: Record<string, unknown>): Promise<Record<string, unknown>>;
}

// ─── Tool Registry ─────────────────────────────────────────────────

export class ToolRegistry {
  private tools = new Map<string, Tool>();

  register(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  getForAgent(toolNames: string[]): Tool[] {
    return toolNames
      .map(n => this.tools.get(n))
      .filter((t): t is Tool => t !== undefined);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }
}

// ─── Built-in Tools ────────────────────────────────────────────────

export class FileWriteTool implements Tool {
  name = 'file_write';
  description = 'Write content to a file. Creates parent directories if needed.';
  input_schema = {
    type: 'object' as const,
    properties: {
      path: { type: 'string', description: 'File path (relative to working directory)' },
      content: { type: 'string', description: 'Content to write to the file' },
    },
    required: ['path', 'content'],
  };

  constructor(private workDir: string) {}

  async execute(input: Record<string, unknown>): Promise<Record<string, unknown>> {
    const relPath = input.path as string;
    const absPath = resolve(this.workDir, relPath);

    // Security: ensure path stays within workDir
    const rel = relative(this.workDir, absPath);
    if (rel.startsWith('..') || resolve(this.workDir, rel) !== absPath) {
      return { success: false, error: 'Path escapes working directory' };
    }

    mkdirSync(dirname(absPath), { recursive: true });
    writeFileSync(absPath, input.content as string);
    process.stderr.write(`  📝 [file_write] ${relPath}\n`);
    return { success: true, path: relPath };
  }
}

export class FileReadTool implements Tool {
  name = 'file_read';
  description = 'Read content from a file.';
  input_schema = {
    type: 'object' as const,
    properties: {
      path: { type: 'string', description: 'File path (relative to working directory)' },
    },
    required: ['path'],
  };

  constructor(private workDir: string) {}

  async execute(input: Record<string, unknown>): Promise<Record<string, unknown>> {
    const relPath = input.path as string;
    const absPath = resolve(this.workDir, relPath);

    const rel = relative(this.workDir, absPath);
    if (rel.startsWith('..') || resolve(this.workDir, rel) !== absPath) {
      return { success: false, error: 'Path escapes working directory' };
    }

    try {
      const content = readFileSync(absPath, 'utf-8');
      return { success: true, content };
    } catch {
      return { success: false, error: `File not found: ${relPath}` };
    }
  }
}

export class ShellExecTool implements Tool {
  name = 'shell_exec';
  description = 'Execute a shell command and return stdout/stderr.';
  input_schema = {
    type: 'object' as const,
    properties: {
      command: { type: 'string', description: 'Shell command to execute' },
    },
    required: ['command'],
  };

  constructor(private workDir: string, private timeoutMs = 30_000) {}

  async execute(input: Record<string, unknown>): Promise<Record<string, unknown>> {
    const command = input.command as string;
    process.stderr.write(`  🔧 [shell_exec] ${command}\n`);
    try {
      const stdout = execSync(command, {
        cwd: this.workDir,
        timeout: this.timeoutMs,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return { success: true, stdout: stdout.trim(), exit_code: 0 };
    } catch (err) {
      const execErr = err as { stdout?: string; stderr?: string; status?: number };
      return {
        success: false,
        stdout: (execErr.stdout ?? '').trim(),
        stderr: (execErr.stderr ?? '').trim(),
        exit_code: execErr.status ?? 1,
      };
    }
  }
}

// ─── Factory ───────────────────────────────────────────────────────

export function createBuiltinRegistry(workDir: string): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(new FileWriteTool(workDir));
  registry.register(new FileReadTool(workDir));
  registry.register(new ShellExecTool(workDir));
  return registry;
}
