import asyncio
from copy import deepcopy
from datetime import datetime, timezone
from uuid import uuid4
import time
import math
import pytest
from sqlalchemy import select, func
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect
from app.models import BoardEntry, Player, SocialPreference, RoomParticipation, MultiplayerReward, IntegrityEvent, Ledger, now
from app.leaderboards import week_key, record_profit
from app.multiplayer_rules import Movement, SPAWN, validate_pose, accept_pose, checkpoint_crossed
from app.rooms import RoomManager, Member
from app.multiplayer_rewards import award_race
from tests.test_api import valid_result

ORIGIN = {'origin': 'http://127.0.0.1:4173'}


def other(client, name='Second Driver'):
    body={'email':f'{uuid4()}@example.com','password':'another-long-password-42','display_name':name}
    r=client.post('/api/auth/register',json=body);assert r.status_code==201,r.text
    value=r.json();value['headers']={'Authorization':'Bearer '+value['access_token']};return value


def befriend(client,a,b):
    r=client.post('/api/social/requests',headers=a['headers'],json={'player_id':b['user_id']});assert r.status_code==200,r.text
    accepted=client.post('/api/social/requests/'+r.json()['id'],headers=b['headers'],json={'action':'accept'});assert accepted.status_code==200
    return r.json()['id']


def ticket(client,account,code,resume=None):
    body={'code':code,'model_id':'cb-120','paint':'#217a6d'}
    if resume:body['resume_token']=resume
    r=client.post('/api/multiplayer/ticket',headers=account['headers'],json=body);assert r.status_code==200,r.text
    return r.json()['ticket']


def receive(ws,kind,condition=lambda x:True):
    for _ in range(100):
        value=ws.receive_json()
        if value.get('type')==kind and condition(value):return value
    raise AssertionError(f'No {kind} message')


def create(client,a,mode='city',private=False,capacity=8):
    r=client.post('/api/multiplayer/rooms',headers=a['headers'],json={'mode':mode,'private':private,'capacity':capacity});assert r.status_code==201,r.text;return r.json()


def test_friend_request_lifecycle_and_actor_rules(client,account):
    b=other(client);r=client.post('/api/social/requests',headers=account['headers'],json={'player_id':b['user_id']}).json()
    assert client.post('/api/social/requests/'+r['id'],headers=account['headers'],json={'action':'accept'}).status_code==409
    assert client.post('/api/social/requests/'+r['id'],headers=b['headers'],json={'action':'accept'}).json()['state']=='accepted'
    assert client.get('/api/social/friends',headers=b['headers']).json()['items'][0]['player_id']==account['user_id']
    assert client.post('/api/social/requests/'+r['id'],headers=account['headers'],json={'action':'remove'}).json()['state']=='removed'
    assert client.get('/api/social/friends',headers=b['headers']).json()['items']==[]


@pytest.mark.parametrize('action,actor', [('cancel','sender'),('decline','recipient')])
def test_pending_friend_cancel_decline(client,account,action,actor):
    b=other(client);r=client.post('/api/social/requests',headers=account['headers'],json={'player_id':b['user_id']}).json()
    h=account['headers'] if actor=='sender' else b['headers']
    assert client.post('/api/social/requests/'+r['id'],headers=h,json={'action':action}).status_code==200
    assert client.get('/api/social/friends',headers=account['headers']).json()['items']==[]


def test_block_enforced_both_directions_for_requests_profiles_and_messages(client,account):
    b=other(client);befriend(client,account,b)
    assert client.put('/api/social/blocks/'+b['user_id'],headers=account['headers']).status_code==200
    for a,target in [(account,b),(b,account)]:
        assert client.post('/api/social/requests',headers=a['headers'],json={'player_id':target['user_id']}).status_code==404
        assert client.get('/api/social/players/'+target['user_id'],headers=a['headers']).status_code==404
        assert client.post('/api/social/messages/'+target['user_id'],headers=a['headers'],json={'message_id':str(uuid4()),'text':'hello'}).status_code==404
    assert client.delete('/api/social/blocks/'+b['user_id'],headers=account['headers']).status_code==204
    assert client.get('/api/social/players/'+b['user_id'],headers=account['headers']).status_code==200


