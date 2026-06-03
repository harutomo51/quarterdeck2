/**
 * Git Worktree 一覧の純粋ロジック（porcelain パース）。UI と分離してテスト可能にする。
 *
 * 入力は Rust の git_worktree_list が返す `git worktree list --porcelain` の生テキスト。
 * 各ワークツリーは空行区切りのレコードで、行頭ラベルで属性を表す:
 *   worktree <path> / HEAD <sha> / branch <ref> / bare / detached / locked [reason]
 */

export interface Worktree {
  path: string;
  /** 短縮ブランチ名（refs/heads/ を剥がす）。detached / bare では undefined。 */
  branch?: string;
  /** HEAD のコミット SHA。bare では undefined。 */
  head?: string;
  bare: boolean;
  detached: boolean;
  locked: boolean;
}

function shortBranch(ref: string): string {
  return ref.startsWith('refs/heads/') ? ref.slice('refs/heads/'.length) : ref;
}

/** porcelain テキストを Worktree 配列へ。空レコードはスキップ。 */
export function parseWorktrees(raw: string): Worktree[] {
  const out: Worktree[] = [];
  for (const block of raw.split(/\n\s*\n/)) {
    let path: string | null = null;
    let branch: string | undefined;
    let head: string | undefined;
    let bare = false;
    let detached = false;
    let locked = false;

    for (const line of block.split('\n')) {
      const trimmed = line.trimEnd();
      if (trimmed.startsWith('worktree ')) path = trimmed.slice('worktree '.length);
      else if (trimmed.startsWith('HEAD ')) head = trimmed.slice('HEAD '.length);
      else if (trimmed.startsWith('branch ')) branch = shortBranch(trimmed.slice('branch '.length));
      else if (trimmed === 'bare') bare = true;
      else if (trimmed === 'detached') detached = true;
      else if (trimmed === 'locked' || trimmed.startsWith('locked ')) locked = true;
    }

    if (path) out.push({ path, branch, head, bare, detached, locked });
  }
  return out;
}
