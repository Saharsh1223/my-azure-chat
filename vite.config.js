import { copyFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'copy-swa-config',
      closeBundle() {
        copyFileSync('staticwebapp.config.json', 'dist/staticwebapp.config.json');
      },
    },
  ],
});
