/**
 * Phase 2: プレビューウィンドウ。
 *
 * read_preview の結果を kind で出し分ける:
 * - markdown: markdown-it でレンダリング（html:false で生 HTML を無効化＝XSS 抑止）
 * - html: <iframe sandbox="allow-scripts">（allow-same-origin は付けない。CLAUDE.md）
 * - code: highlight.js でシンタックスハイライト
 *
 * スコープ強制・1MB 制限は Rust 側 read_preview が担保する。
 */
import { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import MarkdownIt from 'markdown-it';
import hljs from 'highlight.js';
import 'highlight.js/styles/github-dark.css';

interface Preview {
  kind: string;
  content: string;
}

const md = new MarkdownIt({ html: false, linkify: true, breaks: false });

interface PreviewWindowProps {
  rel: string;
}

export function PreviewWindow({ rel }: PreviewWindowProps) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    invoke<Preview>('read_preview', { rel })
      .then(setPreview)
      .catch((e) => setError(String(e)));
  }, [rel]);

  const markdownHtml = useMemo(
    () => (preview?.kind === 'markdown' ? md.render(preview.content) : ''),
    [preview],
  );
  const codeHtml = useMemo(() => {
    if (preview?.kind !== 'code') return '';
    const result = hljs.highlightAuto(preview.content);
    return result.value;
  }, [preview]);

  if (error) {
    return (
      <div className="preview preview--error">
        <p>プレビューを開けませんでした:</p>
        <pre>{error}</pre>
      </div>
    );
  }

  if (!preview) {
    return <div className="preview preview--loading">読み込み中…</div>;
  }

  if (preview.kind === 'markdown') {
    return (
      <article
        className="preview preview--markdown"
        // markdown-it(html:false) が生 HTML をエスケープするため注入は無効化済み。
        dangerouslySetInnerHTML={{ __html: markdownHtml }}
      />
    );
  }

  if (preview.kind === 'html') {
    return (
      <iframe
        className="preview preview--html"
        title={rel}
        sandbox="allow-scripts"
        srcDoc={preview.content}
      />
    );
  }

  return (
    <pre className="preview preview--code">
      <code dangerouslySetInnerHTML={{ __html: codeHtml }} />
    </pre>
  );
}
