import { copyFile, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

interface Block {
  name: string;
  open: number;
  close: number;
  depth: number;
}

interface Token {
  type: 'word' | 'open' | 'close';
  value: string;
  index: number;
}

function tokenize(content: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  let quote: '"' | "'" | null = null;
  while (index < content.length) {
    const char = content[index];
    const next = content[index + 1];
    if (quote) {
      if (char === '\\') index += 2;
      else { if (char === quote) quote = null; index += 1; }
      continue;
    }
    if (char === '"' || char === "'") { quote = char; index += 1; continue; }
    if (char === '/' && next === '/') {
      const end = content.indexOf('\n', index + 2);
      index = end === -1 ? content.length : end + 1;
      continue;
    }
    if (char === '/' && next === '*') {
      const end = content.indexOf('*/', index + 2);
      if (end === -1) throw new Error('Malformed config.blk: unterminated block comment.');
      index = end + 2;
      continue;
    }
    if (char === '{') { tokens.push({ type: 'open', value: char, index }); index += 1; continue; }
    if (char === '}') { tokens.push({ type: 'close', value: char, index }); index += 1; continue; }
    if (/[A-Za-z0-9_.-]/.test(char ?? '')) {
      const start = index;
      while (index < content.length && /[A-Za-z0-9_.-]/.test(content[index] ?? '')) index += 1;
      tokens.push({ type: 'word', value: content.slice(start, index), index: start });
      continue;
    }
    index += 1;
  }
  return tokens;
}

export function parseBlocks(content: string): Block[] {
  const tokens = tokenize(content);
  const stack: Array<{ name: string; open: number; depth: number }> = [];
  const blocks: Block[] = [];
  let lastWord = '';
  for (const token of tokens) {
    if (token.type === 'word') lastWord = token.value;
    else if (token.type === 'open') {
      stack.push({ name: lastWord, open: token.index, depth: stack.length });
      lastWord = '';
    } else {
      const open = stack.pop();
      if (!open) throw new Error('Malformed config.blk: closing brace has no matching opening brace.');
      blocks.push({ ...open, close: token.index });
      lastWord = '';
    }
  }
  if (stack.length) throw new Error('Malformed config.blk: one or more blocks are not closed.');
  return blocks;
}

function lineIndentAt(content: string, index: number): string {
  const lineStart = content.lastIndexOf('\n', index) + 1;
  return content.slice(lineStart, index).match(/^\s*/)?.[0] ?? '';
}

export function setSoundModEnabled(content: string, enabled: boolean): string {
  const lineEnding = content.includes('\r\n') ? '\r\n' : '\n';
  const blocks = parseBlocks(content);
  const soundBlocks = blocks.filter((block) => block.name.toLowerCase() === 'sound');
  if (soundBlocks.length > 1) throw new Error('Malformed config.blk: multiple sound blocks require manual review.');
  const value = enabled ? 'yes' : 'no';
  const sound = soundBlocks[0];
  let result: string;

  if (!sound) {
    const separator = content.length === 0 || content.endsWith('\n') ? '' : lineEnding;
    result = `${content}${separator}sound {${lineEnding}  enable_mod:b=${value}${lineEnding}}${lineEnding}`;
  } else {
    const bodyStart = sound.open + 1;
    const body = content.slice(bodyStart, sound.close);
    const lines = body.split(/\r?\n/);
    const matches: number[] = [];
    lines.forEach((line, index) => {
      const uncommented = line.replace(/\/\/.*$/, '');
      if (/^\s*enable_mod\s*:\s*b\s*=/.test(uncommented)) matches.push(index);
    });
    if (matches.length) {
      const first = matches[0];
      const matchSet = new Set(matches);
      const rewritten = lines.flatMap((line, index) => {
        if (!matchSet.has(index)) return [line];
        if (index !== first) return [];
        const indent = line.match(/^\s*/)?.[0] ?? '';
        return [`${indent}enable_mod:b=${value}`];
      });
      result = content.slice(0, bodyStart) + rewritten.join(lineEnding) + content.slice(sound.close);
    } else {
      const blockIndent = lineIndentAt(content, sound.open);
      const propertyIndent = `${blockIndent}  `;
      const prefix = body.trim().length === 0 ? lineEnding : (body.endsWith('\n') ? '' : lineEnding);
      const insertion = `${prefix}${propertyIndent}enable_mod:b=${value}${lineEnding}${blockIndent}`;
      result = content.slice(0, sound.close) + insertion + content.slice(sound.close);
    }
  }

  if (enabled) result = ensureFmodSoundEnabled(result);
  parseBlocks(result);
  return result;
}

function ensureFmodSoundEnabled(content: string): string {
  const lineEnding = content.includes('\r\n') ? '\r\n' : '\n';
  const sound = parseBlocks(content).find((block) => block.name.toLowerCase() === 'sound');
  if (!sound) return content;
  const bodyStart = sound.open + 1;
  const body = content.slice(bodyStart, sound.close);
  const lines = body.split(/\r?\n/);
  const matches: number[] = [];
  lines.forEach((line, index) => {
    const uncommented = line.replace(/\/\/.*$/, '');
    if (/^\s*fmod_sound_enable\s*:\s*b\s*=/.test(uncommented)) matches.push(index);
  });
  if (matches.length) {
    const first = matches[0];
    const matchSet = new Set(matches);
    const rewritten = lines.flatMap((line, index) => {
      if (!matchSet.has(index)) return [line];
      if (index !== first) return [];
      const indent = line.match(/^\s*/)?.[0] ?? '';
      return [`${indent}fmod_sound_enable:b=yes`];
    });
    return content.slice(0, bodyStart) + rewritten.join(lineEnding) + content.slice(sound.close);
  }
  const blockIndent = lineIndentAt(content, sound.open);
  const propertyIndent = `${blockIndent}  `;
  const prefix = body.trim().length === 0 ? lineEnding : (body.endsWith('\n') ? '' : lineEnding);
  const insertion = `${prefix}${propertyIndent}fmod_sound_enable:b=yes${lineEnding}${blockIndent}`;
  return content.slice(0, sound.close) + insertion + content.slice(sound.close);
}

function backupStamp(date: Date): string {
  return date.toISOString().replace(/[:.]/g, '-');
}

export async function updateConfigFile(configPath: string, enabled: boolean, now = new Date()): Promise<string> {
  const original = await readFile(configPath, 'utf8');
  parseBlocks(original);
  const updated = setSoundModEnabled(original, enabled);
  const backupPath = join(dirname(configPath), `config.blk.tailmark-${backupStamp(now)}.bak`);
  const tempPath = `${configPath}.tailmark.tmp`;
  const swapPath = `${configPath}.tailmark.swap`;
  await copyFile(configPath, backupPath);
  try {
    await writeFile(tempPath, updated, { encoding: 'utf8', flag: 'wx' });
    const verification = await readFile(tempPath, 'utf8');
    parseBlocks(verification);
    await rm(swapPath, { force: true });
    await rename(configPath, swapPath);
    await rename(tempPath, configPath);
    await rm(swapPath, { force: true });
    return backupPath;
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined);
    if (await readFile(swapPath).then(() => true).catch(() => false)) {
      await rm(configPath, { force: true }).catch(() => undefined);
      await rename(swapPath, configPath).catch(() => undefined);
    } else {
      await copyFile(backupPath, configPath).catch(() => undefined);
    }
    throw error;
  }
}
