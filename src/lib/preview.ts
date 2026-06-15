/**
 * プレビューウィンドウのルーティング用 純粋ロジック（UI 状態と分離してテスト可能に）。
 *
 * プレビューは別ウィンドウ（label = `preview-*`）で開く。同一 index.html を
 * `?preview=<rel>` 付きで開き、main.tsx がパラメータの有無で App / PreviewWindow を
 * 出し分ける。rel は `FsRoot` 配下の相対パス（`/` 区切り）。
 */

const PREVIEW_PARAM = 'preview';

/** プレビュー対象の相対パスから、開く URL を組み立てる。 */
export function buildPreviewUrl(rel: string): string {
  const params = new URLSearchParams({ [PREVIEW_PARAM]: rel });
  return `index.html?${params.toString()}`;
}

/** location.search からプレビュー対象 rel を取り出す（無ければ null）。 */
export function parsePreviewParam(search: string): string | null {
  const rel = new URLSearchParams(search).get(PREVIEW_PARAM);
  return rel && rel.length > 0 ? rel : null;
}

/**
 * rel から Tauri ウィンドウラベルを作る。
 * ラベルに使えるのは英数と `-` `/` `:` `_` のみなので、それ以外は `_` に正規化する。
 * 同じファイルは同じラベルになり、再オープン時に既存ウィンドウへフォーカスできる。
 */
export function previewWindowLabel(rel: string): string {
  const safe = rel.replace(/[^a-zA-Z0-9_-]/g, '_');
  return `preview-${safe}`;
}

/** ツリー表示用に親 rel と名前を `/` 区切りで連結する。 */
export function joinRel(parent: string, name: string): string {
  return parent ? `${parent}/${name}` : name;
}

/**
 * PDF プレビュー用の URL を組み立てる（ADR-0005）。
 * Windows では Tauri がカスタムスキームを `http://<scheme>.localhost` で配信するため、
 * `pdf://` ではなく `http://pdf.localhost` を基点にする。rel の各セグメントを
 * encodeURIComponent でエスケープし（`/` は区切りとして温存）、Rust 側ハンドラが
 * percent-decode で rel を復元する。
 */
export function buildPdfUrl(rel: string): string {
  const encoded = rel.split('/').map(encodeURIComponent).join('/');
  return `http://pdf.localhost/${encoded}`;
}
