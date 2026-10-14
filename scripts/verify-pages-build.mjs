import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,sep} from 'node:path';
import {spawn} from 'node:child_process';
const root=resolve('dist/stock/browser'),prefix='/stock-simulator/';
const server=createServer(async(req,res)=>{try{const url=new URL(req.url,'http://localhost');if(!url.pathname.startsWith(prefix))throw Error();const path=resolve(root,url.pathname.slice(prefix.length)||'index.html');if(!path.startsWith(root+sep))throw Error();const data=await readFile(path);res.writeHead(200,{'Content-Type':path.endsWith('.js')?'text/javascript':path.endsWith('.json')?'application/json':path.endsWith('.css')?'text/css':'text/html'});res.end(data);}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(4290,'127.0.0.1',r));
try{for(const file of process.argv.slice(2).length?process.argv.slice(2):['scripts/verify-market-pages.mjs','scripts/verify-ux-revision.mjs','scripts/verify-order-planning.mjs','scripts/verify-trading-flow.mjs','scripts/verify-storage-tabs.mjs','scripts/verify-responsive-layout.mjs']){await new Promise((r,j)=>{const child=spawn(process.execPath,[file],{env:{...process.env,MARKET_TEST_URL:'http://127.0.0.1:4290'+prefix,WORKSPACE_TEST_URL:'http://127.0.0.1:4290'+prefix,ALERT_TEST_URL:'http://127.0.0.1:4290'+prefix},stdio:'inherit'});child.on('exit',code=>code===0?r():j(Error(file+' exit '+code)));});}}finally{server.close();}
