//! PTY コア（Phase 1）+ cwd 追従（ADR-0001）。
//!
//! `node-pty` 相当を `portable-pty` で実装する。reader はブロッキングなので
//! 別スレッドで回し、出力は base64 にして `pty://data` イベントで renderer へ送る
//! （マルチバイト境界の分割に強い）。状態は `id -> PtySession` の `HashMap` で持つ。
//!
//! シェルは PowerShell 7（`pwsh`）優先、無ければ `powershell.exe` にフォールバックし、
//! **他のシェルは許可しない**（CLAUDE.md の変更ルール）。
//!
//! cwd 追従（ADR-0001）: spawn 時に `-NoExit -Command` で既存 `prompt` をラップし、
//! 毎プロンプトで OSC 9;9 として `$PWD` を吐かせる。reader が**信頼できる PTY
//! ストリーム**から cwd を抽出して `FsRoot` を更新し、`fs://cwd` を emit する。
//! バイト列は xterm にそのまま流す（未知 OSC は xterm 側で無視される）。
//! `powershell.exe` 5.1 でも動くよう、エスケープは `[char]27` で組む（`` `e `` 不可）。

use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::thread;

use base64::Engine;
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::fs_scope::FsRoot;
use crate::fs_watch::FsWatcher;

pub struct PtySession {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn portable_pty::Child + Send + Sync>,
}

#[derive(Default)]
pub struct PtyState {
    pub sessions: Mutex<HashMap<String, PtySession>>,
    /// id ごとの最後に観測した cwd（ADR-0002: FsRoot 追従元と新ペイン継承の源）。
    pub cwds: Mutex<HashMap<String, PathBuf>>,
    /// 今フォーカス中の Pane の id（FsRoot を駆動する 1 枚）。
    pub focused: Mutex<Option<String>>,
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

#[derive(Clone, Serialize)]
struct CwdChanged {
    path: String,
}

/// 各プロンプトで OSC 9;9（`ESC ] 9 ; 9 ; <cwd> BEL`）を吐くよう `prompt` をラップする
/// 注入スクリプト。profile ロード後に実行されるため、ユーザー既存 prompt を捕捉して
/// 最後に呼ぶ（壊さない）。`$LASTEXITCODE` を保存・復元し、エスケープは `[char]` で
/// 組んで pwsh / powershell.exe 5.1 双方で動かす。二重引用符は使わない（引数クォート単純化）。
const PROMPT_INJECT: &str = "$global:__qd_op=$function:prompt; function global:prompt { $__qd_l=$LASTEXITCODE; $p=(Get-Location).ProviderPath; [Console]::Write([char]27 + ']9;9;' + $p + [char]7); $global:LASTEXITCODE=$__qd_l; if($global:__qd_op){ & $global:__qd_op } else { 'PS ' + $p + '> ' } }";

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

fn resolve_shell(cwd: PathBuf) -> CommandBuilder {
    let prog = shell_program(which::which("pwsh").is_ok());
    let mut cmd = CommandBuilder::new(prog);
    // prompt をラップして OSC 9;9 を吐かせつつ、対話 REPL を維持（-NoExit）。
    cmd.arg("-NoExit");
    cmd.arg("-Command");
    cmd.arg(PROMPT_INJECT);
    // 起動ディレクトリ（ADR-0002: 分割時は継承元 cwd、それ以外は initial_dir）。
    cmd.cwd(cwd);
    cmd
}

/// 新ペインの spawn 先 cwd を選ぶ（ADR-0002）。継承元 cwd があればそれ、無ければ fallback。
fn spawn_cwd(inherited: Option<PathBuf>, fallback: PathBuf) -> PathBuf {
    inherited.unwrap_or(fallback)
}

/// フォーカス中ペインの cwd を引く（ADR-0002 の FsRoot 追従元）。
fn focused_cwd<'a>(
    cwds: &'a HashMap<String, PathBuf>,
    focused: Option<&str>,
) -> Option<&'a PathBuf> {
    focused.and_then(|id| cwds.get(id))
}

const OSC_PREFIX: &[u8] = b"\x1b]9;9;";

fn find_subslice(hay: &[u8], needle: &[u8]) -> Option<usize> {
    if needle.is_empty() || hay.len() < needle.len() {
        return None;
    }
    hay.windows(needle.len()).position(|w| w == needle)
}

