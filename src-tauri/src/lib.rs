// Phase 1: PTY コア / Phase 2: ファイルツリー & プレビュー / Git Graph・Worktree。
// pty / fs_scope / git のコマンドを登録し、PtyState / FsRoot を管理する。

mod fs_scope;
mod fs_watch;
mod git;
mod pty;

use std::path::PathBuf;

use fs_scope::FsRoot;
use fs_watch::FsWatcher;
use pty::PtyState;
use tauri::Manager;

/// `USERPROFILE`（実在ディレクトリのとき）を優先し、無ければ cwd を採用する純粋ロジック。
/// 副作用（環境変数・FS 参照）と分離してテスト可能にする。
fn pick_initial_dir(userprofile: Option<PathBuf>, cwd: PathBuf) -> PathBuf {
    userprofile.unwrap_or(cwd)
}

/// アプリ起動時の初期ディレクトリ。Windows のユーザープロファイルのルート
/// (`%USERPROFILE%`、例 `C:\Users\<name>`) を基準にし、取得できない／実在しない
/// ときは現在の作業ディレクトリへフォールバックする。`FsRoot` の初期スコープと
/// PTY の起動 cwd の両方の基準として使い、一致させる。
pub(crate) fn initial_dir() -> PathBuf {
    let userprofile = std::env::var_os("USERPROFILE")
        .map(PathBuf::from)
        .filter(|p| p.is_dir());
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    pick_initial_dir(userprofile, cwd)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(PtyState::default())
        .manage(FsRoot::new(initial_dir()))
        .manage(FsWatcher::new())
        .setup(|app| {
            // ファイルツリー自動更新（ADR-0003）: 起動時の FsRoot を初回監視する。
            // 失敗は FsWatcher 内で静かに degrade。
            let root = app.state::<FsRoot>().current();
            app.state::<FsWatcher>().watch(&app.handle().clone(), &root);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            pty::pty_create,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_close,
            pty::pty_focus,
            fs_scope::list_dir,
            fs_scope::read_preview,
            git::git_log,
            git::git_worktree_list,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::pick_initial_dir;
    use std::path::PathBuf;

    #[test]
    fn prefers_userprofile_when_present() {
        let profile = PathBuf::from("C:\\Users\\someone");
        let cwd = PathBuf::from("C:\\dev\\quarterdeck");
        assert_eq!(pick_initial_dir(Some(profile.clone()), cwd), profile);
    }

    #[test]
    fn falls_back_to_cwd_when_userprofile_absent() {
        let cwd = PathBuf::from("C:\\dev\\quarterdeck");
        assert_eq!(pick_initial_dir(None, cwd.clone()), cwd);
    }
}
