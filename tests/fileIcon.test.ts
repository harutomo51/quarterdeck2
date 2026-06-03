import { describe, expect, test } from 'vitest';
import { fileExtension, fileIconKind } from '../src/lib/fileIcon';

describe('fileExtension', () => {
  test('returns lowercase extension without dot', () => {
    expect(fileExtension('Main.TS')).toBe('ts');
    expect(fileExtension('archive.tar.gz')).toBe('gz');
  });

  test('treats dotfiles as having no extension', () => {
    expect(fileExtension('.gitignore')).toBe('');
    expect(fileExtension('.env')).toBe('');
  });

  test('returns empty string when there is no extension', () => {
    expect(fileExtension('Makefile')).toBe('');
    expect(fileExtension('README')).toBe('');
  });

  test('treats a trailing dot as no extension', () => {
    expect(fileExtension('weird.')).toBe('');
  });
});

describe('fileIconKind', () => {
  test('maps source code extensions to code', () => {
    for (const name of ['app.ts', 'view.tsx', 'main.rs', 'script.py', 'mod.go']) {
      expect(fileIconKind(name)).toBe('code');
    }
  });

  test('maps markup, style and json families', () => {
    expect(fileIconKind('index.html')).toBe('markup');
    expect(fileIconKind('app.css')).toBe('style');
    expect(fileIconKind('theme.scss')).toBe('style');
    expect(fileIconKind('tsconfig.json')).toBe('json');
  });

  test('maps documents', () => {
    expect(fileIconKind('README.md')).toBe('markdown');
    expect(fileIconKind('notes.txt')).toBe('text');
    expect(fileIconKind('manual.pdf')).toBe('pdf');
  });

  test('maps media and archives', () => {
    expect(fileIconKind('logo.PNG')).toBe('image');
    expect(fileIconKind('icon.svg')).toBe('image');
    expect(fileIconKind('clip.mp4')).toBe('video');
    expect(fileIconKind('track.mp3')).toBe('audio');
    expect(fileIconKind('bundle.zip')).toBe('archive');
  });

  test('maps config files by extension and by special name', () => {
    expect(fileIconKind('Cargo.toml')).toBe('config');
    expect(fileIconKind('config.yaml')).toBe('config');
    expect(fileIconKind('Dockerfile')).toBe('config');
    expect(fileIconKind('.gitignore')).toBe('config');
    expect(fileIconKind('.env')).toBe('config');
  });

  test('falls back to file for unknown extensions', () => {
    expect(fileIconKind('data.xyz')).toBe('file');
    expect(fileIconKind('UNKNOWN')).toBe('file');
  });
});