def test_profiles_do_not_disclose_private_economy_or_email(client,account):
    b=other(client)
    data=client.get('/api/social/players/'+b['user_id'],headers=account['headers']).json()
    assert 'email' not in data and 'money' not in data and 'settings' not in data
    assert data['showcase'][0]['name']=='CB 120' and data['online'] is None
    assert client.put('/api/social/privacy',headers=b['headers'],json={'profile_visibility':'private','online_visibility':'hidden','leaderboards_visible':False,'showcase':[]}).status_code==200
    assert client.get('/api/social/players/'+b['user_id'],headers=account['headers']).status_code==404
    assert not client.get('/api/social/players?q=Second',headers=account['headers']).json()['items']


def test_friends_only_profile_and_showcase_ownership(client,account):
    b=other(client);bus=client.get('/api/fleet',headers=account['headers']).json()['items'][0]
    privacy={'profile_visibility':'friends','online_visibility':'friends','showcase':[]}
    assert client.put('/api/social/privacy',headers=b['headers'],json={**privacy,'showcase':[bus['id']]}).status_code==422
    client.put('/api/social/privacy',headers=b['headers'],json=privacy)
    assert client.get('/api/social/players/'+b['user_id'],headers=account['headers']).status_code==404
    befriend(client,account,b)
    assert client.get('/api/social/players/'+b['user_id'],headers=account['headers']).status_code==200


def test_direct_chat_filter_idempotency_limits_mute_and_report(client,account):
    b=other(client);befriend(client,account,b);message={'message_id':str(uuid4()),'text':'that SHIT is broken'}
    r=client.post('/api/social/messages/'+b['user_id'],headers=account['headers'],json=message)
    assert r.status_code==200 and '****' in r.json()['text']
    assert client.post('/api/social/messages/'+b['user_id'],headers=account['headers'],json=message).json()['id']==r.json()['id']
    report=client.post('/api/social/reports',headers=b['headers'],json={'report_id':str(uuid4()),'player_id':account['user_id'],'reason':'harassment','message_id':r.json()['id']})
    assert report.status_code==200 and report.json()['status']=='queued_for_review'
    for _ in range(4):assert client.post('/api/social/messages/'+b['user_id'],headers=account['headers'],json={'message_id':str(uuid4()),'text':'hello'}).status_code==200
    assert client.post('/api/social/messages/'+b['user_id'],headers=account['headers'],json={'message_id':str(uuid4()),'text':'too fast'}).status_code==429
    client.put('/api/social/mutes/'+account['user_id'],headers=b['headers'])
    assert client.get('/api/social/messages/'+account['user_id'],headers=b['headers']).json()['items']==[]
    assert client.post('/api/social/messages/'+b['user_id'],headers=account['headers'],json={'message_id':str(uuid4()),'text':'muted'}).status_code==403


@pytest.mark.parametrize('message',['','   ','a'*241,'hello\u0000world'])
def test_bad_message_validation(client,account,message):
    b=other(client);befriend(client,account,b)
    assert client.post('/api/social/messages/'+b['user_id'],headers=account['headers'],json={'message_id':str(uuid4()),'text':message}).status_code==422


def test_report_cannot_read_another_players_dm(client,account):
    b=other(client);c=other(client,'Third Driver');befriend(client,b,c)
    msg=client.post('/api/social/messages/'+c['user_id'],headers=b['headers'],json={'message_id':str(uuid4()),'text':'private conversation'}).json()
    r=client.post('/api/social/reports',headers=account['headers'],json={'report_id':str(uuid4()),'player_id':b['user_id'],'reason':'other','message_id':msg['id']})
    assert r.status_code==404


def test_leaderboards_only_use_accepted_idempotent_results(client,account):
    bad=valid_result();bad['seconds']=1
    assert client.post('/api/results',headers=account['headers'],json=bad).status_code==422
    assert client.get('/api/leaderboards',headers=account['headers']).json()['total']==0
    good=valid_result();assert client.post('/api/results',headers=account['headers'],json=good).status_code==200
    client.post('/api/results',headers=account['headers'],json=good)
    board=client.get('/api/leaderboards?board=time&period=all',headers=account['headers']).json()
    assert board['total']==1 and board['items'][0]['value']==100000
    good['seconds']=90
    assert client.post('/api/results',headers=account['headers'],json=good).status_code==409
    assert client.post('/api/leaderboards',headers=account['headers'],json={'score':9999}).status_code==405


