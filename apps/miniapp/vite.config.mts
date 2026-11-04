import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import zaloMiniApp from "zmp-vite-plugin";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default ({ mode }: { mode: string }) => {
  const env = loadEnv(mode, process.cwd(), "");
  // Khi chạy dev, Mini App gọi `/api/...` cùng origin và Vite chuyển tiếp sang apps/api
  // (API chưa bật CORS). Mặc định API chạy ở cổng 3001 vì `zmp start` dùng cổng 3000.
  const apiTarget = env.VITE_API_PROXY_TARGET || "http://localhost:3001";
  return defineConfig({
    root: "./src",
    base: "",
    // Đọc .env ở thư mục apps/miniapp dù root là src (dev) hay . (build).
    envDir: fileURLToPath(new URL(".", import.meta.url)),
    plugins: [zaloMiniApp(), react()],
    build: {
      assetsInlineLimit: 0,
    },
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
      },
    },
    server: {
      proxy: {
        "/api": { target: apiTarget, changeOrigin: true },
      },
    },
    test: {
      root: ".",
      include: ["src/**/*.spec.ts"],
      environment: "node",
    },
  } as any);
};