/// OSC 終端（BEL=0x07 か ST=`ESC \`）を探し、(開始位置, 終端長) を返す。
/// 末尾に途中の ESC が残る場合は未完として None。
fn find_terminator(b: &[u8]) -> Option<(usize, usize)> {
    let mut i = 0;
    while i < b.len() {
        match b[i] {
            0x07 => return Some((i, 1)),
            0x1b => {
                if i + 1 >= b.len() {
                    return None; // ST 途中。続きを待つ。
                }
                if b[i + 1] == 0x5c {
                    return Some((i, 2));
                }
            }
            _ => {}
        }
        i += 1;
    }
    None
}

fn keep_tail(buf: &mut Vec<u8>, k: usize) {
    if buf.len() > k {
        let cut = buf.len() - k;
        buf.drain(..cut);
    }
}

/// `chunk`（前回の残り `carry` に連結）から OSC 9;9 の cwd を抽出する。
///
/// 完結したシーケンスのうち**最後の** cwd を返す。未完の途中シーケンスは `carry` に残し、
/// 次の read と合わせて再評価する（チャンク境界での分割に強い）。`carry` はメモリ上限を持つ。
fn extract_cwd(carry: &mut Vec<u8>, chunk: &[u8]) -> Option<String> {
    carry.extend_from_slice(chunk);
    let mut result: Option<String> = None;

    loop {
        let Some(start) = find_subslice(carry, OSC_PREFIX) else {
            // プレフィックスが分割されている可能性に備え、末尾だけ残す。
            keep_tail(carry, OSC_PREFIX.len().saturating_sub(1));
            break;
        };
        let after = start + OSC_PREFIX.len();
        match find_terminator(&carry[after..]) {
            Some((end, term_len)) => {
                if let Ok(s) = std::str::from_utf8(&carry[after..after + end]) {
                    if !s.is_empty() {
                        result = Some(s.to_string());
                    }
                }
                let consumed = after + end + term_len;
                carry.drain(..consumed);
            }
            None => {
                // 未完。start 以前は捨ててメモリを抑え、続きを待つ。
                carry.drain(..start);
                if carry.len() > 8192 {
                    carry.clear();
                }
                break;
            }
        }
    }

    result
}

