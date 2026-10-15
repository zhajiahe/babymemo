import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {fileURLToPath} from 'node:url';

export default defineConfig({
 plugins:[react(),{
  name:'demo-clean-url-redirects',
  configureServer(server){server.middlewares.use((req,res,next)=>{
   const route=req.url?.split('?')[0];
   const target=route==='/demo'||route==='/demo/'?'/demo.html':route==='/demo/mobile'||route==='/demo/mobile/'?'/demo/mobile.html':null;
   if(!target)return next();
   res.writeHead(302,{Location:target,'Cache-Control':'no-store'});res.end();
  })},
 }],
 build:{
  target:'es2022',sourcemap:false,
  rollupOptions:{input:{app:fileURLToPath(new URL('./index.html',import.meta.url)),demo:fileURLToPath(new URL('./demo.html',import.meta.url)),mobileDemo:fileURLToPath(new URL('./demo/mobile.html',import.meta.url))}}
 },
 server:{proxy:{'/api':'http://127.0.0.1:8787'}}
});
