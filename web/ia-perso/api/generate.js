import crypto from 'node:crypto';

const MAX_PROMPT = 1800;
const CACHE_TTL_SECONDS = 3600;
const MAX_IMAGE_BYTES = 3_500_000;
const MAX_IMAGE_SEED = 2147483647;
const inFlight = new Map();
const completed = new Map();

function cleanPrompt(value) { return String(value || '').trim().slice(0, MAX_PROMPT); }

export function enhancePrompt(prompt, visualHints = '') {
  const base = cleanPrompt(prompt);
  if (!base) return base;
  const refs = cleanPrompt(visualHints);
  const inspiration = refs ? ` Indices issus de références visuelles Google Images France, à utiliser uniquement comme inspiration générale sans reproduire une image précise : ${refs}.` : '';
  const guidance = ' Composition impérative : représenter clairement tous les sujets, personnes, objets, attributs et relations explicitement demandés ; ne rien omettre. Les personnes mentionnées doivent être nettement visibles et reconnaissables dans la scène. Respecter fidèlement le nombre, la position relative et les détails décrits. Par défaut, lorsque le prompt ne précise pas une autre origine, région ou esthétique, privilégier un rendu européen contemporain, naturel et photoréaliste, avec des proportions réalistes et sans stylisation artificielle.';
  return `${base}.${inspiration}${guidance}`.slice(0, MAX_PROMPT);
}

