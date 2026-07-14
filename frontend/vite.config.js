import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// pretty bare bones config, just react plugin and a fixed dev port
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
  },
});
