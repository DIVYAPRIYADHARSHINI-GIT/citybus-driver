from copy import deepcopy
from uuid import uuid4
import json
from pathlib import Path
import pytest
from sqlalchemy import select
from app.world_data import MAPS, WEATHER, COURSES, NEW_LINES, LINE_MAP
from app.fleet_specs import SPECS, RULES
from app.models import WorldDefinition, CompanyRoute, Player, BoardEntry
from app.seed import seed
from app.multiplayer_rewards import award_race
from app.multiplayer_rules import Movement, checkpoint_crossed, validate_pose
from tests.test_stage5 import ticket, receive, ORIGIN
from tests.test_api import valid_result
from tests.test_tycoon import fixture_state
from app.tycoon_engine import advance


@pytest.mark.parametrize('line',NEW_LINES,ids=lambda r:r['id'])
@pytest.mark.parametrize('spec',SPECS,ids=lambda s:s['id'])
def test_regional_settlement_all_models_integer_costs_and_cap(line,spec):
    state=fixture_state();state['fleet'][0]['model_id']=spec['id']
    state['assignments'][0].update(route_id=line['id'],departures=[1001])
    end=1001+RULES['routes'][line['id']]['duration_slots']
    result=advance(state,end)
    assert result==advance(state,end)==advance(result,end)
    assert len(result['settled'])==1
    assert all(type(e['amount']) is int for e in result['ledger'])
    assert {'ai_fares','energy','wages','maintenance'} <= {e['kind'] for e in result['ledger']}
    assert sum(-e['amount'] for e in result['ledger'] if e['kind']=='toll')==RULES['routes'][line['id']]['toll_cents']
    capped=advance(state,10000)
    assert capped['skipped_slots']==7560
    assert all(e['slot']>8560 for e in capped['ledger'])


@pytest.mark.parametrize('map_id', ['northbank','meridian','coastway'])
def test_world_api_database_and_offline_equivalence(client, app, map_id):
    row=client.get('/api/maps/'+map_id)
    assert row.status_code == 200
    assert row.json()['revision'] == 1
    assert {k:v for k,v in row.json().items() if k!='revision'} == next(m for m in MAPS if m['id']==map_id)
    routes=client.get('/api/maps/'+map_id+'/routes').json()['items']
    assert routes and all(LINE_MAP[r['id']]==map_id for r in routes)
    copy=json.loads((Path(__file__).parents[2]/'frontend/src/city/worlds.json').read_text())
    assert copy == {'maps':MAPS,'weather':WEATHER}
    with app.state.sessions() as db:
        seed(db);seed(db)
        assert db.get(WorldDefinition,map_id).revision == 1


def test_readiness_weather_and_invalid_map(client):
    assert client.get('/api/ready').json()['schema']=='0004'
    assert len(client.get('/api/maps').json()['items'])==3
    assert client.get('/api/weather').json()['presets']==WEATHER
    assert client.get('/api/maps/invalid').status_code==404
    assert client.get('/api/maps/weather').status_code==404


@pytest.mark.parametrize('spec',SPECS,ids=lambda s:s['id'])
def test_every_catalog_bus_has_valid_distinct_driving_profile(client,spec):
    item=next(b for b in client.get('/api/catalog').json()['items'] if b['id']==spec['id'])
    assert item['drive_ready'] and item['stats']['physics_profile']
    assert spec['front_mass_kg']+spec['rear_mass_kg']==spec['mass_kg']
    assert spec['turning_radius_m']>4 and spec['brake_force_n']>spec['mass_kg']*5
    assert spec['power_kw']==item['stats']['power_kw']
    assert spec['capacity']==item['stats']['capacity']
    if spec['energy']=='electric':
        assert spec['motor_torque_nm']>0 and spec['battery_kwh']>0 and spec['tank_l']==0


