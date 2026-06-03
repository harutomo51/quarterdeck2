// Phase 1: PTY コア。`pty.rs` のコマンドを登録し、状態を PtyState で管理する。
// Phase 2 で `mod fs_scope;` を追加し、list_dir / read_preview を足していく。

mod pty;

use pty::PtyState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(PtyState::default())
        .invoke_handler(tauri::generate_handler![
            pty::pty_create,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_close,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
