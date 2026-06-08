//! プラン利用枠バーのデータ取得（ADR-0004 / issue 0001）。
//!
//! `~/.claude/quarterdeck-usage.json` を `notify` で監視し、更新を検知したら
//! パースして `usage://rate_limits` を renderer へ emit する。statusline.py が
//! stdin の `rate_limits` を抜いてこのファイルへアトミック書き込み（temp→rename）する。
//!
//! このファイルは FsRoot の信頼境界（fs_scope）の外にある専用ファイルで、
//! ファイルツリー用の fs_watch（ADR-0003, FsRoot 再帰監視）とは別系統の watcher を
//! 1 つ立てる。固定パス 1 つを監視するだけでスコープ強制の対象ではない。
//! 親ディレクトリ（`~/.claude`）を非再帰で監視し、対象ファイル名のイベントだけ拾う
//! （アトミック replace は最終ファイル名で通知されるため、temp ファイルは弾かれる）。
//!
//! degrade（ADR-0004）: 監視生成・読み取り・パース失敗はいずれも stderr ログのみで
//! 静かに握りつぶし、ターミナル本体の動作には影響させない。

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use notify_debouncer_mini::notify::{RecommendedWatcher, RecursiveMode};
use notify_debouncer_mini::{new_debouncer, DebounceEventResult, Debouncer};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

/// アトミック replace の通知バーストを 1 回に畳むデバウンス窓。
const DEBOUNCE_MS: u64 = 200;
/// statusline.py が書き出す利用枠ファイル名。
const USAGE_FILE_NAME: &str = "quarterdeck-usage.json";

/// statusline.py が書き出す利用枠ペイロード。`rate_limits` は構造を固定しすぎない
/// よう `Value` のまま保持し（5h / 7d の差分は renderer 側で吸収）、`ts` で後続の
/// 鮮度判定（issue 0003）に備える。
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub struct Usage {
    pub rate_limits: serde_json::Value,
    pub ts: f64,
}

/// `~/.claude/quarterdeck-usage.json` の絶対パス。`USERPROFILE` が取れないときは `None`。
/// 副作用（環境変数）と分離してテスト可能にする純粋ロジック。
pub(crate) fn usage_file_path(userprofile: Option<PathBuf>) -> Option<PathBuf> {
    userprofile.map(|p| p.join(".claude").join(USAGE_FILE_NAME))
}

/// 利用枠ファイルの中身をパースする純粋ロジック。壊れていれば `None`（degrade）。
pub(crate) fn parse_usage(contents: &str) -> Option<Usage> {
    serde_json::from_str(contents).ok()
}

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE").map(PathBuf::from)
}

/// 利用枠ファイル監視の状態（managed state）。debouncer を保持して生かし続ける
/// （drop すると監視スレッドが止まるため）。
#[derive(Default)]
pub struct UsageWatcher {
    inner: Mutex<Option<Debouncer<RecommendedWatcher>>>,
}

impl UsageWatcher {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(None),
        }
    }

    /// 監視を開始する。失敗は静かに degrade（ログのみ）。
    pub fn watch(&self, app: &AppHandle) {
        let Some(file) = usage_file_path(home_dir()) else {
            eprintln!("usage watch: USERPROFILE unavailable, skip");
            return;
        };
        let Some(dir) = file.parent().map(Path::to_path_buf) else {
            return;
        };
        if !dir.is_dir() {
            eprintln!("usage watch: {} missing, skip", dir.display());
            return;
        }

        // 起動直後に既存ファイルがあれば一度 emit（前回の statusline 実行値を初期表示）。
        emit_if_present(app, &file);

        let mut guard = match self.inner.lock() {
            Ok(g) => g,
            Err(_) => return,
        };
        let app_h = app.clone();
        let target = file.clone();
        let mut debouncer = match new_debouncer(
            Duration::from_millis(DEBOUNCE_MS),
            move |res: DebounceEventResult| {
                let events = match res {
                    Ok(ev) => ev,
                    Err(_) => return,
                };
                let hit = events
                    .iter()
                    .any(|e| e.path.file_name() == target.file_name());
                if hit {
                    emit_if_present(&app_h, &target);
                }
            },
        ) {
            Ok(d) => d,
            Err(e) => {
                eprintln!("usage watch: create debouncer failed: {e}");
                return;
            }
        };
        if let Err(e) = debouncer.watcher().watch(&dir, RecursiveMode::NonRecursive) {
            eprintln!("usage watch: watch {} failed: {e}", dir.display());
            return;
        }
        *guard = Some(debouncer);
    }
}

/// ファイルがあれば読んでパースし emit。
/// degrade（issue 0003）: 未作成（NotFound）は正常系として黙って何もしない。
/// 読み取り失敗・パース不能（破損 / `rate_limits`・`ts` 欠落）は**異常**として
/// ログに残しつつ emit しない（UI 側は鮮度切れ扱いで静かに非表示）。
fn emit_if_present(app: &AppHandle, file: &Path) {
    let contents = match std::fs::read_to_string(file) {
        Ok(c) => c,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return,
        Err(e) => {
            eprintln!("usage watch: read {} failed: {e}", file.display());
            return;
        }
    };
    match parse_usage(&contents) {
        Some(usage) => {
            let _ = app.emit("usage://rate_limits", usage);
        }
        None => {
            eprintln!("usage watch: {} unparsable, skip emit", file.display());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{parse_usage, usage_file_path};
    use std::path::PathBuf;

    #[test]
    fn builds_usage_path_under_claude_dir() {
        let profile = PathBuf::from("C:\\Users\\someone");
        let path = usage_file_path(Some(profile)).unwrap();
        assert!(path.ends_with("quarterdeck-usage.json"));
        assert!(path.to_string_lossy().contains(".claude"));
    }

    #[test]
    fn returns_none_when_userprofile_absent() {
        assert_eq!(usage_file_path(None), None);
    }

    #[test]
    fn parses_valid_usage_payload() {
        let json = r#"{"rate_limits":{"five_hour":{"used_percentage":42}},"ts":1700000000.5}"#;
        let usage = parse_usage(json).unwrap();
        assert_eq!(usage.ts, 1700000000.5);
        assert_eq!(usage.rate_limits["five_hour"]["used_percentage"], 42);
    }

    #[test]
    fn rejects_garbage_and_missing_fields() {
        assert!(parse_usage("not json").is_none());
        // ts 欠落はパース失敗（degrade）。
        assert!(parse_usage(r#"{"rate_limits":{}}"#).is_none());
    }
}