def test_best_run_pagination_around_me_and_friends_filter(client,account):
    b=other(client);c=other(client,'Third Driver');befriend(client,account,b)
    for who,seconds in [(account,100),(b,80),(c,70),(account,95)]:
        body=valid_result();body['seconds']=seconds;assert client.post('/api/results',headers=who['headers'],json=body).status_code==200
    board=client.get('/api/leaderboards?board=time&period=all&page_size=1&page=2',headers=account['headers']).json()
    assert board['total']==3 and board['items'][0]['player_id']==b['user_id']
    around=client.get('/api/leaderboards?board=time&period=all&page_size=1&around_me=true',headers=account['headers']).json()
    assert around['items'][0]['player_id']==account['user_id'] and around['my_rank']==3
    friends=client.get('/api/leaderboards?board=time&period=all&friends_only=true',headers=account['headers']).json()
    assert {r['player_id'] for r in friends['items']}=={account['user_id'],b['user_id']}
    client.put('/api/social/blocks/'+c['user_id'],headers=account['headers'])
    assert client.get('/api/leaderboards?board=time&period=all',headers=account['headers']).json()['total']==2


def test_week_boundary_reset_and_archived_history(client,account,app):
    body=valid_result();client.post('/api/results',headers=account['headers'],json=body)
    with app.state.sessions() as db:
        row=db.scalar(select(BoardEntry).where(BoardEntry.source_type=='route'))
        row.week='2026-01-05';db.commit()
    assert client.get('/api/leaderboards?period=weekly',headers=account['headers']).json()['total']==0
    archived=client.get('/api/leaderboards?period=weekly&week=2026-01-05',headers=account['headers']).json()
    assert archived['total']==1 and archived['archived']
    assert any(w['week']=='2026-01-05' for w in client.get('/api/leaderboards/weeks',headers=account['headers']).json()['weeks'])
    assert week_key(datetime(2026,1,11,23,59,tzinfo=timezone.utc).timestamp())=='2026-01-05'
    assert week_key(datetime(2026,1,12,tzinfo=timezone.utc).timestamp())=='2026-01-12'


def test_profit_board_excludes_financing_and_rewards(client,account,app):
    with app.state.sessions() as db:
        for kind,amount in [('tycoon_ai_fares',10000),('tycoon_wages',-3000),('tycoon_loan_draw',500000),('mission_reward',25000)]:
            row=Ledger(user_id=account['user_id'],kind=kind,amount=amount,reference=str(uuid4()));db.add(row);record_profit(db,row)
        db.commit()
    board=client.get('/api/leaderboards?board=profit&period=all',headers=account['headers']).json()
    assert board['items'][0]['value']==7000


def test_review_and_privacy_hide_board_entries(client,account,app):
    b=other(client);client.post('/api/results',headers=b['headers'],json=valid_result())
    with app.state.sessions() as db:db.add(SocialPreference(user_id=b['user_id'],review_flag=True));db.commit()
    assert client.get('/api/leaderboards',headers=account['headers']).json()['total']==0


def test_shared_session_reward_uses_validated_result_and_is_once_per_session(client,account,app):
    room_id=str(uuid4())
    with app.state.sessions() as db:
        db.add(RoomParticipation(room_id=room_id,user_id=account['user_id'],mode='city',joined_at=now()-100,distance_m=340,valid_updates=100,review_flag=False))
        db.commit()
    body=valid_result();first=client.post('/api/results',headers=account['headers'],json=body)
    assert first.status_code==200,first.text
    assert first.json()['profile']['xp']==312
    assert first.json()['profile']['money']==5026900
    client.post('/api/results',headers=account['headers'],json=body)
    client.post('/api/results',headers=account['headers'],json=valid_result())
    rewards=client.get('/api/multiplayer/rewards',headers=account['headers']).json()['items']
    assert len(rewards)==1 and rewards[0]['kind']=='session'


def test_room_chat_retries_do_not_duplicate_room_history(client,account,app):
    room=create(client,account)
    with client.websocket_connect('/api/multiplayer/ws',headers=ORIGIN) as ws:
        ws.send_json({'type':'join','ticket':ticket(client,account,room['code'])});receive(ws,'welcome')
        message={'type':'chat','message_id':str(uuid4()),'text':'One message'}
        ws.send_json(message);receive(ws,'chat');ws.send_json(message);receive(ws,'chat')
        assert len(app.state.rooms.rooms[room['code']].chat)==1


