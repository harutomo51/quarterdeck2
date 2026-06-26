//! Binary image preview delivery.
//!
//! This mirrors the PDF preview path: the renderer only receives a typed preview
//! result, while the actual bytes are served through a URI handler that re-checks
//! `FsRoot` scope and the file extension before reading anything.

use tauri::http::{header, Request, Response, StatusCode};
use tauri::{Manager, UriSchemeContext, Wry};

use crate::fs_scope::{image_mime, resolve_within, FsRoot};

pub fn handle_image_request(
    ctx: UriSchemeContext<'_, Wry>,
    request: Request<Vec<u8>>,
) -> Response<Vec<u8>> {
    match serve(&ctx, &request) {
        Ok((bytes, mime)) => Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, mime)
            .body(bytes)
            .expect("valid image response"),
        Err(status) => Response::builder()
            .status(status)
            .body(Vec::new())
            .expect("valid error response"),
    }
}

fn serve(
    ctx: &UriSchemeContext<'_, Wry>,
    request: &Request<Vec<u8>>,
) -> Result<(Vec<u8>, &'static str), StatusCode> {
    let rel = decode_rel(request.uri().path()).ok_or(StatusCode::BAD_REQUEST)?;
    let root = ctx.app_handle().state::<FsRoot>().current();
    let path = resolve_within(&root, &rel).map_err(|_| StatusCode::FORBIDDEN)?;
    let mime = image_mime(&path).ok_or(StatusCode::FORBIDDEN)?;
    let bytes = std::fs::read(&path).map_err(|_| StatusCode::NOT_FOUND)?;
    Ok((bytes, mime))
}

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

#[cfg(test)]
mod tests {
    use super::decode_rel;

    #[test]
    fn decodes_simple_path() {
        assert_eq!(
            decode_rel("/assets/photo.png").as_deref(),
            Some("assets/photo.png")
        );
    }

    #[test]
    fn decodes_percent_encoded_spaces_and_unicode() {
        let encoded = "/%E8%B3%87%E6%96%99/my%20photo%20%231.jpg";
        assert_eq!(
            decode_rel(encoded).as_deref(),
            Some("資料/my photo #1.jpg")
        );
    }

    #[test]
    fn returns_none_for_empty_path() {
        assert_eq!(decode_rel("/"), None);
        assert_eq!(decode_rel(""), None);
    }
}
