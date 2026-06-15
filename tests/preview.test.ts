import { describe, test, expect } from 'vitest';
import {
  buildPreviewUrl,
  parsePreviewParam,
  previewWindowLabel,
  joinRel,
  buildPdfUrl,
} from '@/lib/preview';

describe('buildPreviewUrl', () => {
  test('encodes rel into the preview query param', () => {
    expect(buildPreviewUrl('docs/readme.md')).toBe('index.html?preview=docs%2Freadme.md');
  });

  test('encodes spaces and special characters', () => {
    expect(buildPreviewUrl('a b/c&d.txt')).toBe('index.html?preview=a+b%2Fc%26d.txt');
  });
});

describe('parsePreviewParam', () => {
  test('extracts rel from a preview search string', () => {
    expect(parsePreviewParam('?preview=docs%2Freadme.md')).toBe('docs/readme.md');
  });

  test('returns null when the param is absent', () => {
    expect(parsePreviewParam('')).toBeNull();
    expect(parsePreviewParam('?foo=bar')).toBeNull();
  });

  test('returns null for an empty preview value', () => {
    expect(parsePreviewParam('?preview=')).toBeNull();
  });
});

describe('previewWindowLabel', () => {
  test('keeps safe characters and prefixes with preview-', () => {
    expect(previewWindowLabel('readme-1_2')).toBe('preview-readme-1_2');
  });

  test('replaces unsafe characters (slash, dot, space) with underscore', () => {
    expect(previewWindowLabel('docs/read me.md')).toBe('preview-docs_read_me_md');
  });

  test('is deterministic for the same rel', () => {
    expect(previewWindowLabel('a/b.txt')).toBe(previewWindowLabel('a/b.txt'));
  });
});

describe('joinRel', () => {
  test('joins parent and name with a slash', () => {
    expect(joinRel('docs', 'readme.md')).toBe('docs/readme.md');
  });

  test('returns the name alone when parent is empty', () => {
    expect(joinRel('', 'readme.md')).toBe('readme.md');
  });
});

describe('buildPdfUrl', () => {
  test('builds an http://pdf.localhost url with the rel path', () => {
    expect(buildPdfUrl('docs/report.pdf')).toBe('http://pdf.localhost/docs/report.pdf');
  });

  test('encodes each segment but preserves slash separators', () => {
    // 空白・日本語は percent-encode しつつ、`/` は区切りとして温存する。
    expect(buildPdfUrl('資料/my report.pdf')).toBe(
      'http://pdf.localhost/%E8%B3%87%E6%96%99/my%20report.pdf',
    );
  });

  test('encodes characters that would break the path', () => {
    // `#`/`?` はそのまま渡すと URL のフラグメント/クエリと解釈されるためエスケープ。
    expect(buildPdfUrl('a#b?.pdf')).toBe('http://pdf.localhost/a%23b%3F.pdf');
  });
});