function json(res, status, body, extra = {}) { res.statusCode=status; res.setHeader('Content-Type','application/json; charset=utf-8'); res.setHeader('Cache-Control','no-store'); for(const[k,v]of Object.entries(extra))res.setHeader(k,v); res.end(JSON.stringify(body)); }
function modelFor(size) { return size >= 1024 ? '@cf/black-forest-labs/flux-1-schnell' : '@cf/black-forest-labs/flux-2-klein-4b'; }
function hash(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function requestFingerprint(prompt,size){return hash(`${size}\n${prompt}`)}
function cacheKey(requestId,fingerprint){return `ia-perso:${hash(`${requestId}:${fingerprint}`)}`}
export function seedFor(requestId){return parseInt(hash(requestId).slice(0,8),16)%(MAX_IMAGE_SEED+1)}
function extractBase64(payload){return payload?.result?.image||payload?.image||payload?.result?.result?.image||null}
function isRetryableProviderFailure(error){const status=Number(error?.status)||0;return !status||status===408||status===425||status===429||status>=500}

function words(s){return String(s||'').toLocaleLowerCase('fr-FR').normalize('NFD').replace(/[\u0300-\u036f]/g,'').match(/[a-z0-9]{3,}/g)||[]}
function referenceScore(item,promptWords){const text=words(`${item.title||''} ${item.snippet||''} ${item.displayLink||''}`);const set=new Set(text);return promptWords.reduce((n,w)=>n+(set.has(w)?1:0),0)}

async function googleVisualHints(prompt){
  const key=process.env.GOOGLE_CSE_API_KEY, cx=process.env.GOOGLE_CSE_CX;
  if(!key||!cx)return '';
  try{
    const u=new URL('https://www.googleapis.com/customsearch/v1');
    for(const[k,v]of Object.entries({key,cx,q:prompt,searchType:'image',num:'10',safe:'off',filter:'0',hl:'fr',gl:'fr',lr:'lang_fr',cr:'countryFR'}))u.searchParams.set(k,v);
    const r=await fetch(u,{headers:{Accept:'application/json'}}); const p=await r.json().catch(()=>({})); if(!r.ok)return '';
    const pw=[...new Set(words(prompt))];
    const ranked=(p.items||[]).map(x=>({...x,_score:referenceScore(x,pw)})).sort((a,b)=>b._score-a._score).slice(0,3);
    return ranked.map(x=>`${x.title||''}${x.snippet?` — ${x.snippet}`:''}`).filter(Boolean).join(' ; ').slice(0,700);
  }catch{return ''}
}

async function callCloudflare({prompt,size,requestId,fingerprint}){
  const accountId=process.env.CLOUDFLARE_ACCOUNT_ID, token=process.env.CLOUDFLARE_API_TOKEN, gatewayId=process.env.CLOUDFLARE_AI_GATEWAY_ID||'default'; if(!accountId||!token)return null;
  const model=modelFor(size), endpoint=`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/run/${model}`;
  const headers={Authorization:`Bearer ${token}`,'cf-aig-gateway-id':gatewayId,'cf-aig-cache-key':cacheKey(requestId,fingerprint),'cf-aig-cache-ttl':String(CACHE_TTL_SECONDS),'cf-aig-request-timeout':'30000','cf-aig-max-attempts':'2','cf-aig-retry-delay':'250','cf-aig-backoff':'exponential','cf-aig-collect-log':'true','cf-aig-collect-log-payload':'false','cf-aig-metadata':JSON.stringify({app:'ia-perso',requestId,size,model})};
  const seed=seedFor(requestId); let body;
  if(model.includes('flux-2-klein')){body=new FormData();body.append('prompt',prompt);body.append('width',String(size));body.append('height',String(size));body.append('seed',String(seed));}
  else{headers['Content-Type']='application/json';body=JSON.stringify({prompt,width:size,height:size,steps:4,seed});}
  const response=await fetch(endpoint,{method:'POST',headers,body});const text=await response.text();let payload={};try{payload=text?JSON.parse(text):{}}catch{}
  if(!response.ok||payload?.success===false){const err=new Error(payload?.errors?.[0]?.message||payload?.error||`Cloudflare HTTP ${response.status}`);err.status=response.status;throw err}
  const image=extractBase64(payload);if(!image){const err=new Error('Cloudflare n’a retourné aucune image exploitable.');err.status=502;throw err}
  return{dataUri:`data:image/jpeg;base64,${image}`,provider:'cloudflare',model,size};
}
function pollinationsUrl(prompt,size,requestId){const u=new URL(`https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}`);u.searchParams.set('width',String(size));u.searchParams.set('height',String(size));u.searchParams.set('model','flux');u.searchParams.set('safe','false');u.searchParams.set('seed',String(seedFor(requestId)));return u.toString()}
async function callPollinations({prompt,size,requestId}){const response=await fetch(pollinationsUrl(prompt,size,requestId),{headers:{Accept:'image/*'},redirect:'follow'});const contentType=(response.headers.get('content-type')||'').split(';')[0].trim();if(!response.ok){const err=new Error(`Pollinations HTTP ${response.status}`);err.status=response.status;throw err}if(!contentType.startsWith('image/')){const err=new Error('Pollinations n’a pas renvoyé une image.');err.status=502;throw err}const bytes=Buffer.from(await response.arrayBuffer());if(!bytes.length||bytes.length>MAX_IMAGE_BYTES){const err=new Error('Image Pollinations inexploitable.');err.status=502;throw err}return{dataUri:`data:${contentType};base64,${bytes.toString('base64')}`,provider:'pollinations',model:'flux',size,degraded:true}}

async function generateOnce({prompt,size,requestId,fingerprint}){
  const visualHints=await googleVisualHints(prompt);
  const effectivePrompt=enhancePrompt(prompt,visualHints);
  try{const cloudflare=await callCloudflare({prompt:effectivePrompt,size,requestId,fingerprint});if(cloudflare)return{...cloudflare,visualPreScreening:Boolean(visualHints)}}catch(error){if(!isRetryableProviderFailure(error))throw error;console.warn('cloudflare_transient_fallback',{requestId,status:error?.status||0,message:error?.message})}
  const fallback=await callPollinations({prompt:effectivePrompt,size:Math.min(size,768),requestId});return{...fallback,visualPreScreening:Boolean(visualHints)};
}
function pruneCompleted(now=Date.now()){for(const[key,entry]of completed)if(now-entry.at>=CACHE_TTL_SECONDS*1000)completed.delete(key);if(completed.size>100){const oldest=[...completed.entries()].sort((a,b)=>a[1].at-b[1].at).slice(0,completed.size-100);for(const[key]of oldest)completed.delete(key)}}
export default async function handler(req,res){if(req.method!=='POST')return json(res,405,{error:'Méthode non autorisée.'},{Allow:'POST'});let body=req.body;if(typeof body==='string'){try{body=JSON.parse(body)}catch{body={}}}const prompt=cleanPrompt(body?.prompt),requestId=String(body?.requestId||'').trim(),requestedSize=Number(body?.size)>=1024?1024:512;if(!prompt)return json(res,400,{error:'Prompt vide.'});if(!/^[a-zA-Z0-9_-]{12,128}$/.test(requestId))return json(res,400,{error:'requestId invalide.'});const fingerprint=requestFingerprint(prompt,requestedSize);pruneCompleted();const old=completed.get(requestId);if(old){if(old.fingerprint!==fingerprint)return json(res,409,{error:'requestId déjà utilisé avec une autre demande.'});return json(res,200,{...old.value,cached:true})}const current=inFlight.get(requestId);if(current){if(current.fingerprint!==fingerprint)return json(res,409,{error:'requestId déjà utilisé avec une autre demande.'});try{return json(res,200,{...(await current.task),shared:true})}catch(error){return json(res,Number(error?.status)||502,{error:error?.message||'Échec de génération.'})}}const task=generateOnce({prompt,size:requestedSize,requestId,fingerprint});inFlight.set(requestId,{fingerprint,task});try{const value=await task;completed.set(requestId,{at:Date.now(),fingerprint,value});pruneCompleted();return json(res,200,value)}catch(error){console.error('generation_failed',{requestId,message:error?.message,status:error?.status});return json(res,Number(error?.status)||502,{error:error?.message||'Échec de génération.'})}finally{inFlight.delete(requestId)}}
