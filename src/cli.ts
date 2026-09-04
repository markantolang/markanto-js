#!/usr/bin/env node
/// <reference types="node" />

import { randomUUID } from 'node:crypto';
import { chmodSync, readFileSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync, writeSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { Diagnostic } from './diagnostics.js';
import { format } from './formatter/format.js';
import { checkCanonical } from './parser/check-canonical.js';
import { parse } from './parser/parse.js';
import type { IdGenerator } from './ast.js';
import type { AnnotatedPoint, ParseResult } from './parser-contract.js';
import { adoptDocument } from './validator/adopt.js';
import { validate } from './validator/validate.js';

export interface CommandResult {
  readonly output: string;
  readonly exitCode: number;
  readonly newContent?: string;
}

export interface CheckOptions { readonly strict?: boolean }
export interface FormatOptions { readonly check?: boolean; readonly stdout?: boolean; readonly strict?: boolean }
export interface AdoptOptions { readonly check?: boolean; readonly stdout?: boolean; readonly createId?: IdGenerator }

export function formatDiagnostic(diagnostic: Diagnostic, fallback?: AnnotatedPoint): string {
  const point = diagnostic.range?.start ?? fallback;
  const location = point === undefined ? '' : `${point.line}:${point.column}: `;
  return `${location}${diagnostic.severity}[${diagnostic.category}]: ${diagnostic.message ?? 'no details'}`;
}

function collectDiagnostics(diagnostics: readonly Diagnostic[], fallback?: AnnotatedPoint): { readonly output: string; readonly hasErrors: boolean } {
  return {
    output: diagnostics.map((diagnostic) => formatDiagnostic(diagnostic, fallback)).join('\n'),
    hasErrors: diagnostics.some((diagnostic) => diagnostic.severity === 'error'),
  };
}

function appendOutput(output: string, line: string): string { return output.length === 0 ? line : `${output}\n${line}`; }
function statusError(status: 'invalid' | 'resource', operation: string): string {
  return `error[${status === 'resource' ? 'resource' : 'semantic'}]: ${operation} ${status === 'resource' ? 'exhausted its resource budget; raise the budget or use a smaller input' : 'failed'}`;
}

export function runCheck(source: string, options: CheckOptions = {}): CommandResult {
  const parsed = parse(source, { strict: options.strict ?? false, errorRecovery: true });
  const diagnostics = collectDiagnostics(parsed.diagnostics, recoveryStart(parsed));
  if (parsed.status !== 'ok') {
    return { output: diagnostics.output.length > 0 ? diagnostics.output : statusError(parsed.status, 'parse'), exitCode: 1 };
  }
  if (options.strict === true) {
    const canonical = checkCanonical(source);
    const checked = collectDiagnostics(canonical.diagnostics);
    if (canonical.status !== 'canonical') {
      return { output: checked.output.length > 0 ? checked.output : statusError(canonical.status === 'resource' ? 'resource' : 'invalid', 'canonical check'), exitCode: 1 };
    }
  }
  return { output: diagnostics.output, exitCode: diagnostics.hasErrors ? 1 : 0 };
}

export function runFormat(source: string, options: FormatOptions = {}): CommandResult {
  if (options.check === true && options.stdout === true) return { output: 'error[syntax]: --check and --stdout are mutually exclusive', exitCode: 1 };
  const parsed = parse(source, { strict: options.strict ?? false, errorRecovery: true });
  let output = collectDiagnostics(parsed.diagnostics, recoveryStart(parsed)).output;
  if (parsed.status !== 'ok') return { output: output.length > 0 ? output : statusError(parsed.status, 'parse'), exitCode: 1 };

  const validated = validate(parsed.document);
  output = appendDiagnostics(output, validated.diagnostics);
  if (validated.status !== 'ok') return { output: output.length > 0 ? output : statusError(validated.status, 'validation'), exitCode: 1 };

  const formatted = format(parsed.document);
  output = appendDiagnostics(output, formatted.diagnostics);
  if (formatted.status !== 'ok') return { output: output.length > 0 ? output : statusError(formatted.status, 'format'), exitCode: 1 };

  if (options.check === true) {
    const canonical = checkCanonical(source);
    output = appendDiagnostics(output, canonical.diagnostics);
    if (canonical.status !== 'canonical') {
      if (canonical.diagnostics.length === 0) output = appendOutput(output, 'error[noncanonical]: file is not canonical');
      return { output, exitCode: 1 };
    }
    return { output, exitCode: 0 };
  }
  return { output, exitCode: 0, newContent: formatted.source };
}

export function runAdopt(source: string, options: AdoptOptions = {}): CommandResult {
  if (options.check === true && options.stdout === true) return { output: 'error[syntax]: --check and --stdout are mutually exclusive', exitCode: 1 };
  const parsed = parse(source, { errorRecovery: true });
  let output = collectDiagnostics(parsed.diagnostics, recoveryStart(parsed)).output;
  if (parsed.status !== 'ok') return { output: output.length > 0 ? output : statusError(parsed.status, 'parse'), exitCode: 1 };

  const validated = validate(parsed.document);
  output = appendDiagnostics(output, validated.diagnostics);
  if (validated.status !== 'ok') return { output: output.length > 0 ? output : statusError(validated.status, 'validation'), exitCode: 1 };

  let adopted;
  try {
    adopted = adoptDocument(parsed.document, options.createId ?? createId);
  } catch (error) {
    return { output: appendOutput(output, `error[semantic]: ${error instanceof Error ? error.message : String(error)}`), exitCode: 1 };
  }
  const formatted = format(adopted.document);
  output = appendDiagnostics(output, formatted.diagnostics);
  if (formatted.status !== 'ok') return { output: output.length > 0 ? output : statusError(formatted.status, 'format'), exitCode: 1 };

  if (options.check === true && formatted.source !== source) {
    return { output: appendOutput(output, 'error[noncanonical]: adopt would modify the file'), exitCode: 1 };
  }
  return options.check === true ? { output, exitCode: 0 } : { output, exitCode: 0, newContent: formatted.source };
}

function appendDiagnostics(output: string, diagnostics: readonly Diagnostic[]): string {
  const next = collectDiagnostics(diagnostics).output;
  return next.length === 0 ? output : appendOutput(output, next);
}

function recoveryStart(result: ParseResult): AnnotatedPoint | undefined {
  if (result.status !== 'invalid' || result.recovery === undefined || result.annotations === undefined) return undefined;
  const stack: unknown[] = [...result.recovery.children];
  while (stack.length > 0) {
    const value = stack.pop();
    if (typeof value !== 'object' || value === null) continue;
    const record = value as Record<string, unknown>;
    if (record['type'] === 'errorBlock') return result.annotations.forNode(value)?.range.start;
    for (const child of Object.values(record)) {
      if (Array.isArray(child)) stack.push(...child);
      else if (typeof child === 'object' && child !== null) stack.push(child);
    }
  }
  return undefined;
}

function createId(): string { return randomUUID().replaceAll('-', ''); }

function replaceFile(file: string, content: string): void {
  // Resolve a symlink so the atomic swap rewrites the file the user named
  // rather than replacing the link, and carry the original permission bits
  // across (a plain write + rename would reset them to the process default).
  const target = realpathSync(file);
  const mode = statSync(target).mode & 0o777;
  const temporary = join(dirname(target), `.${basename(target)}.markanto-${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, content, { encoding: 'utf8', flag: 'wx', mode });
    chmodSync(temporary, mode); // `writeFileSync` mode is umask-masked; set it exactly
    renameSync(temporary, target);
  } catch (error) {
    try { unlinkSync(temporary); } catch { /* The temporary may not have been created. */ }
    throw error;
  }
}

/**
 * Synchronous writes to fd 1/2: `process.stdout.write` is asynchronous when the
 * stream is a pipe, and the immediately following `process.exit()` can drop the
 * unflushed buffer (empty output under `spawnSync`). `writeSync` is flushed
 * before it returns, so `process.exit()` stays safe.
 */
function writeOut(text: string): void { if (text.length > 0) writeSync(1, text); }
function writeErr(text: string): void { if (text.length > 0) writeSync(2, text); }

function fail(message: string): never {
  writeErr(`markanto: ${message}\n`);
  process.exit(1);
}

function main(): void {
  const [command, file, ...flags] = process.argv.slice(2);
  if (command === undefined || file === undefined) fail('usage: markanto <check|format|adopt> <file> [--check|--stdout|--strict]');
  if (command !== 'check' && command !== 'format' && command !== 'adopt') fail(`unknown command: ${command}`);
  for (const flag of flags) if (flag !== '--check' && flag !== '--stdout' && flag !== '--strict') fail(`unknown flag: ${flag}`);
  const check = flags.includes('--check');
  const stdout = flags.includes('--stdout');
  const strict = flags.includes('--strict');
  if (check && stdout) fail('--check and --stdout are mutually exclusive');
  if (command === 'check' && (check || stdout)) fail('check accepts only --strict');
  if (command === 'adopt' && strict) fail('adopt does not accept --strict');

  let source: string;
  try { source = readFileSync(file, 'utf8'); }
  catch (error) { fail(`cannot read ${file}: ${error instanceof Error ? error.message : String(error)}`); }

  const result = command === 'check'
    ? runCheck(source, { strict })
    : command === 'format'
      ? runFormat(source, { check, stdout, strict })
      : runAdopt(source, { check, stdout });

  if (result.output.length > 0) {
    writeErr(`${result.output.split('\n').map((line) => `${file}: ${line}`).join('\n')}\n`);
  }
  if (result.newContent !== undefined) {
    if (stdout) writeOut(result.newContent);
    else {
      try { replaceFile(file, result.newContent); }
      catch (error) { fail(`cannot write ${file}: ${error instanceof Error ? error.message : String(error)}`); }
    }
  }
  process.exit(result.exitCode);
}

let runAsEntry = false;
try {
  runAsEntry = process.argv[1] !== undefined
    && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
} catch { /* argv[1] need not name a file when imported by a test runner. */ }
// The try/catch guards only entry-module *identification*. Once identified, an
// unexpected exception in main() must propagate (Node exits non-zero) — not be
// swallowed into a silent exit 0.
if (runAsEntry) main();
