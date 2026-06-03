import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

// Tauri dev host (set by `tauri dev` for mobile/remote; harmless on desktop).
const host = process.env.TAURI_DEV_HOST;

// 単一設定で vite(dev/build) と vitest を共有する。
// - plugins/server: フロント開発・Tauri 連携用
// - test: 純粋ロジックの vitest 用（環境は node）
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve('src'),
    },
  },
  // Tauri は自前で進捗を出すので Vite の画面クリアを抑止する
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    host: host || false,
    hmr: host
      ? { protocol: 'ws', host, port: 1421 }
      : undefined,
    // Rust 側の変更で Vite が再起動しないよう監視から除外
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
  test: {
    environment: 'node',
    globals: true,
  },
});
