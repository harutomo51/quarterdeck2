// Phase 1: PTY コア / Phase 2: ファイルツリー & プレビュー。
// pty / fs_scope のコマンドを登録し、PtyState / FsRoot を管理する。

mod fs_scope;
mod pty;

use fs_scope::FsRoot;
use pty::PtyState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(PtyState::default())
        .manage(FsRoot::new(
            std::env::current_dir().expect("cwd を取得できません"),
        ))
        .invoke_handler(tauri::generate_handler![
            pty::pty_create,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_close,
            fs_scope::list_dir,
            fs_scope::read_preview,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
