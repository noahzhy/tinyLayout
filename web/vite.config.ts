import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {fileURLToPath} from 'node:url';
export default defineConfig({root: fileURLToPath(new URL('.', import.meta.url)), plugins: [react()], server: {host: '127.0.0.1'}, build: {rollupOptions: {input: {main: fileURLToPath(new URL('index.html', import.meta.url)), render: fileURLToPath(new URL('render.html', import.meta.url))}}}});