@pytest.mark.parametrize('line',NEW_LINES,ids=lambda r:r['id'])
def test_new_results_rank_in_correct_map_and_retries_cannot_pay(client,account,line):
    body=valid_result();body['route'].update(id=line['id'],served=len(line['stops']),score=len(line['stops'])*150+490)
    body['seconds']=max(300,line['min_seconds']+30);body['meters']=line['meters']
    first=client.post('/api/results',headers=account['headers'],json=body)
    assert first.status_code==200,first.text
    second=client.post('/api/results',headers=account['headers'],json=body)
    assert second.json()['duplicate'] is True
    assert {**second.json(), 'duplicate':False}==first.json()
    board=client.get('/api/leaderboards',headers=account['headers'],params={'line_id':line['id'],'map_id':line['map_id'],'bus_class':'city','period':'all'}).json()
    assert board['total']==1
    assert client.get('/api/leaderboards',headers=account['headers'],params={'line_id':line['id'],'map_id':'northbank','period':'all'}).json()['total']==0


@pytest.mark.parametrize('map_id',['northbank','meridian','coastway'])
def test_room_map_checkpoint_bounds_reward_and_reconnect(client,account,app,map_id):
    response=client.post('/api/multiplayer/rooms',headers=account['headers'],json={'mode':'race','map_id':map_id,'private':True})
    assert response.status_code==201,response.text
    room=response.json();course=COURSES[map_id]
    assert room['course']==course and room['map_id']==map_id
    with client.websocket_connect('/api/multiplayer/ws',headers=ORIGIN) as ws:
        ws.send_json({'type':'join','ticket':ticket(client,account,room['code'])})
        welcome=receive(ws,'welcome');resume=welcome['resume_token']
        assert welcome['pose']['p']==course['spawn']
    with client.websocket_connect('/api/multiplayer/ws',headers=ORIGIN) as ws:
        ws.send_json({'type':'join','ticket':ticket(client,account,room['code'],resume)})
        assert receive(ws,'welcome')['room']['map_id']==map_id
    for index,(x,z) in enumerate(course['checkpoints']):
        assert checkpoint_crossed([x,1,z+5],[x,1,z-5],index,course['checkpoints'])
        assert not checkpoint_crossed([x,1,z-5],[x,1,z+5],index,course['checkpoints'])
    p=Movement(position=list(course['spawn']))
    assert validate_pose(p,{'p':list(course['spawn']),'q':[0,0,0,1],'speed':0,'seq':0},1,bounds=next(m['bounds'] for m in MAPS if m['id']==map_id)) is None
    # Reward helper is exercised transactionally here; keyboard gate completion
    # remains a separate browser test, not fabricated by this fixture.
    args=(app.state.sessions,room['id'],account['user_id'],60000,1,4,False,map_id,'city')
    assert award_race(*args)['duplicate'] is False
    assert award_race(*args)['duplicate'] is True
    board=client.get('/api/leaderboards',headers=account['headers'],params={'board':'race','map_id':map_id,'bus_class':'city','period':'all'}).json()
    assert board['total']==1
    assert client.get('/api/leaderboards',headers=account['headers'],params={'board':'race','map_id':map_id,'bus_class':'coach','period':'all'}).json()['total']==0


def test_existing_company_plans_survive_idempotent_expansion(client,account,app):
    with app.state.sessions() as db:
        old=db.scalar(select(CompanyRoute).where(CompanyRoute.user_id==account['user_id'],CompanyRoute.line_id=='21'))
        old.timetable={'departure_minutes':[620],'relative_stop_seconds':[0,55,115]};db.commit()
        seed(db);seed(db)
        rows=db.scalars(select(CompanyRoute).where(CompanyRoute.user_id==account['user_id'])).all()
        assert len(rows)==7
        assert next(r for r in rows if r.line_id=='21').timetable['departure_minutes']==[620]


def test_room_rejects_map_and_line_mismatch(client,account):
    assert client.post('/api/multiplayer/rooms',headers=account['headers'],json={'map_id':'invalid'}).status_code==422
    room=client.post('/api/multiplayer/rooms',headers=account['headers'],json={'map_id':'meridian'}).json()
    assert client.post('/api/multiplayer/ticket',headers=account['headers'],json={'code':room['code'],'line_id':'H1'}).status_code==422
