/**
 * 自動更新チェック（Phase 4）。
 *
 * tauri-plugin-updater を使い、起動時に社内配布エンドポイントへ更新を問い合わせる。
 * 更新があればダウンロード→インストール→再起動する。エラーは握り潰さずログに出す
 * （CLAUDE.md: 機密情報はログに出さない／エラーは明示的に扱う）。
 *
 * 注: エンドポイント未設定（プレースホルダ）や到達不能時はチェックが失敗するが、
 * アプリ本体の動作は継続させる（更新は付加機能のため）。
 */
import { check } from '@tauri-apps/plugin-updater';

export async function checkForUpdates(): Promise<void> {
  try {
    const update = await check();
    if (!update) return;

    console.info(`update available: ${update.version}`);
    // Windows(NSIS) では downloadAndInstall がインストーラを起動しアプリを終了する。
    // 再起動後に新バージョンで立ち上がる（process プラグインでの relaunch は今は使わない）。
    await update.downloadAndInstall();
  } catch (e) {
    // 更新チェック失敗はアプリを止めない。詳細はログのみ。
    console.error('update check failed', e);
  }
}
