/**
 * Phase 2: ファイルツリー。
 *
 * invoke('list_dir') で FsRoot 配下を 1 階層ずつ遅延ロードする。ディレクトリは
 * クリックで展開、ファイルはクリックでプレビューウィンドウ（preview-*）を開く。
 * スコープ強制は Rust 側 resolve_within が担保するので、ここは表示と橋渡しのみ。
 */
import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { buildPreviewUrl, joinRel, previewWindowLabel } from './lib/preview';

interface Entry {
  name: string;
  is_dir: boolean;
}

async function openPreview(rel: string): Promise<void> {
  const label = previewWindowLabel(rel);
  // 既に開いていればフォーカス、無ければ新規生成。
  const existing = await WebviewWindow.getByLabel(label);
  if (existing) {
    await existing.setFocus();
    return;
  }
  const win = new WebviewWindow(label, {
    url: buildPreviewUrl(rel),
    title: rel,
    width: 820,
    height: 640,
  });
  win.once('tauri://error', (e) => {
    console.error('failed to open preview window', e);
  });
}

interface TreeNodeProps {
  rel: string;
  name: string;
  isDir: boolean;
  depth: number;
}

function TreeNode({ rel, name, isDir, depth }: TreeNodeProps) {
  const [open, setOpen] = useState(false);
  const [children, setChildren] = useState<Entry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onClick = async () => {
    if (!isDir) {
      await openPreview(rel);
      return;
    }
    if (!open && children === null) {
      try {
        const items = await invoke<Entry[]>('list_dir', { rel });
        setChildren(items);
      } catch (e) {
        setError(String(e));
      }
    }
    setOpen((v) => !v);
  };

  return (
    <li>
      <button
        type="button"
        className="tree-row"
        style={{ paddingLeft: `${depth * 14 + 8}px` }}
        onClick={onClick}
      >
        <span className="tree-icon">{isDir ? (open ? '▾' : '▸') : '·'}</span>
        <span className="tree-name">{name}</span>
      </button>
      {error && <div className="tree-error">{error}</div>}
      {isDir && open && children && (
        <ul className="tree-list">
          {children.map((c) => (
            <TreeNode
              key={c.name}
              rel={joinRel(rel, c.name)}
              name={c.name}
              isDir={c.is_dir}
              depth={depth + 1}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

export function FileTree() {
  const [roots, setRoots] = useState<Entry[]>([]);
  const [error, setError] = useState<string | null>(null);
  // cwd 追従で根が切り替わるたびに増やし、配下ノードを remount して展開状態を破棄する。
  const [epoch, setEpoch] = useState(0);

  const load = useCallback(() => {
    invoke<Entry[]>('list_dir', {})
      .then((items) => {
        setRoots(items);
        setError(null);
      })
      .catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    load();
    // ターミナルの cwd が動いたら根を再取得（FsRoot は Rust 側で追従済み）。
    const un = listen('fs://cwd', () => {
      setEpoch((n) => n + 1);
      load();
    });
    return () => {
      void un.then((f) => f());
    };
  }, [load]);

  return (
    <nav className="file-tree" aria-label="ファイルツリー">
      <div className="file-tree-title">エクスプローラー</div>
      {error && <div className="tree-error">{error}</div>}
      <ul className="tree-list">
        {roots.map((e) => (
          <TreeNode key={`${epoch}:${e.name}`} rel={e.name} name={e.name} isDir={e.is_dir} depth={0} />
        ))}
      </ul>
    </nav>
  );
}
