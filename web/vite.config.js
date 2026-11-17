import { defineConfig } from 'vite';
// `npm run dev:phone` also serves the app to phones on the same Wi-Fi (see package.json).
export default defineConfig({
  server: { port: 5173, strictPort: true, proxy: { '/api': 'http://127.0.0.1:8000' } },
  build: { rollupOptions: { input: { main: 'index.html', report: 'report.html', photo: 'photo.html', inspect: 'inspect.html' } } },
});
