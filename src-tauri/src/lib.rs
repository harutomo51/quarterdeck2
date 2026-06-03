// Phase 0: 足場のみ。main ウィンドウが空で起動することを確認する。
// Phase 1 で `mod pty;`、Phase 2 で `mod fs_scope;` を追加し、
// `.manage(...)` と `.invoke_handler(...)` にコマンドを登録していく。

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
