import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  ToolRegistry,
  FileWriteTool,
  FileReadTool,
  ShellExecTool,
  createBuiltinRegistry,
} from '../src/tools/index.js';

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'agentflow-tools-test-'));
}

function cleanup(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* noop */
  }
}

// ─── ToolRegistry ──────────────────────────────────────────────────

describe('ToolRegistry', () => {
  test('registra e recupera tool per nome', () => {
    const registry = new ToolRegistry();
    const tool = new FileWriteTool('/tmp');
    registry.register(tool);

    expect(registry.get('file_write')).toBe(tool);
    expect(registry.has('file_write')).toBe(true);
    expect(registry.has('nonexistent')).toBe(false);
  });

  test('getForAgent ritorna solo tool registrati', () => {
    const registry = new ToolRegistry();
    registry.register(new FileWriteTool('/tmp'));
    registry.register(new FileReadTool('/tmp'));

    const tools = registry.getForAgent(['file_write', 'unknown_tool', 'file_read']);
    expect(tools).toHaveLength(2);
    expect(tools[0].name).toBe('file_write');
    expect(tools[1].name).toBe('file_read');
  });

  test('createBuiltinRegistry registra i 3 tool built-in', () => {
    const registry = createBuiltinRegistry('/tmp');
    expect(registry.has('file_write')).toBe(true);
    expect(registry.has('file_read')).toBe(true);
    expect(registry.has('shell_exec')).toBe(true);
  });
});

// ─── FileWriteTool ─────────────────────────────────────────────────

describe('FileWriteTool', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir();
  });
  afterEach(() => {
    cleanup(tempDir);
  });

  test('scrive file nella workDir', async () => {
    const tool = new FileWriteTool(tempDir);
    const result = await tool.execute({ path: 'hello.ts', content: 'const x = 1;' });

    expect(result.success).toBe(true);
    expect(result.path).toBe('hello.ts');
    expect(readFileSync(join(tempDir, 'hello.ts'), 'utf-8')).toBe('const x = 1;');
  });

  test('crea directory padre se mancanti', async () => {
    const tool = new FileWriteTool(tempDir);
    await tool.execute({ path: 'src/lib/utils.ts', content: 'export {}' });

    expect(existsSync(join(tempDir, 'src/lib/utils.ts'))).toBe(true);
  });

  test('blocca path che escono dalla workDir', async () => {
    const tool = new FileWriteTool(tempDir);
    const result = await tool.execute({ path: '../../etc/passwd', content: 'hacked' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('escapes working directory');
  });
});

// ─── FileReadTool ──────────────────────────────────────────────────

describe('FileReadTool', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir();
  });
  afterEach(() => {
    cleanup(tempDir);
  });

  test('legge file esistente', async () => {
    writeFileSync(join(tempDir, 'test.txt'), 'hello world');
    const tool = new FileReadTool(tempDir);
    const result = await tool.execute({ path: 'test.txt' });

    expect(result.success).toBe(true);
    expect(result.content).toBe('hello world');
  });

  test('ritorna errore per file inesistente', async () => {
    const tool = new FileReadTool(tempDir);
    const result = await tool.execute({ path: 'nope.txt' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('File not found');
  });

  test('blocca path che escono dalla workDir', async () => {
    const tool = new FileReadTool(tempDir);
    const result = await tool.execute({ path: '../../../etc/passwd' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('escapes working directory');
  });
});

// ─── ShellExecTool ─────────────────────────────────────────────────

describe('ShellExecTool', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir();
  });
  afterEach(() => {
    cleanup(tempDir);
  });

  test('esegue comando e ritorna stdout', async () => {
    const tool = new ShellExecTool(tempDir);
    const result = await tool.execute({ command: 'echo hello' });

    expect(result.success).toBe(true);
    expect(result.stdout).toBe('hello');
    expect(result.exit_code).toBe(0);
  });

  test('ritorna stderr e exit code per comandi falliti', async () => {
    const tool = new ShellExecTool(tempDir);
    const result = await tool.execute({ command: 'ls /nonexistent_path_xyz 2>&1; exit 1' });

    expect(result.success).toBe(false);
    expect(result.exit_code).not.toBe(0);
  });

  test('esegue nella workDir corretta', async () => {
    writeFileSync(join(tempDir, 'marker.txt'), 'found');
    const tool = new ShellExecTool(tempDir);
    const result = await tool.execute({ command: 'cat marker.txt' });

    expect(result.success).toBe(true);
    expect(result.stdout).toBe('found');
  });
});
