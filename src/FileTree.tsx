/**
 * Phase 2: ファイルツリー。
 *
 * invoke('list_dir') で FsRoot 配下を 1 階層ずつ遅延ロードする。ディレクトリは
 * クリックで展開、ファイルはクリックでプレビューウィンドウ（preview-*）を開く。
 * スコープ強制は Rust 側 resolve_within が担保するので、ここは表示と橋渡しのみ。
 *
 * 自動更新（ADR-0003）: Rust が FsRoot を FS 監視し `fs://changed { dirs }` を emit する。
 * 各展開中ノードは自身の rel を refresh レジストリに登録し、一致する dir のイベントが来たら
 * その children だけ再取得する。key を name で安定させてあるので、孫ノードの展開状態は
 * React の reconciliation が温存する。cwd 変更（`fs://cwd`）は別ツリー扱いで epoch++ →
 * 全 remount（展開リセット）と振り分ける。
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import {
  ChevronDown,
  ChevronRight,
  File,
  FileArchive,
  FileAudio,
  FileCode,
  FileCog,
  FileImage,
  FileJson,
  FileText,
  FileVideo,
  Folder,
  FolderOpen,
  type LucideIcon,
} from 'lucide-react';
import { buildPreviewUrl, joinRel, previewWindowLabel } from './lib/preview';
import { fileIconKind, type FileIconKind } from './lib/fileIcon';

interface Entry {
  name: string;
  is_dir: boolean;
}

/** rel → そのディレクトリの children 再取得関数。展開中ノードだけが登録する。 */
type RefreshFn = () => void;

interface FsRefresh {
  /** 展開中の dir ノードが自身の rel と再取得関数を登録する。戻り値で解除。 */
  register: (rel: string, fn: RefreshFn) => () => void;
}

const FsRefreshContext = createContext<FsRefresh>({ register: () => () => {} });

const ICON_SIZE = 15;

/** アイコン種別 → lucide コンポーネント。markup/style はコード系として扱う。 */
const KIND_ICON: Readonly<Record<FileIconKind, LucideIcon>> = {
  code: FileCode,
  markup: FileCode,
  style: FileCode,
  json: FileJson,
  markdown: FileText,
  text: FileText,
  image: FileImage,
  archive: FileArchive,
  video: FileVideo,
  audio: FileAudio,
  config: FileCog,
  pdf: FileText,
  file: File,
};

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
  const { register } = useContext(FsRefreshContext);

  // children を再取得して差し替える。key が name 安定なので、孫ノードの展開は React が温存。
  const refetch = useCallback(async () => {
    try {
      const items = await invoke<Entry[]>('list_dir', { rel });
      setChildren(items);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, [rel]);

  // 展開中だけ自身の rel を refresh レジストリに登録（fs://changed の追従先）。
  useEffect(() => {
    if (!isDir || !open) {
      return;
    }
    return register(rel, refetch);
  }, [isDir, open, rel, register, refetch]);

  const onClick = async () => {
    if (!isDir) {
      await openPreview(rel);
      return;
    }
    const next = !open;
    setOpen(next);
    // 開くたびに最新を取得（自動更新の「開く時に新規取得」方針）。
    if (next) {
      await refetch();
    }
  };

  const kind = isDir ? null : fileIconKind(name);
  const FileGlyph = kind ? KIND_ICON[kind] : File;

  return (
    <li>
      <button
        type="button"
        className="tree-row"
        style={{ paddingLeft: `${depth * 14 + 8}px` }}
        onClick={onClick}
      >
        <span className="tree-twisty">
          {isDir &&
            (open ? <ChevronDown size={ICON_SIZE} /> : <ChevronRight size={ICON_SIZE} />)}
        </span>
        <span className="tree-icon" data-kind={isDir ? 'folder' : kind}>
          {isDir ? (
            open ? <FolderOpen size={ICON_SIZE} /> : <Folder size={ICON_SIZE} />
          ) : (
            <FileGlyph size={ICON_SIZE} />
          )}
        </span>
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
  // rel → 再取得関数。展開中ノードが register し、fs://changed の dir で引く（ADR-0003）。
  const registry = useRef<Map<string, RefreshFn>>(new Map());

  const register = useCallback((rel: string, fn: RefreshFn) => {
    registry.current.set(rel, fn);
    return () => {
      // 同一関数のときだけ削除（張り替え後の古い解除で新しい登録を消さない）。
      if (registry.current.get(rel) === fn) {
        registry.current.delete(rel);
      }
    };
  }, []);

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
    // cwd が動いたら別ツリー扱い: epoch++ で全 remount（展開リセット）。
    const unCwd = listen('fs://cwd', () => {
      setEpoch((n) => n + 1);
      load();
    });
    // ディスク変更（ADR-0003）: 影響 dir だけ再取得し展開は保持。root 直下は "" → load()。
    const unChanged = listen<{ dirs: string[] }>('fs://changed', (event) => {
      for (const dir of event.payload.dirs) {
        if (dir === '') {
          load();
        } else {
          registry.current.get(dir)?.();
        }
      }
    });
    return () => {
      void unCwd.then((f) => f());
      void unChanged.then((f) => f());
    };
  }, [load]);

  return (
    <FsRefreshContext.Provider value={{ register }}>
      <nav className="file-tree" aria-label="ファイルツリー">
        <div className="file-tree-title">エクスプローラー</div>
        {error && <div className="tree-error">{error}</div>}
        <ul className="tree-list">
          {roots.map((e) => (
            <TreeNode
              key={`${epoch}:${e.name}`}
              rel={e.name}
              name={e.name}
              isDir={e.is_dir}
              depth={0}
            />
          ))}
        </ul>
      </nav>
    </FsRefreshContext.Provider>
  );
}