def test_binary_websocket_frames_are_closed_without_an_application_error(client,account):
    room=create(client,account)
    with client.websocket_connect('/api/multiplayer/ws',headers=ORIGIN) as ws:
        ws.send_json({'type':'join','ticket':ticket(client,account,room['code'])});receive(ws,'welcome')
        ws.send_bytes(b'not-json')
        with pytest.raises(WebSocketDisconnect):
            while True:ws.receive_json()


def test_room_lifecycle_ready_host_controls_chat_and_close(client,account):
    b=other(client);room=create(client,account,'race',True,2)
    assert client.get('/api/multiplayer/rooms?mode=race',headers=b['headers']).json()['items']==[]
    with client.websocket_connect('/api/multiplayer/ws',headers=ORIGIN) as a_ws:
        a_ws.send_json({'type':'join','ticket':ticket(client,account,room['code'])});welcome=receive(a_ws,'welcome');assert welcome['room']['collision_policy']=='ghost-player-buses'
        with client.websocket_connect('/api/multiplayer/ws',headers=ORIGIN) as b_ws:
            b_ws.send_json({'type':'join','ticket':ticket(client,b,room['code'])});receive(b_ws,'welcome')
            b_ws.send_json({'type':'start'});assert receive(b_ws,'error')['code']=='host_only'
            a_ws.send_json({'type':'start'});assert receive(a_ws,'error')['code']=='not_ready'
            a_ws.send_json({'type':'ready','ready':True});b_ws.send_json({'type':'ready','ready':True})
            receive(a_ws,'room',lambda m:len(m['room']['members'])==2 and all(p['ready'] for p in m['room']['members']))
            a_ws.send_json({'type':'start'});assert receive(a_ws,'room',lambda m:m['room']['state']=='countdown')['room']['countdown']>0
            a_ws.send_json({'type':'chat','message_id':str(uuid4()),'text':'hello SHIT'});assert '****' in receive(b_ws,'chat')['message']['text']
            a_ws.send_json({'type':'close'});assert receive(b_ws,'left')['reason']=='host_closed'
    assert client.get('/api/multiplayer/rooms?mode=race',headers=account['headers']).json()['items']==[]


def test_public_directory_does_not_bypass_hidden_online_status(client,account):
    b=other(client)
    client.put('/api/social/privacy',headers=account['headers'],json={'profile_visibility':'private','online_visibility':'hidden','leaderboards_visible':False,'showcase':[]})
    room=create(client,account)
    with client.websocket_connect('/api/multiplayer/ws',headers=ORIGIN) as ws:
        ws.send_json({'type':'join','ticket':ticket(client,account,room['code'])});receive(ws,'welcome')
        directory=client.get('/api/multiplayer/rooms',headers=b['headers']).json()['items']
        assert directory[0]['member_count']==1
        assert directory[0]['members']==[] and 'host_id' not in directory[0]
        assert account['user_id'] not in str(directory)


def test_reconnect_token_restores_same_member_and_rejects_wrong_token(client,account):
    room=create(client,account)
    with client.websocket_connect('/api/multiplayer/ws',headers=ORIGIN) as ws:
        ws.send_json({'type':'join','ticket':ticket(client,account,room['code'])});resume=receive(ws,'welcome')['resume_token']
    with client.websocket_connect('/api/multiplayer/ws',headers=ORIGIN) as ws:
        ws.send_json({'type':'join','ticket':ticket(client,account,room['code'],'x'*32)});assert receive(ws,'error')['code']=='invalid_resume'
    with client.websocket_connect('/api/multiplayer/ws',headers=ORIGIN) as ws:
        ws.send_json({'type':'join','ticket':ticket(client,account,room['code'],resume)});welcome=receive(ws,'welcome');assert len(welcome['room']['members'])==1;assert welcome['resume_token']!=resume


