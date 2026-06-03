/**
 * Git Worktree パネル（読み取り専用）。invoke('git_worktree_list') の porcelain を
 * 純粋ロジック（lib/gitWorktree）でパースして一覧表示する。
 * 更新は「マウント時 / cwd 変更イベント / 手動ボタン」（ADR-0001）。変更系操作は持たない。
 */
import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { parseWorktrees, type Worktree } from '../lib/gitWorktree';

function label(wt: Worktree): string {
  if (wt.bare) return 'bare';
  if (wt.detached) return 'detached';
  return wt.branch ?? '(unknown)';
}

export function GitWorktree() {
  const [items, setItems] = useState<Worktree[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const raw = await invoke<string>('git_worktree_list');
      setItems(parseWorktrees(raw));
      setError(null);
    } catch (e) {
      setError(String(e));
      setItems(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const un = listen('fs://cwd', () => void load());
    return () => {
      void un.then((f) => f());
    };
  }, [load]);

  return (
    <div className="git-panel">
      <div className="git-panel-head">
        <span className="git-panel-title">Git Worktree</span>
        <button type="button" className="git-refresh" onClick={() => void load()} aria-label="更新" disabled={loading}>
          ⟳
        </button>
      </div>
      {error && <div className="tree-error">{error}</div>}
      {items && items.length === 0 && !error && <div className="git-empty">ワークツリーがありません</div>}
      {items && items.length > 0 && (
        <ul className="worktree-list">
          {items.map((wt) => (
            <li key={wt.path} className="worktree-row">
              <div className="worktree-top">
                <span className={`worktree-branch${wt.locked ? ' is-locked' : ''}`}>{label(wt)}</span>
                {wt.head && <span className="git-hash">{wt.head.slice(0, 7)}</span>}
                {wt.locked && <span className="worktree-flag">locked</span>}
              </div>
              <div className="worktree-path">{wt.path}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
