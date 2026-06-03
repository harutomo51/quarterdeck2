//! Git Graph / Git Worktree のデータ取得（read-only）。
//!
//! CLAUDE.md の方針に従い、汎用コマンド実行 API は露出させない。**固定引数の専用
//! コマンド**だけを定義し、本物の `git` CLI を `cwd = FsRoot`（= Active Folder, ADR-0001）
//! の repo root で実行して生テキストを返す。パース（グラフ整形 / porcelain）は
//! テスト可能な純粋ロジックとしてフロント（lib/gitGraph.ts, lib/gitWorktree.ts）に置く。

use std::path::{Path, PathBuf};
use std::process::Command;

use tauri::State;

use crate::fs_scope::FsRoot;

/// `cwd` を起点に固定引数の git を実行し、stdout を返す。非ゼロ終了は stderr を Err に。
fn run_git(cwd: &Path, args: &[&str]) -> Result<String, String> {
    let out = Command::new("git")
        .arg("-C")
        .arg(cwd)
        .args(args)
        .output()
        .map_err(|e| format!("failed to run git: {e}"))?;
    if !out.status.success() {
        let msg = String::from_utf8_lossy(&out.stderr).trim().to_string();
        return Err(if msg.is_empty() {
            "git command failed".into()
        } else {
            msg
        });
    }
    Ok(String::from_utf8_lossy(&out.stdout).to_string())
}

/// 現在の cwd から repo の最上位（toplevel）を解決する。非 git なら Err。
fn repo_root(cwd: &Path) -> Result<PathBuf, String> {
    let top = run_git(cwd, &["rev-parse", "--show-toplevel"])?;
    let top = top.trim();
    if top.is_empty() {
        return Err("not a git repository".into());
    }
    Ok(PathBuf::from(top))
}

/// `git log` の生テキスト（フィールドは US=0x1f 区切り、最大 300 件）。
#[tauri::command]
pub fn git_log(state: State<FsRoot>) -> Result<String, String> {
    let root = repo_root(&state.current())?;
    run_git(
        &root,
        &[
            "log",
            "--pretty=format:%H%x1f%P%x1f%an%x1f%ar%x1f%s",
            "--date-order",
            "-n",
            "300",
        ],
    )
}

/// `git worktree list --porcelain` の生テキスト。
#[tauri::command]
pub fn git_worktree_list(state: State<FsRoot>) -> Result<String, String> {
    let root = repo_root(&state.current())?;
    run_git(&root, &["worktree", "list", "--porcelain"])
}