def test_ticket_is_one_use_and_origin_is_checked(client,account):
    room=create(client,account);one=ticket(client,account,room['code'])
    with client.websocket_connect('/api/multiplayer/ws',headers=ORIGIN) as ws:
        ws.send_json({'type':'join','ticket':one});receive(ws,'welcome')
    with client.websocket_connect('/api/multiplayer/ws',headers=ORIGIN) as ws:
        ws.send_json({'type':'join','ticket':one});assert receive(ws,'error')['code']=='invalid_ticket'
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect('/api/multiplayer/ws',headers={'origin':'https://evil.example'}):pass


def test_block_prevents_join_even_with_a_code_and_removes_blocked_guest(client,account):
    b=other(client);room=create(client,account)
    with client.websocket_connect('/api/multiplayer/ws',headers=ORIGIN) as a_ws:
        a_ws.send_json({'type':'join','ticket':ticket(client,account,room['code'])});receive(a_ws,'welcome')
        with client.websocket_connect('/api/multiplayer/ws',headers=ORIGIN) as b_ws:
            b_ws.send_json({'type':'join','ticket':ticket(client,b,room['code'])});receive(b_ws,'welcome')
            assert client.put('/api/social/blocks/'+b['user_id'],headers=account['headers']).status_code==200
            assert receive(b_ws,'left')['reason']=='block_relationship'
        assert client.post('/api/multiplayer/ticket',headers=b['headers'],json={'code':room['code']}).status_code in (403,404)


def test_room_and_connection_caps(client,account,app):
    app.state.settings.multiplayer_max_rooms=1;app.state.settings.multiplayer_max_connections=2
    b=other(client);c=other(client,'Third');room=create(client,account)
    assert client.post('/api/multiplayer/rooms',headers=b['headers'],json={}).status_code==503
    with client.websocket_connect('/api/multiplayer/ws',headers=ORIGIN) as a_ws:
        a_ws.send_json({'type':'join','ticket':ticket(client,account,room['code'])});receive(a_ws,'welcome')
        with client.websocket_connect('/api/multiplayer/ws',headers=ORIGIN) as b_ws:
            b_ws.send_json({'type':'join','ticket':ticket(client,b,room['code'])});receive(b_ws,'welcome')
            with pytest.raises(WebSocketDisconnect):
                with client.websocket_connect('/api/multiplayer/ws',headers=ORIGIN):pass


def test_room_kick_bans_rejoin_and_mute_filters_chat(client,account):
    b=other(client);client.put('/api/social/mutes/'+account['user_id'],headers=b['headers']);room=create(client,account)
    with client.websocket_connect('/api/multiplayer/ws',headers=ORIGIN) as a:
        a.send_json({'type':'join','ticket':ticket(client,account,room['code'])});receive(a,'welcome')
        with client.websocket_connect('/api/multiplayer/ws',headers=ORIGIN) as bws:
            bws.send_json({'type':'join','ticket':ticket(client,b,room['code'])});receive(bws,'welcome');a.send_json({'type':'chat','message_id':str(uuid4()),'text':'muted text'})
            for _ in range(4):assert bws.receive_json()['type']!='chat'
            a.send_json({'type':'kick','player_id':b['user_id']});assert receive(bws,'left')['reason']=='host_kicked'
        assert client.post('/api/multiplayer/ticket',headers=b['headers'],json={'code':room['code']}).status_code==404


def pose(seq,p=None,speed=0):
    return {'type':'pose','seq':seq,'p':p or list(SPAWN),'q':[0,0,0,1],'speed':speed,'keys':{'throttle':0,'brake':0}}


@pytest.mark.parametrize('change,expected', [({'speed':100},'speed_limit'),({'p':[float('nan'),1,0]},'malformed_pose'),({'q':[0,0,0,0]},'invalid_rotation'),({'p':[900,1,0]},'world_bounds'),({'seq':-1},'replayed_sequence'),({'keys':{'password':1}},'invalid_keys')])
def test_movement_validation_rejects_invalid_payloads(change,expected):
    assert validate_pose(Movement(),{**pose(0),**change},100)==expected


