/**
 * Git Graph の純粋ロジック（パース + レーン計算）。UI と分離してテスト可能にする。
 *
 * 入力は Rust の git_log コマンドが返す生テキスト。1 行 = 1 コミットで、フィールドは
 * Unit Separator (0x1f) 区切り: `%H<US>%P<US>%an<US>%ar<US>%D<US>%s`。
 * parents は空白区切り、refs（%D）は ", " 区切り（"HEAD -> main", "origin/main", "tag: v1"）。
 * ここで DAG を縦レーンに割り当て、描画に必要な「列番号 / 入線のスナップショット」を返す。
 */

export type RefKind = 'head' | 'remote' | 'tag' | 'branch';

export interface Commit {
  hash: string;
  parents: string[];
  author: string;
  /** 相対日時（git の %ar）。 */
  relDate: string;
  /** ブランチ/タグ参照（git の %D）。"HEAD -> main" / "origin/main" / "tag: v1" など。 */
  refs: string[];
  subject: string;
}

/** 行内の 1 本のエッジ。座標は「列」と「行内縦位置（0=上端, 0.5=ノード, 1=下端）」で持つ。 */
export interface GraphEdge {
  fromCol: number;
  toCol: number;
  y1: number;
  y2: number;
  /** 色に使う列インデックス（laneColor の引数）。 */
  colorCol: number;
}

export interface GraphRow {
  commit: Commit;
  /** このコミットが座る列。 */
  column: number;
  /** この行に描くエッジ（通過/ノードへの収束/ノードから親への分岐）。列が確定済みなので連続する。 */
  edges: GraphEdge[];
  /** 行の上端に入ってくるレーン（列 -> 期待するコミット hash, 空きは null）。幅算出/継続性の基準。 */
  lanesBefore: (string | null)[];
  /** 行の下端へ出ていくレーン（次行の lanesBefore と一致）。 */
  lanesAfter: (string | null)[];
}

/** git log --pretty のフィールド区切り（Unit Separator）。 */
export const FIELD_SEP = '\x1f';

/** ref の種別を判定する（バッジの色分け用）。 */
export function refKind(ref: string): RefKind {
  if (ref.startsWith('HEAD ->') || ref === 'HEAD') return 'head';
  if (ref.startsWith('tag:')) return 'tag';
  if (ref.includes('/')) return 'remote';
  return 'branch';
}

/** バッジに表示する ref ラベル（"tag: " 接頭辞だけ剥がす）。 */
export function refLabel(ref: string): string {
  return ref.startsWith('tag:') ? ref.slice('tag:'.length).trim() : ref;
}

/** git_log の生テキストをコミット配列へ。空行・壊れた行はスキップ。 */
export function parseGitLog(raw: string): Commit[] {
  const out: Commit[] = [];
  for (const line of raw.split('\n')) {
    if (line.trim() === '') continue;
    const [hash, parents, author, relDate, refs, ...rest] = line.split(FIELD_SEP);
    if (!hash) continue;
    out.push({
      hash,
      parents: parents ? parents.split(' ').filter(Boolean) : [],
      author: author ?? '',
      relDate: relDate ?? '',
      refs: refs ? refs.split(', ').map((r) => r.trim()).filter(Boolean) : [],
      // subject に US は出ないが、保険で残余を結合。
      subject: rest.join(FIELD_SEP),
    });
  }
  return out;
}

function firstEmpty(lanes: (string | null)[]): number {
  const idx = lanes.indexOf(null);
  return idx === -1 ? lanes.length : idx;
}

/**
 * コミット列（子が先・親が後の順）をレーンに割り当てる。
 * 各コミットの列番号と、その行に入ってくるレーン構成を返す。
 */
export function computeGraph(commits: readonly Commit[]): GraphRow[] {
  // 出ていくレーン状態（= 次に来るコミットを期待する hash）。次行の入線にもなる。
  const lanes: (string | null)[] = [];
  const rows: GraphRow[] = [];

  for (const commit of commits) {
    // 入線スナップショット（このコミットを処理する前の状態）。新規先端は列を持たない。
    const lanesBefore = [...lanes];

    // このコミットを期待しているレーン（マージ先で複数になりうる）。
    const converging: number[] = [];
    for (let i = 0; i < lanes.length; i += 1) {
      if (lanes[i] === commit.hash) converging.push(i);
    }

    // 収束レーンの最左に座る。無ければ新しいブランチ先端として空きレーンへ。
    const column = converging.length > 0 ? converging[0] : firstEmpty(lanes);

    // 収束した全レーンを一旦閉じる（あとで親を置き直す）。
    for (const ci of converging) lanes[ci] = null;

    // 親を列に割り当てる。既に同じ親を待つレーンがあれば**再利用**（重複レーンを作らない）。
    const parentCols: number[] = [];
    commit.parents.forEach((parent, idx) => {
      let pc = lanes.indexOf(parent);
      if (pc === -1) {
        pc = idx === 0 ? column : firstEmpty(lanes);
        lanes[pc] = parent;
      }
      parentCols.push(pc);
    });

    // 末尾の空きレーンを詰める（列インデックスは保つので接続には影響しない）。
    while (lanes.length > 0 && lanes[lanes.length - 1] === null) lanes.pop();

    // エッジを列確定済みで組み立てる（レンダラでの indexOf 推測を排し、重複ハッシュでも欠落しない）。
    const edges: GraphEdge[] = [];
    lanesBefore.forEach((hash, c) => {
      if (hash === null) return;
      if (hash === commit.hash) {
        // 上から来たレーンがノードへ収束（上端 -> ノード）。
        edges.push({ fromCol: c, toCol: column, y1: 0, y2: 0.5, colorCol: column });
      } else {
        // 通過レーンは同じ列を維持（上端 -> 下端の直線）。
        edges.push({ fromCol: c, toCol: c, y1: 0, y2: 1, colorCol: c });
      }
    });
    // ノードから各親へ（ノード -> 下端）。
    parentCols.forEach((pc) => {
      edges.push({ fromCol: column, toCol: pc, y1: 0.5, y2: 1, colorCol: pc });
    });

    rows.push({ commit, column, edges, lanesBefore, lanesAfter: [...lanes] });
  }

  return rows;
}

/** 行全体で必要なレーン本数（描画幅の算出用）。 */
export function laneCount(rows: readonly GraphRow[]): number {
  let max = 1;
  for (const r of rows) {
    max = Math.max(max, r.lanesBefore.length, r.lanesAfter.length, r.column + 1);
  }
  return max;
}
