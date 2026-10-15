import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {fileURLToPath} from 'node:url';

export default defineConfig({
 plugins:[react()],
 build:{
  target:'es2022',sourcemap:false,
  rollupOptions:{input:{app:fileURLToPath(new URL('./index.html',import.meta.url)),demo:fileURLToPath(new URL('./demo.html',import.meta.url))}}
 },
 server:{proxy:{'/api':'http://127.0.0.1:8787'}}
});
