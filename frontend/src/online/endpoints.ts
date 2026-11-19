/** Public build-time endpoints. Never put credentials in VITE_ variables. */
export interface EndpointEnvironment {VITE_API_BASE_URL?:string;VITE_API_BASE?:string;VITE_WS_URL?:string}
export function apiBaseFromEnv(env:EndpointEnvironment):string {
  return (env.VITE_API_BASE_URL?.trim()||env.VITE_API_BASE?.trim()||'/api').replace(/\/+$/,'')||'/api';
}

/** A full explicit WS endpoint wins; otherwise use the API origin and the
 * server's advertised path. HTTPS pages must never attempt mixed-content ws. */
export function websocketUrl(apiBase:string,pageHref:string,override?:string,advertisedPath='/api/multiplayer/ws'):string {
  const page=new URL(pageHref);
  let url:URL;
  try{
    if(override?.trim())url=new URL(override.trim(),page);
    else{
      url=new URL(apiBase,page);
      if(!advertisedPath.startsWith('/')||advertisedPath.startsWith('//'))throw new Error('Invalid WebSocket path');
      url.pathname=advertisedPath;
    }
  }catch{throw new Error('Invalid multiplayer endpoint configuration. Check VITE_API_BASE_URL and VITE_WS_URL.');}
  if(!['http:','https:','ws:','wss:'].includes(url.protocol)||url.username||url.password||url.search||url.hash){
    throw new Error('WebSocket URL must be an HTTP(S) or WS(S) endpoint without credentials, query strings or fragments.');
  }
  url.protocol=page.protocol==='https:'||url.protocol==='https:'||url.protocol==='wss:'?'wss:':'ws:';
  return url.href;
}
