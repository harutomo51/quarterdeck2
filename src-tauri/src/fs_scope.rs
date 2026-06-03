//! ファイル一覧 / プレビュー（Phase 2）+ cwd 追従の可動境界（ADR-0001）。
//!
//! preload 経由の限定 API を、スコープ強制つきの Rust コマンドに置換する。
//! `canonicalize` でシンボリックリンクや `..` を解決した上で、`FsRoot` 配下から
//! 外れたら拒否する（= コマンド内部がスコープ強制の信頼境界。CLAUDE.md の変更ルール）。
//!
//! `FsRoot` は固定ではなく **ターミナルの live cwd に追従する可動境界**（ADR-0001）。
//! pty の reader が OSC 9;9 から抽出した cwd で `set` され、`resolve_within` の基準が
//! 追従する。不変条件「常に現在フォルダ配下のみ許可」は保つ。
//!
//! - `list_dir`: `FsRoot` 配下のディレクトリを 1 階層列挙（EXCLUDE で間引く）。
//! - `read_preview`: 1MB 以下のファイルを読み、拡張子で md/html/code を出し分ける。

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::Serialize;
use tauri::State;

pub struct FsRoot {
    root: Mutex<PathBuf>,
}

impl FsRoot {
    pub fn new(root: PathBuf) -> Self {
        // canonicalize しておき、以降の starts_with 判定の基準を正規化済みに揃える。
        Self {
            root: Mutex::new(root.canonicalize().unwrap_or(root)),
        }
    }

    /// 現在のスコープ基準（クローンを返す）。
    pub fn current(&self) -> PathBuf {
        self.root.lock().expect("FsRoot poisoned").clone()
    }

    /// 新しい cwd を採用する。`canonicalize` 成功かつディレクトリのときだけ更新し、
    /// 採用したら true。実在しない / ファイルなら無視して false（degrade）。
    pub fn set(&self, path: &Path) -> bool {
        match path.canonicalize() {
            Ok(canon) if canon.is_dir() => {
                *self.root.lock().expect("FsRoot poisoned") = canon;
                true
            }
            _ => false,
        }
    }
}

#[derive(Serialize)]
pub struct Entry {
    name: String,
    is_dir: bool,
}

const EXCLUDE: &[&str] = &["node_modules", ".git", "out", "dist", "target"];
const MAX_PREVIEW_BYTES: u64 = 1024 * 1024; // 1MB プレビュー制限

/// `root` 配下の相対パス `rel` を正規化し、root の外へ出ていないか検証する。
///
/// `canonicalize` で `..` とシンボリックリンクを解決した上で `starts_with(root)`
/// を強制するため、`..` traversal・絶対パス・root 外を指すリンクはすべて reject。
fn resolve_within(root: &Path, rel: &str) -> Result<PathBuf, String> {
    let canon = root.join(rel).canonicalize().map_err(|e| e.to_string())?;
    if !canon.starts_with(root) {
        return Err("path is outside the allowed root".into());
    }
    Ok(canon)
}

#[tauri::command]
pub fn list_dir(rel: Option<String>, state: State<FsRoot>) -> Result<Vec<Entry>, String> {
    let root = state.current();
    let dir = match rel {
        Some(r) if !r.is_empty() => resolve_within(&root, &r)?,
        _ => root.clone(),
    };
    let mut out = Vec::new();
    for e in fs::read_dir(&dir).map_err(|e| e.to_string())? {
        let e = e.map_err(|e| e.to_string())?;
        let name = e.file_name().to_string_lossy().to_string();
        if EXCLUDE.contains(&name.as_str()) {
            continue;
        }
        let is_dir = e.file_type().map(|t| t.is_dir()).unwrap_or(false);
        out.push(Entry { name, is_dir });
    }
    // ディレクトリ優先、その後名前順で安定した表示にする。
    out.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then_with(|| a.name.cmp(&b.name)));
    Ok(out)
}

#[derive(Serialize)]
pub struct Preview {
    kind: String,
    content: String,
}

#[tauri::command]
pub fn read_preview(rel: String, state: State<FsRoot>) -> Result<Preview, String> {
    let root = state.current();
    let path = resolve_within(&root, &rel)?;
    if fs::metadata(&path).map_err(|e| e.to_string())?.len() > MAX_PREVIEW_BYTES {
        return Err("file exceeds 1MB preview limit".into());
    }
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let kind = match path.extension().and_then(|e| e.to_str()) {
        Some("md") => "markdown",
        Some("html") | Some("htm") => "html",
        _ => "code",
    }
    .to_string();
    Ok(Preview { kind, content })
}

#[cfg(test)]
mod tests {
    use super::{resolve_within, FsRoot};
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn accepts_path_inside_root() {
        let dir = tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        fs::write(root.join("inside.txt"), b"hi").unwrap();

        let resolved = resolve_within(&root, "inside.txt").unwrap();
        assert!(resolved.starts_with(&root));
    }

    #[test]
    fn rejects_parent_traversal() {
        let dir = tempdir().unwrap();
        let root = dir.path().join("root");
        fs::create_dir(&root).unwrap();
        let root = root.canonicalize().unwrap();
        // 親ディレクトリに実在ファイルを置いても、root 外なので拒否されること。
        fs::write(dir.path().join("secret.txt"), b"secret").unwrap();

        let result = resolve_within(&root, "../secret.txt");
        assert!(result.is_err());
    }

    #[test]
    fn rejects_absolute_path() {
        let dir = tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        // join に絶対パスを渡すと root を置き換えるため root 外になり拒否される。
        let abs = root.join("..").join("anywhere.txt");
        let abs_str = abs.to_string_lossy().to_string();

        let result = resolve_within(&root, &abs_str);
        assert!(result.is_err());
    }

    #[test]
    fn rejects_nonexistent_path() {
        let dir = tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        // canonicalize は実在しないパスで失敗する（= 存在しないものは読ませない）。
        let result = resolve_within(&root, "does-not-exist.txt");
        assert!(result.is_err());
    }

    #[test]
    fn set_moves_the_boundary_to_an_existing_dir() {
        let dir = tempdir().unwrap();
        let start = dir.path().join("start");
        let moved = dir.path().join("moved");
        fs::create_dir(&start).unwrap();
        fs::create_dir(&moved).unwrap();

        let root = FsRoot::new(start.clone());
        assert!(root.set(&moved));
        assert_eq!(root.current(), moved.canonicalize().unwrap());
    }

    #[test]
    fn set_ignores_nonexistent_path() {
        let dir = tempdir().unwrap();
        let start = dir.path().canonicalize().unwrap();
        let root = FsRoot::new(start.clone());

        assert!(!root.set(&dir.path().join("does-not-exist")));
        assert_eq!(root.current(), start);
    }
}
