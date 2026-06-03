//! PTY コア（Phase 1）。
//!
//! `node-pty` 相当を `portable-pty` で実装する。reader はブロッキングなので
//! 別スレッドで回し、出力は base64 にして `pty://data` イベントで renderer へ送る
//! （マルチバイト境界の分割に強い）。状態は `id -> PtySession` の `HashMap` で持ち、
//! 将来の「タブごとの PTY 管理」へそのまま伸ばせる。
//!
//! シェルは PowerShell 7（`pwsh`）優先、無ければ `powershell.exe` にフォールバックし、
//! **他のシェルは許可しない**（CLAUDE.md の変更ルール）。

use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Mutex;
use std::thread;

use base64::Engine;
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

pub struct PtySession {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn portable_pty::Child + Send + Sync>,
}

#[derive(Default)]
pub struct PtyState {
    pub sessions: Mutex<HashMap<String, PtySession>>,
}

#[derive(Clone, Serialize)]
struct PtyOutput {
    id: String,
    data: String, // base64
}

#[derive(Clone, Serialize)]
struct PtyExit {
    id: String,
}

/// 起動するシェルの実行ファイル名を決める。
///
/// 副作用（`which` 探索）と分離してテスト可能にするための純粋関数。
/// `pwsh`（PowerShell 7）があればそれを、無ければ Windows 標準の
/// `powershell.exe` を返す。**他のシェルへは決して切り替えない。**
fn shell_program(pwsh_available: bool) -> &'static str {
    if pwsh_available {
        "pwsh.exe"
    } else {
        "powershell.exe"
    }
}

fn resolve_shell() -> CommandBuilder {
    let prog = shell_program(which::which("pwsh").is_ok());
    let mut cmd = CommandBuilder::new(prog);
    // 起動ディレクトリを引き継ぐ（FsRoot の基準と一致させる）。
    if let Ok(cwd) = std::env::current_dir() {
        cmd.cwd(cwd);
    }
    cmd
}

#[tauri::command]
pub fn pty_create(
    id: String,
    cols: u16,
    rows: u16,
    app: AppHandle,
    state: State<PtyState>,
) -> Result<(), String> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;

    let child = pair
        .slave
        .spawn_command(resolve_shell())
        .map_err(|e| e.to_string())?;
    drop(pair.slave); // master が EOF を受け取れるよう slave は破棄

    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

    // 出力読み取り（ブロッキング read を別スレッドで）。
    let app_t = app.clone();
    let id_t = id.clone();
    thread::spawn(move || {
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => {
                    let _ = app_t.emit("pty://exit", PtyExit { id: id_t.clone() });
                    break;
                }
                Ok(n) => {
                    let data = base64::engine::general_purpose::STANDARD.encode(&buf[..n]);
                    let _ = app_t.emit(
                        "pty://data",
                        PtyOutput {
                            id: id_t.clone(),
                            data,
                        },
                    );
                }
            }
        }
    });

    state.sessions.lock().map_err(|e| e.to_string())?.insert(
        id,
        PtySession {
            master: pair.master,
            writer,
            child,
        },
    );
    Ok(())
}

#[tauri::command]
pub fn pty_write(id: String, data: String, state: State<PtyState>) -> Result<(), String> {
    let mut s = state.sessions.lock().map_err(|e| e.to_string())?;
    let sess = s.get_mut(&id).ok_or("session not found")?;
    sess.writer
        .write_all(data.as_bytes())
        .map_err(|e| e.to_string())?;
    sess.writer.flush().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn pty_resize(id: String, cols: u16, rows: u16, state: State<PtyState>) -> Result<(), String> {
    let s = state.sessions.lock().map_err(|e| e.to_string())?;
    let sess = s.get(&id).ok_or("session not found")?;
    sess.master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn pty_close(id: String, state: State<PtyState>) -> Result<(), String> {
    if let Some(mut sess) = state
        .sessions
        .lock()
        .map_err(|e| e.to_string())?
        .remove(&id)
    {
        // 注意（スコープ文書 §11）: child.kill() が pwsh の孫プロセスまで
        // 確実に終了させるとは限らない。アプリ終了後のプロセス残存は
        // Windows 11 上で要目視検証。残存が出るなら Job Object でツリーごと
        // 束ねる対策を検討する。
        let _ = sess.child.kill();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::shell_program;

    #[test]
    fn prefers_pwsh_when_available() {
        assert_eq!(shell_program(true), "pwsh.exe");
    }

    #[test]
    fn falls_back_to_windows_powershell_when_pwsh_absent() {
        assert_eq!(shell_program(false), "powershell.exe");
    }
}
