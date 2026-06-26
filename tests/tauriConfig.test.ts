import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

interface TauriConfig {
  app?: {
    security?: {
      csp?: string;
    };
  };
}

function loadCsp(): string {
  const raw = readFileSync('src-tauri/tauri.conf.json', 'utf8');
  const config = JSON.parse(raw) as TauriConfig;
  return config.app?.security?.csp ?? '';
}

describe('tauri CSP', () => {
  test('allows the image preview custom protocol as an image source', () => {
    expect(loadCsp()).toContain('img-src');
    expect(loadCsp()).toContain('http://image.localhost');
  });
});
