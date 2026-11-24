interface Window {
  APP_ID?: string;
  BASE_PATH?: string;
  APP_CONFIG: any;
}

/** Phiên bản trong package.json, chèn lúc build (vite.config.mts). */
declare const __APP_VERSION__: string;
