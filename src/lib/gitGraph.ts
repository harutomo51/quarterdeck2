/**
 * Git Graph の純粋ロジック（パース + レーン計算）。UI と分離してテスト可能にする。
 *
 * 入力は Rust の git_log コマンドが返す生テキスト。1 行 = 1 コミットで、フィールドは
 * Unit Separator (0x1f) 区切り: `%H<US>%P<US>%an<US>%ar<US>%s`。
 * parents は空白区切り。ここで DAG を縦レーンに割り当て、描画に必要な
 * 「列番号 / 入線のスナップショット」を返す。エッジの斜め配線は MVP では省略する。
 */

export interface Commit {
  hash: string;
  parents: string[];
  author: string;
  /** 相対日時（git の %ar）。 */
  relDate: string;
  subject: string;
}

export interface GraphRow {
  commit: Commit;
  /** このコミットが座る列。 */
  column: number;
  /** この行に入ってくるレーンのスナップショット（列 -> 期待するコミット hash, 空きは null）。 */
  lanes: (string | null)[];
}

/** git log --pretty のフィールド区切り（Unit Separator）。 */
export const FIELD_SEP = '\x1f';

/** git_log の生テキストをコミット配列へ。空行・壊れた行はスキップ。 */
export function parseGitLog(raw: string): Commit[] {
  const out: Commit[] = [];
  for (const line of raw.split('\n')) {
    if (line.trim() === '') continue;
    const [hash, parents, author, relDate, ...rest] = line.split(FIELD_SEP);
    if (!hash) continue;
    out.push({
      hash,
      parents: parents ? parents.split(' ').filter(Boolean) : [],
      author: author ?? '',
      relDate: relDate ?? '',
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
  const lanes: (string | null)[] = [];
  const rows: GraphRow[] = [];

  for (const commit of commits) {
    // このコミットを期待しているレーン（マージ先で複数になりうる）。
    const converging: number[] = [];
    for (let i = 0; i < lanes.length; i += 1) {
      if (lanes[i] === commit.hash) converging.push(i);
    }

    let column: number;
    if (converging.length > 0) {
      column = converging[0];
    } else {
      // どのレーンも待っていない = 新しいブランチ先端。空きレーンへ。
      column = firstEmpty(lanes);
      lanes[column] = commit.hash;
      converging.push(column);
    }

    // 入線スナップショット（親を反映する前の状態）。
    const lanesBefore = [...lanes];

    // 第1親はこのコミットの列を継承。
    lanes[column] = commit.parents[0] ?? null;
    // 収束した他レーンはここで閉じる。
    for (const ci of converging) {
      if (ci !== column) lanes[ci] = null;
    }
    // 追加の親（マージ）は新しいレーンへ。
    for (let p = 1; p < commit.parents.length; p += 1) {
      lanes[firstEmpty(lanes)] = commit.parents[p];
    }
    // 末尾の空きレーンを詰める。
    while (lanes.length > 0 && lanes[lanes.length - 1] === null) lanes.pop();

    rows.push({ commit, column, lanes: lanesBefore });
  }

  return rows;
}

/** 行全体で必要なレーン本数（描画幅の算出用）。 */
export function laneCount(rows: readonly GraphRow[]): number {
  let max = 1;
  for (const r of rows) {
    max = Math.max(max, r.lanes.length, r.column + 1);
  }
  return max;
}
