"""Loopback WebSocket load test with real auth: 50+ peers across 2–8-seat rooms.
Starts/stops only its own API and deletes only its own temporary SQLite database.
Latency is first peer-snapshot receipt minus the sender's monotonic send time.
"""
import argparse
import asyncio
import json
import os
from pathlib import Path
import platform
import secrets
import statistics
import subprocess
import sys
import tempfile
import time
import threading
import httpx
import psutil
from websockets.asyncio.client import connect

ROOT = Path(__file__).resolve().parents[1]


def percentile(values, p):
    if not values:
        return None
    ordered = sorted(values)
    return round(ordered[min(len(ordered)-1, int((len(ordered)-1)*p))], 3)


async def exercise(args, process, server_log):
    base = f'http://127.0.0.1:{args.port}'
    async with httpx.AsyncClient(base_url=base, timeout=20) as http:
        for _ in range(150):
            if process.poll() is not None:
                raise RuntimeError('Load-test API exited: ' + ''.join(server_log)[-3000:])
            try:
                if (await http.get('/api/health')).status_code == 200:
                    break
            except httpx.HTTPError:
                pass
            await asyncio.sleep(.1)
        semaphore = asyncio.Semaphore(3)
        async def register(i):
            async with semaphore:
                r = await http.post('/api/auth/register', json={'email': f'load-{i}@example.com', 'password': 'load-test-only-password-42', 'display_name': f'Load Driver {i:02}'})
                r.raise_for_status()
                value = r.json()
                return {'id': value['user_id'], 'headers': {'Authorization': 'Bearer ' + value['access_token']}}
        accounts = await asyncio.gather(*(register(i) for i in range(args.clients)))
        room_codes = []
        room_maps = []
        for start in range(0, args.clients, 8):
            region = ['northbank', 'meridian', 'coastway'][(start//8)%3] if args.regions else 'northbank'
            room_maps.append(region)
            r = await http.post('/api/multiplayer/rooms', headers=accounts[start]['headers'], json={'mode': 'city', 'private': False, 'capacity': 8, 'map_id': region})
            r.raise_for_status();room_codes.append(r.json()['code'])
        sockets = []
        spawns = []
        for i, account in enumerate(accounts):
            r = await http.post('/api/multiplayer/ticket', headers=account['headers'], json={'code': room_codes[i//8]})
            r.raise_for_status()
            ws = await connect(f'ws://127.0.0.1:{args.port}/api/multiplayer/ws', origin='http://127.0.0.1:4173', max_queue=32)
            await ws.send(json.dumps({'type': 'join', 'ticket': r.json()['ticket']}))
            welcome = json.loads(await ws.recv())
            assert welcome['type'] == 'welcome', welcome
            spawns.append(welcome['pose']['p'])
            sockets.append(ws)
        server = psutil.Process(process.pid)
        baseline = server.memory_info().rss
        peak = baseline
        latencies = []
        received = [0]*args.clients
        measured_received = [0]*args.clients
        sent = [0]*args.clients
        rejected = []
        start_time = time.perf_counter()
        async def reader(i, ws):
            seen = {}
            try:
                async for raw in ws:
                    message = json.loads(raw)
                    if message.get('type') == 'rejected':
                        rejected.append(message['reason'])
                    if message.get('type') != 'snapshot':
                        continue
                    received[i] += 1
                    if .5 < time.perf_counter()-start_time < args.seconds:
                        measured_received[i] += 1
                    now_ms = time.perf_counter()*1000
                    for pose in message['players']:
                        if pose['id'] == accounts[i]['id'] or pose['seq'] < 0 or pose['seq'] <= seen.get(pose['id'], -1):
                            continue
                        seen[pose['id']] = pose['seq']
                        if pose['client_time']:
                            latencies.append(now_ms-pose['client_time'])
            except Exception:
                pass
        async def sender(i, ws):
            seq = 0
            while time.perf_counter()-start_time < args.seconds:
                elapsed = time.perf_counter()-start_time
                speed = min(4, elapsed)
                distance = .5*elapsed*elapsed if elapsed < 4 else 8+4*(elapsed-4)
                x,y,z = spawns[i]
                await ws.send(json.dumps({'type':'pose','seq':seq,'p':[x,y,z-distance],'q':[0,0,0,1],'speed':speed,'keys':{'throttle':.3},'client_time':time.perf_counter()*1000}))
                sent[i] += 1;seq += 1
                await asyncio.sleep(1/15)
        async def memory():
            nonlocal peak
            while time.perf_counter()-start_time < args.seconds:
                peak = max(peak,server.memory_info().rss)
                await asyncio.sleep(.1)
        readers = [asyncio.create_task(reader(i, ws)) for i, ws in enumerate(sockets)]
        await asyncio.gather(*(sender(i, ws) for i, ws in enumerate(sockets)), memory())
        duration = time.perf_counter()-start_time
        await asyncio.sleep(.3)
        after_load = server.memory_info().rss
        for ws in sockets:
            try:
                await ws.send(json.dumps({'type':'leave'}))
                await ws.close()
            except Exception:
                pass
        await asyncio.gather(*readers, return_exceptions=True)
        await asyncio.sleep(1)
        remaining = (await http.get('/api/multiplayer/rooms', headers=accounts[0]['headers'])).json()['items']
        report = {'clients':args.clients,'rooms':len(room_codes),'duration_seconds':round(duration,2),'transport':'loopback, real WebSockets, authenticated city rooms',
                  'snapshot_hz_configured':15,'snapshot_hz_observed':round(sum(measured_received)/args.clients/max(.1,args.seconds-.5),2),'maps':room_maps,'pose_hz_average':round(sum(sent)/args.clients/duration,2),
                  'snapshots_received':sum(received),'peer_latency_samples':len(latencies),
                  'update_latency_ms':{'p50':percentile(latencies,.5),'p95':percentile(latencies,.95),'p99':percentile(latencies,.99),'max':round(max(latencies),3) if latencies else None},
                  'server_rss_mib':{'before_streaming':round(baseline/1048576,2),'peak':round(peak/1048576,2),'after_streaming':round(after_load/1048576,2),'after_cleanup':round(server.memory_info().rss/1048576,2),'growth':round((peak-baseline)/1048576,2)},
                  'rejected_updates':rejected,'rooms_after_cleanup':len(remaining),'platform':platform.platform(),'python':platform.python_version(),
                  'method':'Latency clocks are shared by simulated peers in one process. RSS is the API process only, sampled every 100 ms. Registration precedes the memory baseline. No 3D rendering or internet latency is included.'}
        assert args.clients >= 50
        assert not rejected, rejected[:10]
        assert len(latencies) > args.clients*20
        assert report['update_latency_ms']['p95'] < 300, report
        assert len(remaining) == 0
        return report


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--clients', type=int, default=50)
    parser.add_argument('--seconds', type=int, default=20)
    parser.add_argument('--port', type=int, default=8010)
    parser.add_argument('--regions', action='store_true', help='Spread rooms across all three maps')
    args = parser.parse_args()
    import socket
    probe = socket.socket()
    try:
        probe.bind(('127.0.0.1', args.port))
    finally:
        probe.close()
    with tempfile.TemporaryDirectory(prefix='citybus-load-') as directory:
        environment = {**os.environ, 'DATABASE_URL': f'sqlite:///{directory}/load.db', 'JWT_SECRET': secrets.token_urlsafe(48), 'ENVIRONMENT':'development', 'COOKIE_SECURE':'false', 'RATE_LIMIT_PER_MINUTE':'20000', 'MULTIPLAYER_MAX_CONNECTIONS':'128'}
        for command in ([sys.executable,'-m','alembic','upgrade','head'],[sys.executable,'-m','app.seed']):
            subprocess.run(command,cwd=ROOT,env=environment,check=True,capture_output=True)
        server_log=[]
        process=subprocess.Popen([sys.executable,'-m','uvicorn','app.main:app','--host','127.0.0.1','--port',str(args.port),'--no-access-log'],cwd=ROOT,env=environment,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True)
        def drain():
            for line in process.stdout:
                server_log.append(line)
        threading.Thread(target=drain,daemon=True).start()
        try:
            report=asyncio.run(exercise(args,process,server_log))
            path=ROOT/'test-results/multiplayer-load.json';path.parent.mkdir(exist_ok=True)
            path.write_text(json.dumps(report,indent=2)+'\n')
            print(json.dumps(report,indent=2))
        finally:
            process.terminate()
            try:process.wait(timeout=10)
            except subprocess.TimeoutExpired:process.kill();process.wait()
            (ROOT/'test-results').mkdir(exist_ok=True)
            (ROOT/'test-results/multiplayer-load-server.log').write_text(''.join(server_log))

if __name__=='__main__':main()
