/**
 * Git Graph パネル。invoke('git_log') の {root, log} を純粋ロジック（lib/gitGraph）で
 * パース + レーン計算し、SVG のリングドット＋色付き縦線で描画する。先頭には
 * ブランチ/タグの ref バッジ（HEAD→ 黄 / remote 緑 / tag 水 / branch 青）を出す。
 * 更新は「マウント時（=タブアクティブ化）/ cwd 変更イベント / 手動ボタン」（ADR-0001）。
 */
import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import {
  computeGraph,
  laneCount,
  parseGitLog,
  refKind,
  refLabel,
  type GraphRow,
} from '../lib/gitGraph';

interface GitLog {
  root: string;
  log: string;
}

const LANE_W = 16;
const ROW_H = 30;
const DOT_R = 4.5;
// レーン 0 はアンバー基調。分岐レーンは色を巡回。
const LANE_COLORS = ['#e0a82e', '#4cc2ff', '#b18cff', '#4ade80', '#fb7185', '#38bdf8'];

function laneColor(col: number): string {
  return LANE_COLORS[col % LANE_COLORS.length];
}

export function GitGraph() {
  const [rows, setRows] = useState<GraphRow[] | null>(null);
  const [root, setRoot] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await invoke<GitLog>('git_log');
      setRoot(res.root);
      setRows(computeGraph(parseGitLog(res.log)));
      setError(null);
    } catch (e) {
      setError(String(e));
      setRows(null);
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

  const lanes = rows ? laneCount(rows) : 1;
  const graphWidth = lanes * LANE_W;

  return (
    <div className="git-panel">
      <div className="git-panel-head">
        <div className="git-panel-heading">
          <span className="git-panel-title">Git Graph</span>
          {root && <span className="git-panel-path">{root}</span>}
        </div>
        <button type="button" className="git-refresh" onClick={() => void load()} aria-label="更新" disabled={loading}>
          ⟳
        </button>
      </div>
      {error && <div className="tree-error">{error}</div>}
      {rows && rows.length === 0 && !error && <div className="git-empty">コミットがありません</div>}
      {rows && rows.length > 0 && (
        <ul className="git-graph-list">
          {rows.map((row) => {
            const cx = row.column * LANE_W + LANE_W / 2;
            return (
              <li key={row.commit.hash} className="git-graph-row" title={row.commit.subject}>
                <svg className="git-graph-svg" width={graphWidth} height={ROW_H} aria-hidden="true">
                  {row.lanes.map((laneHash, col) =>
                    laneHash !== null ? (
                      <line
                        key={col}
                        x1={col * LANE_W + LANE_W / 2}
                        y1={0}
                        x2={col * LANE_W + LANE_W / 2}
                        y2={ROW_H}
                        stroke={laneColor(col)}
                        strokeWidth={2}
                        opacity={0.85}
                      />
                    ) : null,
                  )}
                  <circle
                    cx={cx}
                    cy={ROW_H / 2}
                    r={DOT_R}
                    fill="var(--bg-base, #0f1115)"
                    stroke={laneColor(row.column)}
                    strokeWidth={2.5}
                  />
                </svg>
                <div className="git-graph-meta">
                  {row.commit.refs.map((ref) => (
                    <span key={ref} className={`git-ref git-ref--${refKind(ref)}`}>
                      {refLabel(ref)}
                    </span>
                  ))}
                  <span className="git-subject">{row.commit.subject}</span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
