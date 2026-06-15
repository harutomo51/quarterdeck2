//! PDF プレビューのバイト配信（ADR-0005）。
//!
//! `read_preview` はテキスト専用（UTF-8 / 1MB 制限）なので、バイナリの PDF は
//! 運べない。代わりに `pdf://` カスタム URI スキームのハンドラを設け、その内側で
//! `fs_scope::resolve_within(FsRoot::current(), rel)` を**再検証**してから
//! `application/pdf` で返す。これにより cwd 追従の可動境界（ADR-0001）をそのまま
//! 保ったまま、WebView2 内蔵 PDF ビューアへ `<iframe>` で描画させる。
//!
//! `#[tauri::command]` ではない**第二の信頼境界**なので、スコープ強制（`resolve_within`）
//! と `.pdf` 拡張子チェックをハンドラ内で必ず通す。Windows では Tauri がカスタム
//! スキームを `http://pdf.localhost/<percent-encoded-rel>` で配信するため、URL パスを
//! percent-decode して rel を復元する。

use tauri::http::{header, Request, Response, StatusCode};
use tauri::{Manager, UriSchemeContext, Wry};

use crate::fs_scope::{is_pdf, resolve_within, FsRoot};

/// `pdf://`（Windows 実体は `http://pdf.localhost`）のリクエストを処理する。
/// 成功時は `application/pdf` でバイト列を返し、失敗時はボディ無しのエラー応答を返す。
pub fn handle_pdf_request(
    ctx: UriSchemeContext<'_, Wry>,
    request: Request<Vec<u8>>,
) -> Response<Vec<u8>> {
    match serve(&ctx, &request) {
        Ok(bytes) => Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, "application/pdf")
            .body(bytes)
            .expect("valid pdf response"),
        Err(status) => Response::builder()
            .status(status)
            .body(Vec::new())
            .expect("valid error response"),
    }
}

/// URL から rel を復元し、スコープ強制 + `.pdf` 限定を通してファイルを読む。
/// 失敗はステータスコードに写像する（内部パス等はボディに漏らさない）。
fn serve(
    ctx: &UriSchemeContext<'_, Wry>,
    request: &Request<Vec<u8>>,
) -> Result<Vec<u8>, StatusCode> {
    let rel = decode_rel(request.uri().path()).ok_or(StatusCode::BAD_REQUEST)?;

    let root = ctx.app_handle().state::<FsRoot>().current();
    // スコープ強制（信頼境界）: `..` / 絶対パス / シンボリックリンク / root 外 /
    // 実在しないパスはここで reject。read_preview と同じ resolve_within を再実行する。
    let path = resolve_within(&root, &rel).map_err(|_| StatusCode::FORBIDDEN)?;
    // 境界の最小化: `.pdf` 以外は配信しない（汎用のバイト取り出しチャネルにしない）。
    if !is_pdf(&path) {
        return Err(StatusCode::FORBIDDEN);
    }
    std::fs::read(&path).map_err(|_| StatusCode::NOT_FOUND)
}

/// URL パス（先頭 `/` 付き・percent-encoded）から rel（`/` 区切り）を復元する純粋ロジック。
/// 空や不正 UTF-8 は None。スコープ強制は呼び出し側 `resolve_within` が担う。
fn decode_rel(path: &str) -> Option<String> {
    let trimmed = path.strip_prefix('/').unwrap_or(path);
    if trimmed.is_empty() {
        return None;
    }
    let decoded = percent_encoding::percent_decode_str(trimmed)
        .decode_utf8()
        .ok()?;
    if decoded.is_empty() {
        None
    } else {
        Some(decoded.into_owned())
    }
}

// `serve` の実 IO・スコープ強制は fs_scope の resolve_within / is_pdf が既にテスト済み。
// ここは URL → rel の復元（純粋ロジック）だけを単体テストする。
#[cfg(test)]
mod tests {
    use super::decode_rel;

    #[test]
    fn decodes_simple_path() {
        assert_eq!(
            decode_rel("/docs/report.pdf").as_deref(),
            Some("docs/report.pdf")
        );
    }

    #[test]
    fn decodes_percent_encoded_spaces_and_unicode() {
        // "資料/my report.pdf" を encodeURIComponent 連結したもの。
        let encoded = "/%E8%B3%87%E6%96%99/my%20report.pdf";
        assert_eq!(decode_rel(encoded).as_deref(), Some("資料/my report.pdf"));
    }

    #[test]
    fn returns_none_for_empty_path() {
        assert_eq!(decode_rel("/"), None);
        assert_eq!(decode_rel(""), None);
    }
}
