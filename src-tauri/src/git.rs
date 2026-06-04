//! Git Graph / Git Worktree のデータ取得（read-only）。
//!
//! CLAUDE.md の方針に従い、汎用コマンド実行 API は露出させない。**固定引数の専用
//! コマンド**だけを定義し、本物の `git` CLI を `cwd = FsRoot`（= Active Folder, ADR-0001）
//! の repo root で実行して生テキストを返す。パース（グラフ整形 / porcelain）は
//! テスト可能な純粋ロジックとしてフロント（lib/gitGraph.ts, lib/gitWorktree.ts）に置く。

use std::path::{Path, PathBuf};
use std::process::Command;

use serde::Serialize;
use tauri::State;

use crate::fs_scope::FsRoot;

/// git_log の戻り値。`root` はリポジトリ最上位パス（見出し表示用）、`log` は生テキスト。
#[derive(Serialize)]
pub struct GitLog {
    root: String,
    log: String,
}

/// `cwd` を起点に固定引数の git を実行し、stdout を返す。非ゼロ終了は stderr を Err に。
fn run_git(cwd: &Path, args: &[&str]) -> Result<String, String> {
    let mut cmd = Command::new("git");
    cmd.arg("-C").arg(cwd).args(args);

    // Windows では git のサブプロセス起動ごとにコンソールウィンドウが一瞬表示され、
    // Git Graph / Worktree タブを開くたびに画面がちらつく。CREATE_NO_WINDOW を付けて抑止する。
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let out = cmd
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

/// リポジトリ root と `git log` の生テキスト（フィールドは US=0x1f 区切り、最大 300 件）。
/// format は `%H%x1f%P%x1f%an%x1f%ar%x1f%D%x1f%s`（%D = ブランチ/タグ参照）。
///
/// `async` + `spawn_blocking` で git のサブプロセス起動・出力待ちをブロッキングプールへ
/// 逃がす。同期コマンドはメインスレッドで実行され、git 実行中 UI 全体が固まるため。
#[tauri::command]
pub async fn git_log(state: State<'_, FsRoot>) -> Result<GitLog, String> {
    let cwd = state.current();
    tauri::async_runtime::spawn_blocking(move || -> Result<GitLog, String> {
        let root = repo_root(&cwd)?;
        let log = run_git(
            &root,
            &[
                "log",
                "--pretty=format:%H%x1f%P%x1f%an%x1f%ar%x1f%D%x1f%s",
                "--date-order",
                "-n",
                "300",
            ],
        )?;
        Ok(GitLog {
            root: root.to_string_lossy().to_string(),
            log,
        })
    })
    .await
    .map_err(|e| format!("git_log task failed: {e}"))?
}

/// `git worktree list --porcelain` の生テキスト。
///
/// git_log と同様に `spawn_blocking` でメインスレッドを塞がない。
#[tauri::command]
pub async fn git_worktree_list(state: State<'_, FsRoot>) -> Result<String, String> {
    let cwd = state.current();
    tauri::async_runtime::spawn_blocking(move || -> Result<String, String> {
        let root = repo_root(&cwd)?;
        run_git(&root, &["worktree", "list", "--porcelain"])
    })
    .await
    .map_err(|e| format!("git_worktree_list task failed: {e}"))?
}
