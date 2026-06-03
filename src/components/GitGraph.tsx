/**
 * Git Graph パネル。invoke('git_log') の生テキストを純粋ロジック（lib/gitGraph）で
 * パース + レーン計算し、SVG のドット＋色付き縦線で描画する。
 * 更新は「マウント時（=タブアクティブ化）/ cwd 変更イベント / 手動ボタン」（ADR-0001）。
 */
import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { computeGraph, laneCount, parseGitLog, type GraphRow } from '../lib/gitGraph';

const LANE_W = 14;
const ROW_H = 26;
const DOT_R = 4;
const LANE_COLORS = ['#4cc2ff', '#b18cff', '#4ade80', '#fbbf24', '#fb7185', '#38bdf8'];

function laneColor(col: number): string {
  return LANE_COLORS[col % LANE_COLORS.length];
}

export function GitGraph() {
  const [rows, setRows] = useState<GraphRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const raw = await invoke<string>('git_log');
      setRows(computeGraph(parseGitLog(raw)));
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
        <span className="git-panel-title">Git Graph</span>
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
                        opacity={0.5}
                      />
                    ) : null,
                  )}
                  <circle cx={cx} cy={ROW_H / 2} r={DOT_R} fill={laneColor(row.column)} />
                </svg>
                <div className="git-graph-meta">
                  <span className="git-hash">{row.commit.hash.slice(0, 7)}</span>
                  <span className="git-subject">{row.commit.subject}</span>
                  <span className="git-sub">
                    {row.commit.author} · {row.commit.relDate}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
