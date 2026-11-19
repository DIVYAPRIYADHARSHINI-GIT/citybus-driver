import {afterEach,describe,it,expect,vi} from 'vitest';
import {apiBaseFromEnv,websocketUrl} from '../src/online/endpoints';
import {ApiClient} from '../src/online/api';
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
describe('public deployment endpoints',()=>{
 it('keeps local defaults and the legacy alias, with canonical URL precedence',()=>{expect(apiBaseFromEnv({})).toBe('/api');expect(apiBaseFromEnv({VITE_API_BASE:'https://legacy.example/api/'})).toBe('https://legacy.example/api');expect(apiBaseFromEnv({VITE_API_BASE_URL:' https://api.example/api/// ',VITE_API_BASE:'/old'})).toBe('https://api.example/api');expect(apiBaseFromEnv({VITE_API_BASE_URL:' ',VITE_API_BASE:'/api'})).toBe('/api');});
 it.each([
  ['/api','http://localhost:5173/',undefined,'ws://localhost:5173/api/multiplayer/ws'],
  ['https://api.example.com/api','http://localhost:5173/',undefined,'wss://api.example.com/api/multiplayer/ws'],
  ['http://api.example.com/api','https://game.example.com/',undefined,'wss://api.example.com/api/multiplayer/ws'],
  ['/api','https://game.example.com/','ws://rooms.example.com/api/multiplayer/ws','wss://rooms.example.com/api/multiplayer/ws'],
  ['/api','https://game.example.com/','http://rooms.example.com/api/multiplayer/ws','wss://rooms.example.com/api/multiplayer/ws'],
  ['/api','https://game.example.com/','wss://rooms.example.com/custom/ws','wss://rooms.example.com/custom/ws'],
  ['/api','https://game.example.com/','/api/multiplayer/ws','wss://game.example.com/api/multiplayer/ws'],
  ['/api','http://localhost:5173/','ws://localhost:8000/api/multiplayer/ws','ws://localhost:8000/api/multiplayer/ws'],
 ] as const)('resolves secure/local WebSocket case %#',(api,page,override,expected)=>expect(websocketUrl(api,page,override)).toBe(expected));
 it.each(['ftp://api.example/ws','wss://user:password@api.example/ws','wss://api.example/ws?token=secret','wss://api.example/ws#token'])('refuses unsafe WebSocket configuration %s',url=>expect(()=>websocketUrl('/api','https://app.example/',url)).toThrow());
 it('cannot redirect a ticket to a different origin through an advertised path',()=>expect(()=>websocketUrl('/api','https://app.example/',undefined,'//attacker.example/ws')).toThrow());
 it('reads VITE_API_BASE_URL at construction and keeps credentials/no-store semantics',async()=>{vi.stubEnv('VITE_API_BASE_URL','https://api.example.com/api/');vi.stubEnv('VITE_API_BASE','/old');const transport=vi.fn().mockResolvedValue(new Response(JSON.stringify({status:'ok'}),{headers:{'Content-Type':'application/json'}}));const api=new ApiClient(undefined,transport);await api.request('/health',{auth:false});expect(transport.mock.calls[0][0]).toBe('https://api.example.com/api/health');expect(transport.mock.calls[0][1]).toMatchObject({credentials:'include',cache:'no-store'});});
});
