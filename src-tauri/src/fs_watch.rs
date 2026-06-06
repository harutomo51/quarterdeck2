//! ファイルツリーの自動更新（ADR-0003）。
//!
//! `notify` で `FsRoot` を再帰監視し、変更を ~300ms デバウンスして
//! `fs://changed { dirs }` を renderer へ emit する。renderer はその rel に一致する
//! 展開中ノードの children だけ再取得する（展開状態は React が温存）。
//!
//! **watcher は `FsRoot` に追従する可動監視**（ADR-0001/0002 の系譜）。`FsRoot.set()` が
//! true を返した直後（pty reader の cwd 追従 / `pty_focus`）に旧 root を unwatch・新 root を
//! watch し直す。デバウンス窓に残った旧 root 由来イベントは `affected_dirs` の root 相対化で
//! 落ちる（stale 破棄）。EXCLUDE 配下は `affected_dirs` 側で間引く（`fs_scope` と同じ定数）。
//!
//! degrade（ADR-0003）: 監視の生成・watch 失敗は stderr ログのみで握りつぶし、ツリーは
//! 従来通り cwd 変更＋手動展開で動作継続する（自動更新は best-effort）。

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use notify_debouncer_mini::notify::{RecommendedWatcher, RecursiveMode};
use notify_debouncer_mini::{new_debouncer, DebounceEventResult, Debouncer};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::fs_scope::{affected_dirs, FsRoot};

/// デバウンス窓。`npm install` 等のバーストを 1 イベントに畳む。
const DEBOUNCE_MS: u64 = 300;

#[derive(Clone, Serialize)]
struct FsChanged {
    dirs: Vec<String>,
}

struct WatchInner {
    debouncer: Debouncer<RecommendedWatcher>,
    watched: PathBuf,
}

/// FS 監視の可動状態（managed state）。`watch()` を初回起動と再 watch の両方に使う。
#[derive(Default)]
pub struct FsWatcher {
    inner: Mutex<Option<WatchInner>>,
}

impl FsWatcher {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(None),
        }
    }

    /// `root` を再帰監視する（初回は debouncer を生成、以降は監視先を張り替える）。
    /// 既に同一 root を監視中なら何もしない。失敗は静かに degrade（ログのみ）。
    pub fn watch(&self, app: &AppHandle, root: &Path) {
        let mut guard = match self.inner.lock() {
            Ok(g) => g,
            Err(_) => return,
        };

        // 既存 debouncer がある場合は監視先だけ張り替える（スレッド再生成を避ける）。
        if let Some(inner) = guard.as_mut() {
            if inner.watched == root {
                return;
            }
            let _ = inner.debouncer.watcher().unwatch(&inner.watched);
            match inner
                .debouncer
                .watcher()
                .watch(root, RecursiveMode::Recursive)
            {
                Ok(()) => inner.watched = root.to_path_buf(),
                Err(e) => {
                    eprintln!("fs watch: re-watch {} failed: {e}", root.display());
                    *guard = None; // 次回呼び出しで再生成を試みる。
                }
            }
            return;
        }

        // 初回: debouncer を生成。ハンドラは AppHandle を捕捉し、毎回 current() で
        // 現在の root を読むので監視先張り替えと整合する。
        let app_h = app.clone();
        let mut debouncer = match new_debouncer(
            Duration::from_millis(DEBOUNCE_MS),
            move |res: DebounceEventResult| {
                let events = match res {
                    Ok(ev) => ev,
                    Err(_) => return,
                };
                let paths: Vec<PathBuf> = events.into_iter().map(|e| e.path).collect();
                let fs = app_h.state::<FsRoot>();
                let dirs = affected_dirs(&fs.current(), &paths);
                if !dirs.is_empty() {
                    let _ = app_h.emit("fs://changed", FsChanged { dirs });
                }
            },
        ) {
            Ok(d) => d,
            Err(e) => {
                eprintln!("fs watch: create debouncer failed: {e}");
                return;
            }
        };

        if let Err(e) = debouncer.watcher().watch(root, RecursiveMode::Recursive) {
            eprintln!("fs watch: watch {} failed: {e}", root.display());
            return;
        }
        *guard = Some(WatchInner {
            debouncer,
            watched: root.to_path_buf(),
        });
    }
}
