import http from 'node:http';
import {readFile,realpath} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript','.json':'application/json','.png':'image/png','.glb':'model/gltf-binary','.blend':'application/octet-stream'};
const server=http.createServer(async(req,res)=>{
  try {
    if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,{'Allow':'GET, HEAD'});res.end();return}
    const url=new URL(req.url,'http://127.0.0.1');
    const route=decodeURIComponent(url.pathname);
    let base,relative;
    if(route==='/'){base=path.join(root,'tools/assets');relative='pilot_review_v1.html';}
    else if(route.startsWith('/assets/')){base=path.join(root,'working/pilot-v1');relative=route.slice(8);}
    else if(route.startsWith('/three/')){base=path.join(root,'node_modules/three');relative=route.slice(7);}
    else if(/^\/references\/ST-\d{3}\/candidate-1\.png$/.test(route)){base=root;relative=route.slice(1);}
    else throw Error('Not found');
    const file=path.resolve(base,relative);
    if(!file.startsWith(path.resolve(base)+path.sep))throw Error('Not found');
    const actual=await realpath(file),actualBase=await realpath(base);
    if(!actual.startsWith(actualBase+path.sep))throw Error('Not found');
    const body=await readFile(actual);
    res.writeHead(200,{'Content-Type':mime[path.extname(file)]??'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
    res.end(req.method==='HEAD'?undefined:body);
  }catch{res.writeHead(404);res.end('Not found');}
});
server.listen(8790,'127.0.0.1',()=>console.log('Pilot review: http://127.0.0.1:8790 (local only)'));
