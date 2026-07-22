import { describe, expect, it } from 'vitest';
import type { RunContext } from '@img3d/shared';
import { buildProviderCommand, findSessionId, stringifyEventPayload } from './providers.js';

const context = {
  workDir: '/tmp/img3d-run',
  referencePaths: [{ role: 'hero', path: '/tmp/hero.png' }],
} as RunContext;

describe('provider protocol handling', () => {
  it('extracts nested session ids and readable agent messages', () => {
    expect(findSessionId({ event: { session_id: 'session-123' } })).toBe('session-123');
    expect(stringifyEventPayload({ item: { type: 'agent_message', text: 'Measured the silhouette.' } })).toBe('Measured the silhouette.');
    expect(stringifyEventPayload({ message: { content: [{ type: 'text', text: 'Validated the form.' }] } })).toBe('Validated the form.');
    expect(stringifyEventPayload({ message: { content: [{ type: 'tool_result', content: 'large output' }] } })).toBe('');
    expect(stringifyEventPayload({ message: { content: [{ type: 'tool_use', name: 'Write' }] } })).toBe('Workspace artifacts are changing.');
  });

  it('builds current Claude stream arguments and resumable Codex arguments', () => {
    const claude = buildProviderCommand('claude', context);
    expect(claude.args).toContain('--verbose');
    expect(claude.args).toContain('stream-json');
    expect(claude.args).toEqual(expect.arrayContaining(['--add-dir', context.workDir]));
    const codex = buildProviderCommand('codex', context, 'thread-456');
    expect(codex.args).toEqual(expect.arrayContaining(['resume', 'thread-456', '-i', '/tmp/hero.png']));
  });
});
