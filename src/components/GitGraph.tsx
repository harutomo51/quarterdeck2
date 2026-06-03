/**
 * Git Graph パネル。invoke('git_log') の {root, log} を純粋ロジック（lib/gitGraph）で
 * パース + レーン計算し、**グラフ全体を 1 枚の SVG** に描く（行ごとに <g> を translate）。
 * 行を別々の SVG にすると継ぎ目でレーンが途切れるため、必ず単一 SVG にする。
 * 右側に同じ行高のコミット行（ref バッジ + subject）を並べて整列させる。
 * 更新は「マウント時 / cwd 変更イベント / 手動ボタン」（ADR-0001）。
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

interface Edge {
  d: string;
  color: string;
}

const LANE_W = 16;
const ROW_H = 30;
const DOT_R = 4.5;
// レーン（列）ごとの色。列が再利用されても破綻しない範囲で多色化（図に寄せる）。
const LANE_COLORS = [
  '#3fb950',
  '#2dd4bf',
  '#58a6ff',
  '#bc8cff',
  '#f778ba',
  '#e3a72f',
  '#ff7b72',
  '#39c5cf',
];

function laneColor(col: number): string {
  return LANE_COLORS[col % LANE_COLORS.length];
}

function xOf(col: number): number {
  return col * LANE_W + LANE_W / 2;
}

/** (x1,y1)→(x2,y2) を結ぶパス。同一列は直線、列が違えば縦方向の S 字曲線。 */
function edgePath(x1: number, y1: number, x2: number, y2: number): string {
  if (x1 === x2) return `M ${x1} ${y1} L ${x2} ${y2}`;
  const my = (y1 + y2) / 2;
  return `M ${x1} ${y1} C ${x1} ${my}, ${x2} ${my}, ${x2} ${y2}`;
}

/** 1 行ぶんのエッジ（入線の通過/ノードへの収束 + ノードから親への分岐）を組み立てる（行ローカル座標）。 */
function rowEdges(row: GraphRow): Edge[] {
  const edges: Edge[] = [];
  const mid = ROW_H / 2;
  const nodeX = xOf(row.column);

  row.lanesBefore.forEach((hash, col) => {
    if (hash === null) return;
    if (hash === row.commit.hash) {
      // 上から来たレーンがこのノードへ収束。
      edges.push({ d: edgePath(xOf(col), 0, nodeX, mid), color: laneColor(row.column) });
    } else {
      // 通過レーン。出線側の同じ hash の列へ繋ぐ。
      const c2 = row.lanesAfter.indexOf(hash);
      if (c2 !== -1) edges.push({ d: edgePath(xOf(col), 0, xOf(c2), ROW_H), color: laneColor(c2) });
    }
  });

  // ノードから各親へ分岐（第1親は同列で直下、追加の親は別列へ曲線）。
  row.commit.parents.forEach((parent) => {
    const c2 = row.lanesAfter.indexOf(parent);
    if (c2 !== -1) edges.push({ d: edgePath(nodeX, mid, xOf(c2), ROW_H), color: laneColor(c2) });
  });

  return edges;
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
  const totalHeight = rows ? rows.length * ROW_H : 0;

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
        <div className="git-graph">
          <svg
            className="git-graph-canvas"
            width={graphWidth}
            height={totalHeight}
            style={{ flex: `0 0 ${graphWidth}px` }}
            aria-hidden="true"
          >
            {rows.map((row, i) => (
              <g key={row.commit.hash} transform={`translate(0 ${i * ROW_H})`}>
                {rowEdges(row).map((edge, j) => (
                  <path key={j} d={edge.d} stroke={edge.color} strokeWidth={2} fill="none" />
                ))}
                <circle
                  cx={xOf(row.column)}
                  cy={ROW_H / 2}
                  r={DOT_R}
                  fill="var(--bg-base, #0f1115)"
                  stroke={laneColor(row.column)}
                  strokeWidth={2.5}
                />
              </g>
            ))}
          </svg>
          <ul className="git-graph-rows">
            {rows.map((row) => (
              <li key={row.commit.hash} className="git-graph-textrow" title={row.commit.subject}>
                {row.commit.refs.map((ref) => (
                  <span key={ref} className={`git-ref git-ref--${refKind(ref)}`}>
                    {refLabel(ref)}
                  </span>
                ))}
                <span className="git-subject">{row.commit.subject}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
