import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(root, 'public');
const port = Number(process.env.PORT || 3000);
const providerKeys = { gemini: process.env.GEMINI_API_KEY, openai: process.env.OPENAI_API_KEY, deepseek: process.env.DEEPSEEK_API_KEY };
const defaultProvider = (process.env.AI_PROVIDER || 'gemini').toLowerCase();
const siteName = (process.env.SITE_NAME || 'رفيقة الدراسة').slice(0, 60);
const hitLog = new Map();
const WINDOW_MS = 10 * 60 * 1000;
const MAX_HITS = 25;
const MAX_BODY = 120_000;
const mime = { '.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon' };

function send(res, status, data) { res.writeHead(status, { 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff' }); res.end(JSON.stringify(data)); }
function configured(provider) { return Boolean(providerKeys[provider]); }
function ipOf(req) { return process.env.TRUST_PROXY === '1' ? (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress : req.socket.remoteAddress; }
function rateLimited(ip) { const now=Date.now(); let a=(hitLog.get(ip)||[]).filter(t=>now-t<WINDOW_MS); if(a.length>=MAX_HITS){hitLog.set(ip,a);return true} a.push(now);hitLog.set(ip,a);return false; }
async function bodyJson(req) { let raw=''; for await (const chunk of req) { raw+=chunk; if(raw.length>MAX_BODY) throw Object.assign(new Error('الطلب كبير. قصّري نص المحاضرة وجربي مرة ثانية.'),{status:413}); } try{return JSON.parse(raw)}catch{throw Object.assign(new Error('تعذر قراءة الطلب.'),{status:400})} }
async function ask(provider,prompt) {
 const key=providerKeys[provider];
 if(!key) throw Object.assign(new Error('المساعد غير مفعّل حالياً. يرجى المحاولة لاحقاً.'),{status:503});
 let url, headers={'Content-Type':'application/json'}, payload;
 if(provider==='gemini'){url='https://generativelanguage.googleapis.com/v1beta/interactions';headers['x-goog-api-key']=key;payload={model:'gemini-3.8-flash',input:prompt};}
 else if(provider==='openai'){url='https://api.openai.com/v1/responses';headers.Authorization='Bearer '+key;payload={model:'gpt-4.1-mini',input:prompt};}
 else {url='https://api.deepseek.com/chat/completions';headers.Authorization='Bearer '+key;payload={model:'deepseek-chat',messages:[{role:'user',content:prompt}]};}
 const response=await fetch(url,{method:'POST',headers,body:JSON.stringify(payload),signal:AbortSignal.timeout(90000)});
 const data=await response.json().catch(()=>({}));
 if(!response.ok){const e=Object.assign(new Error('تعذر على المساعد إكمال الطلب. جربي لاحقاً.'),{status:502}); if(response.status===401||response.status===403) e.message='خدمة المساعد غير متاحة حالياً.'; throw e;}
 const text=provider==='gemini'?(data.output_text||data.outputs?.filter(x=>x.type==='text').map(x=>x.text||'').join('\n')||'') : provider==='openai'?(data.output_text||''):(data.choices?.[0]?.message?.content||'');
 if(!text) throw Object.assign(new Error('ما وصلش رد نصي من المساعد. جربي مرة ثانية.'),{status:502}); return text;
}
const server=http.createServer(async(req,res)=>{
 res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');res.setHeader('X-Frame-Options','DENY');
 const url=new URL(req.url,'http://localhost');
 if(req.method==='GET'&&url.pathname==='/api/status'){const providers=Object.fromEntries(Object.keys(providerKeys).map(k=>[k,configured(k)]));const p=configured(defaultProvider)?defaultProvider:Object.keys(providerKeys).find(configured)||'';return send(res,200,{ready:Boolean(p),provider:p,providers,siteName});}
 if(req.method==='POST'&&url.pathname==='/api/ai'){
  const ip=ipOf(req);if(rateLimited(ip))return send(res,429,{error:'وصلتي للحد المؤقت من الطلبات. انتظري دقائق وجربي مرة ثانية.'});
  try{const body=await bodyJson(req);const provider=String(body.provider||defaultProvider).toLowerCase();const prompt=typeof body.prompt==='string'?body.prompt:'';if(!['gemini','openai','deepseek'].includes(provider))return send(res,400,{error:'الخدمة المختارة غير مدعومة.'});if(prompt.length<1||prompt.length>100000)return send(res,400,{error:'نص الطلب غير صالح أو طويل جداً.'});const answer=await ask(provider,prompt);return send(res,200,{answer});}catch(e){return send(res,e.status||502,{error:e.message||'تعذر الاتصال بالمساعد.'});}
 }
 if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405);return res.end();}
 let pathname=decodeURIComponent(url.pathname);if(pathname==='/')pathname='/index.html';const target=path.resolve(publicDir,'.'+pathname);if(!target.startsWith(publicDir+path.sep)&&target!==path.join(publicDir,'index.html')){res.writeHead(403);return res.end();}
 fs.readFile(target,(err,buf)=>{if(err){res.writeHead(404);return res.end('Not found');}res.writeHead(200,{'Content-Type':mime[path.extname(target)]||'application/octet-stream','Cache-Control':'no-cache'});if(req.method==='HEAD')return res.end();res.end(buf);});
});
server.listen(port,'0.0.0.0',()=>console.log('Rafiqa Study is listening on port '+port));