def test_teleport_acceleration_and_replay_limits():
    assert validate_pose(Movement(),pose(0,speed=15),100)=='initial_speed_limit'
    assert validate_pose(Movement(),pose(0,speed=10**500),100)=='malformed_pose'
    assert validate_pose(Movement(),{**pose(0),'q':[10**308,0,0,1]},100)=='malformed_pose'
    m=Movement();accept_pose(m,pose(0),100)
    assert validate_pose(m,pose(0),100.1)=='replayed_sequence'
    assert validate_pose(m,pose(1,[-236.5,1.12,100],0),100.1)=='teleport_limit'
    assert validate_pose(m,pose(1,speed=15),100.1)=='acceleration_limit'
    assert validate_pose(m,pose(1),100.001)=='too_frequent'
    assert not checkpoint_crossed([-236.5,1.12,200],[-236.5,1.12,190],0)
    assert checkpoint_crossed([-236.5,1.12,151],[-236.5,1.12,149],0)


class Socket:
    def __init__(self):self.closed=False
    async def close(self,**kwargs):self.closed=True
    async def send_json(self,data):pass


def test_repeated_violations_are_logged_flagged_and_disconnected(client,account,app):
    async def scenario():
        clock=[100.0];manager=RoomManager(app,lambda:clock[0]);room_data=manager.create(account['user_id']);room=manager.rooms[room_data['code']]
        m=Member(account['user_id'],'Driver','cb-120','#217a6d','unused','unused',websocket=Socket(),queue=asyncio.Queue(maxsize=16));room.members[m.user_id]=m;manager.user_room[m.user_id]=room.code
        manager.persist_join(room,m)
        for i in range(10):clock[0]+=.1;await manager.process(room,m,pose(i,speed=100))
        assert m.suspicious and m.user_id not in room.members
    asyncio.run(scenario())
    with app.state.sessions() as db:
        assert db.get(SocialPreference,account['user_id']).review_flag
        assert db.scalar(select(func.count()).select_from(IntegrityEvent))==10


def test_race_ordered_checkpoints_server_timing_and_exactly_once_reward(client,account,app):
    b=other(client)
    async def scenario():
        clock=[100.0];manager=RoomManager(app,lambda:clock[0]);room=manager.rooms[manager.create(account['user_id'],'race')['code']]
        members=[]
        for a in (account,b):
            m=Member(a['user_id'],'Driver','cb-120','#217a6d','unused','unused',ready=True,websocket=Socket(),queue=asyncio.Queue(maxsize=16),last_seen=clock[0]);room.members[m.user_id]=m;manager.persist_join(room,m);members.append(m)
        await manager.process(room,members[0],{'type':'start'});clock[0]+=5.1;room.state='racing'
        m=members[0];await manager.process(room,m,pose(0));z=218;speed=0
        for seq in range(1,700):
            clock[0]+=.1;speed=min(10,speed+.2);z-=speed*.1
            await manager.process(room,m,pose(seq,[-236.5,1.12,z],speed))
            if m.finished_ms is not None:break
        assert m.checkpoint==4 and m.finished_ms>=20000 and not m.suspicious
        if manager.reward_tasks:await asyncio.gather(*manager.reward_tasks)
        assert m.reward['credited']
        duplicate=award_race(app.state.sessions,room.id,m.user_id,m.finished_ms,1,4)
        assert duplicate['duplicate']
        return room.id
    room_id=asyncio.run(scenario())
    assert len(client.get('/api/multiplayer/rewards',headers=account['headers']).json()['items'])==1
    board=client.get('/api/leaderboards?board=race&period=all',headers=account['headers']).json()
    assert board['total']==1
    profile=client.get('/api/profile',headers=account['headers']).json()
    assert profile['money']==5005000 and profile['xp']==100
    achievements=client.get('/api/progression',headers=account['headers']).json()['achievements']
    assert any(a['id']=='race-winner' and a['earned'] for a in achievements)


def test_reconnect_expiry_and_heartbeat_timeout_cleanup(app,client,account):
    async def scenario():
        clock=[100.0];manager=RoomManager(app,lambda:clock[0]);room=manager.rooms[manager.create(account['user_id'])['code']]
        socket=Socket();m=Member(account['user_id'],'Driver','cb-120','#217a6d','unused','unused',websocket=socket,queue=asyncio.Queue(maxsize=16),last_seen=100);room.members[m.user_id]=m;manager.persist_join(room,m)
        manager.last_policy=manager.last_flush=200
        clock[0]=116;await manager.tick();assert socket.closed
        m.websocket=None;m.disconnected_at=116;clock[0]=177;await manager.tick();assert room.code not in manager.rooms
    asyncio.run(scenario())
