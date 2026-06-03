/**
 * ファイル名 → アイコン種別の判定（UI 状態と分離した純粋ロジック）。
 *
 * 拡張子（または特殊ファイル名）から表示用の種別を1つ返す。実際の glyph / 色への
 * 割り当ては FileTree 側が担う。ここは「どの種別か」だけを決めるのでテスト可能。
 */

export type FileIconKind =
  | 'code'
  | 'markup'
  | 'style'
  | 'json'
  | 'markdown'
  | 'text'
  | 'image'
  | 'archive'
  | 'video'
  | 'audio'
  | 'config'
  | 'pdf'
  | 'file';

/** 拡張子（小文字、ドット無し）→ 種別。 */
const EXT_MAP: Readonly<Record<string, FileIconKind>> = {
  // code
  ts: 'code', tsx: 'code', js: 'code', jsx: 'code', mjs: 'code', cjs: 'code',
  rs: 'code', py: 'code', go: 'code', java: 'code', kt: 'code', rb: 'code',
  php: 'code', swift: 'code', c: 'code', cc: 'code', cpp: 'code', h: 'code',
  hpp: 'code', cs: 'code', sh: 'code', ps1: 'code', sql: 'code', lua: 'code',
  // markup
  html: 'markup', htm: 'markup', xml: 'markup', vue: 'markup', svelte: 'markup',
  // style
  css: 'style', scss: 'style', sass: 'style', less: 'style',
  // json
  json: 'json', jsonc: 'json',
  // markdown
  md: 'markdown', mdx: 'markdown', markdown: 'markdown',
  // text
  txt: 'text', log: 'text', csv: 'text', tsv: 'text',
  // image
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image',
  bmp: 'image', ico: 'image', avif: 'image', svg: 'image',
  // archive
  zip: 'archive', tar: 'archive', gz: 'archive', tgz: 'archive', rar: 'archive',
  '7z': 'archive', bz2: 'archive', xz: 'archive',
  // video
  mp4: 'video', mov: 'video', webm: 'video', mkv: 'video', avi: 'video',
  // audio
  mp3: 'audio', wav: 'audio', flac: 'audio', ogg: 'audio', m4a: 'audio',
  // config
  toml: 'config', yaml: 'config', yml: 'config', ini: 'config', cfg: 'config',
  conf: 'config', lock: 'config', env: 'config',
  // pdf
  pdf: 'pdf',
};

/** 拡張子を持たない特殊ファイル名（小文字フルネーム）→ 種別。 */
const NAME_MAP: Readonly<Record<string, FileIconKind>> = {
  dockerfile: 'config',
  makefile: 'config',
  '.gitignore': 'config',
  '.gitattributes': 'config',
  '.env': 'config',
  '.npmrc': 'config',
  '.editorconfig': 'config',
  'license': 'text',
};

/**
 * ファイル名から拡張子（小文字、ドット無し）を取り出す。
 * 先頭ドットの dotfile（`.gitignore`）や末尾ドットは「拡張子なし」として扱う。
 */
export function fileExtension(name: string): string {
  const lower = name.toLowerCase();
  const dot = lower.lastIndexOf('.');
  if (dot <= 0 || dot === lower.length - 1) return '';
  return lower.slice(dot + 1);
}

/** ファイル名から表示用のアイコン種別を決める。未知の拡張子は 'file'。 */
export function fileIconKind(name: string): FileIconKind {
  const lower = name.toLowerCase();
  const byName = NAME_MAP[lower];
  if (byName) return byName;
  const ext = fileExtension(name);
  return EXT_MAP[ext] ?? 'file';
}
