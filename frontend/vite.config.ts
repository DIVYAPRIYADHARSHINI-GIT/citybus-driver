import { defineConfig } from 'vite';
import { createHash } from 'node:crypto';
export default defineConfig({
  server:{proxy:{'/api':{target:process.env.CITYBUS_API_PROXY_TARGET||'http://127.0.0.1:8000',changeOrigin:false,ws:true}}},
  preview:{proxy:{'/api':{target:process.env.CITYBUS_API_PROXY_TARGET||'http://127.0.0.1:8000',changeOrigin:false,ws:true}}},
  plugins:[{
    name:'citybus-offline',
    generateBundle(_options,bundle){
      const assets=['/','/index.html','/icon.svg',...Object.keys(bundle).map(f=>'/'+f)];
      const hash=createHash('sha256').update('citybus-static-sw-v2').update(JSON.stringify(bundle)).digest('hex').slice(0,12);
      this.emitFile({type:'asset',fileName:'sw.js',source:`const CACHE='citybus-${hash}';const ASSETS=${JSON.stringify(assets)};
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS))));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('citybus-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{if(e.request.method!=='GET'||new URL(e.request.url).origin!==self.location.origin||new URL(e.request.url).pathname.startsWith('/api/'))return;e.respondWith(caches.open(CACHE).then(c=>c.match(e.request,{ignoreVary:true})).then(hit=>hit||fetch(e.request)));});`});
    }
  }],
  build:{rolldownOptions:{output:{manualChunks(id){if(id.includes('node_modules/three/')||id.includes('node_modules/cannon-es/'))return 'engine';}}}}
});
