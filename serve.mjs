import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const T={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.json':'application/json'};
http.createServer((q,r)=>{let f=path.join(process.cwd(),q.url.split('?')[0]);if(f.endsWith(path.sep))f+='index.html';fs.readFile(f,(e,d)=>{if(e){r.writeHead(404);r.end();return}r.writeHead(200,{'Content-Type':T[path.extname(f)]||'application/octet-stream'});r.end(d)})}).listen(8080,()=>console.log('http://localhost:8080'));
