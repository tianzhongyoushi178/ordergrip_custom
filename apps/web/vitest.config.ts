import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./lib/__tests__/setup.ts'],
    // ローレット/スパイラルの3Dメッシュ生成テストは jsdom 上で大きなジオメトリ
    // (数十万頂点) + computeVertexNormals を扱うため、デフォルト 5s では不足する。
    // ブラウザ実機では十分高速だが、jsdom が遅いので余裕を持たせる。
    testTimeout: 20000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
});