#[tauri::command]
pub fn pty_create(
    id: String,
    cols: u16,
    rows: u16,
    inherit_cwd_from: Option<String>,
    app: AppHandle,
    state: State<PtyState>,
) -> Result<(), String> {
    // 継承元（Focused Pane）の cwd を id 経由で引く（ADR-0002: renderer はパスを渡さない）。
    let inherited = inherit_cwd_from.and_then(|from| {
        state
            .cwds
            .lock()
            .ok()
            .and_then(|cwds| cwds.get(&from).cloned())
    });
    let cwd = spawn_cwd(inherited, crate::initial_dir());

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
        .spawn_command(resolve_shell(cwd))
        .map_err(|e| e.to_string())?;
    drop(pair.slave); // master が EOF を受け取れるよう slave は破棄

    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

    // 出力読み取り（ブロッキング read を別スレッドで）。
    let app_t = app.clone();
    let id_t = id.clone();
    thread::spawn(move || {
        let mut buf = [0u8; 8192];
        let mut carry: Vec<u8> = Vec::new();
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => {
                    let _ = app_t.emit("pty://exit", PtyExit { id: id_t.clone() });
                    break;
                }
                Ok(n) => {
                    // バイト列はそのまま xterm へ流す（OSC を含め未加工）。
                    let data = base64::engine::general_purpose::STANDARD.encode(&buf[..n]);
                    let _ = app_t.emit(
                        "pty://data",
                        PtyOutput {
                            id: id_t.clone(),
                            data,
                        },
                    );
                    // 信頼できる PTY ストリームから cwd を抽出（ADR-0002）。id ごとに
                    // 保持し、**フォーカス中ペインのときだけ** FsRoot を追従させる。
                    if let Some(cwd) = extract_cwd(&mut carry, &buf[..n]) {
                        let pty_state = app_t.state::<PtyState>();
                        if let Ok(mut cwds) = pty_state.cwds.lock() {
                            cwds.insert(id_t.clone(), PathBuf::from(&cwd));
                        }
                        let is_focused = pty_state
                            .focused
                            .lock()
                            .map(|f| f.as_deref() == Some(id_t.as_str()))
                            .unwrap_or(false);
                        if is_focused {
                            let fs = app_t.state::<FsRoot>();
                            if fs.set(Path::new(&cwd)) {
                                // FsRoot が動いたら FS watcher も追従させる（ADR-0003）。
                                let new_root = fs.current();
                                let _ = app_t.emit("fs://cwd", CwdChanged { path: cwd });
                                app_t.state::<FsWatcher>().watch(&app_t, &new_root);
                            }
                        }
                    }
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

/// フォーカス中ペインを切り替える（ADR-0002）。renderer は id だけを渡し、Rust が
/// その id の保持 cwd を FsRoot に採用して `fs://cwd` を emit する（パスは渡さない）。
#[tauri::command]
pub fn pty_focus(id: String, app: AppHandle, state: State<PtyState>) -> Result<(), String> {
    *state.focused.lock().map_err(|e| e.to_string())? = Some(id.clone());
    let cwd = {
        let cwds = state.cwds.lock().map_err(|e| e.to_string())?;
        focused_cwd(&cwds, Some(&id)).cloned()
    };
    if let Some(cwd) = cwd {
        let fs = app.state::<FsRoot>();
        if fs.set(&cwd) {
            // フォーカス移動で FsRoot が動いたら FS watcher も追従させる（ADR-0003）。
            let new_root = fs.current();
            if let Some(path) = cwd.to_str() {
                let _ = app.emit(
                    "fs://cwd",
                    CwdChanged {
                        path: path.to_string(),
                    },
                );
            }
            app.state::<FsWatcher>().watch(&app, &new_root);
        }
    }
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
    // cwd 保持と focused 参照を後始末（ADR-0002）。
    if let Ok(mut cwds) = state.cwds.lock() {
        cwds.remove(&id);
    }
    if let Ok(mut focused) = state.focused.lock() {
        if focused.as_deref() == Some(id.as_str()) {
            *focused = None;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{extract_cwd, focused_cwd, shell_program, spawn_cwd};
    use std::collections::HashMap;
    use std::path::PathBuf;

    #[test]
    fn spawn_cwd_inherits_from_the_source_pane_when_present() {
        let fallback = PathBuf::from("C:\\fallback");
        assert_eq!(
            spawn_cwd(Some(PathBuf::from("C:\\proj")), fallback),
            PathBuf::from("C:\\proj")
        );
    }

    #[test]
    fn spawn_cwd_falls_back_when_the_source_cwd_is_unknown() {
        let fallback = PathBuf::from("C:\\fallback");
        assert_eq!(spawn_cwd(None, fallback.clone()), fallback);
    }

    #[test]
    fn focused_cwd_returns_the_focused_panes_cwd() {
        let mut cwds = HashMap::new();
        cwds.insert("a".to_string(), PathBuf::from("C:\\a"));
        cwds.insert("b".to_string(), PathBuf::from("C:\\b"));
        assert_eq!(focused_cwd(&cwds, Some("b")), Some(&PathBuf::from("C:\\b")));
    }

    #[test]
    fn focused_cwd_is_none_when_unfocused_or_missing() {
        let cwds: HashMap<String, PathBuf> = HashMap::new();
        assert_eq!(focused_cwd(&cwds, None), None);
        assert_eq!(focused_cwd(&cwds, Some("x")), None);
    }

    #[test]
    fn prefers_pwsh_when_available() {
        assert_eq!(shell_program(true), "pwsh.exe");
    }

    #[test]
    fn falls_back_to_windows_powershell_when_pwsh_absent() {
        assert_eq!(shell_program(false), "powershell.exe");
    }

    #[test]
    fn extracts_cwd_from_a_bel_terminated_osc() {
        let mut carry = Vec::new();
        let input = b"some output\x1b]9;9;C:\\dev\\quarterdeck\x07PS> ";
        assert_eq!(
            extract_cwd(&mut carry, input),
            Some("C:\\dev\\quarterdeck".to_string())
        );
    }

    #[test]
    fn extracts_cwd_from_an_st_terminated_osc() {
        let mut carry = Vec::new();
        let input = b"\x1b]9;9;/home/u\x1b\\rest";
        assert_eq!(extract_cwd(&mut carry, input), Some("/home/u".to_string()));
    }

    #[test]
    fn returns_the_last_cwd_when_multiple_present() {
        let mut carry = Vec::new();
        let input = b"\x1b]9;9;A\x07\x1b]9;9;B\x07";
        assert_eq!(extract_cwd(&mut carry, input), Some("B".to_string()));
    }

    #[test]
    fn reassembles_a_sequence_split_across_chunks() {
        let mut carry = Vec::new();
        assert_eq!(extract_cwd(&mut carry, b"\x1b]9;9;C:\\de"), None);
        assert_eq!(
            extract_cwd(&mut carry, b"v\x07"),
            Some("C:\\dev".to_string())
        );
    }

    #[test]
    fn ignores_a_stream_without_osc() {
        let mut carry = Vec::new();
        assert_eq!(extract_cwd(&mut carry, b"plain text, no escape"), None);
    }
}
