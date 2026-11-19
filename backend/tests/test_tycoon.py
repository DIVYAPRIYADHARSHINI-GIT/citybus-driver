from copy import deepcopy
from uuid import uuid4
import json
from pathlib import Path
import pytest
from sqlalchemy import select
from app.tycoon_engine import advance, empty_state, wear_new, inspection, stable_hash
from app.fleet_specs import RULES, BY_ID
from app.models import TycoonState, FleetCondition, Player, OwnedBus


def fixture_state():
    s = empty_state(1000)
    s.update(money=5000000, xp=0,
             fleet=[{'id':'bus-a','model_id':'cb-120','upgrades':{},'paint':'#217a6d','damage':0,'mileage_m':0,'wear':wear_new(),'energy_units':210000,'revision':0,'service_due_m':0,'reserved':False}],
             drivers=[{'id':'driver-a','template_id':'maya','name':'Maya','skills':{'safety':80,'punctuality':82,'comfort':90,'economy':85},'salary_daily':20000,'morale':75,'active':True}],
             terminals=[{'id':'terminal-a','template_id':'southbank','name':'Southbank','capacity':5}])
    s['assignments']=[{'id':'assignment-a','bus_id':'bus-a','driver_id':'driver-a','route_id':'21','departures':[1001,1005,1009,1013],'ticket_price':250,'active':True,'effective_slot':1000}]
    return s


def test_deterministic_settlement_categories_and_idempotency():
    source=fixture_state();result=advance(source,1020)
    assert source['money']==5000000
    assert result==advance(source,1020)
    assert result==advance(result,1020)
    assert len(result['settled'])==4
    assert result['money']>source['money']
    assert {'ai_fares','energy','wages','maintenance','mission_reward'} <= {e['kind'] for e in result['ledger']}
    assert result['fleet'][0]['mileage_m']==1360
    assert result['fleet'][0]['wear']['tires']>0
    assert 'daily:0' in result['claims']


def test_batch_vs_incremental_partition_invariance():
    s=fixture_state();s['drivers'][0]['morale']=20
    s['assignments'][0]['departures']=list(range(0,1440,30))
    s['loans']=[{'id':'loan-a','balance':500000,'principal':500000,'interest_day':0}]
    batch=advance(s,2200)
    incremental=deepcopy(s)
    for slot in range(1001,2201):
        incremental=advance(incremental,slot)
    assert batch==incremental


def test_catchup_cap_skips_old_history_permanently():
    s=fixture_state();s['assignments'][0]['departures']=list(range(0,1440,30))
    r=advance(s,10000)
    assert r['skipped_slots']==10000-1000-1440
    assert all(e['slot']>10000-1440 for e in r['ledger'])
    assert advance(r,10000)==r
    assert len(r['settled'])<=48


def test_interest_capitalizes_once_and_does_not_also_remove_cash():
    s=fixture_state();s['assignments']=[];s['loans']=[{'id':'l','balance':100000,'principal':100000,'interest_day':0}]
    r=advance(s,1440)
    assert r['loans'][0]['balance']==100120
    assert r['money']==s['money']
    assert r['ledger'][-1]['amount']==-120
    assert advance(r,1440)==r


def test_reserved_and_inactive_resources_do_not_run():
    for field in ('reserved','active'):
        s=fixture_state()
        if field=='reserved':s['fleet'][0]['reserved']=True
        else:s['drivers'][0]['active']=False
        assert advance(s,1020)['settled']==[]


def test_reputation_and_comfort_affect_demand():
    s=fixture_state();low=deepcopy(s);low['reputation']=10
    high=advance(s,1004);poor=advance(low,1004)
    assert sum(e['amount'] for e in high['ledger'] if e['kind']=='ai_fares')>sum(e['amount'] for e in poor['ledger'] if e['kind']=='ai_fares')


def test_service_cost_wear_reset_and_breakdown_risk():
    s=fixture_state();s['fleet'][0]['wear']={p:9000 for p in wear_new()};s['fleet'][0]['service_due_m']=1
    r=advance(s,1004)
    assert r['fleet'][0]['wear']==wear_new()
    assert any(e['kind']=='scheduled_service' for e in r['ledger'])
    assert inspection(s['fleet'][0])['cost']>0


def test_all_event_types_and_responses_are_deterministic():
    s=fixture_state();s['cursor']=0;s['event_cursor']=0;s['assignments']=[]
    r=advance(s,1200)
    assert set(e['kind'] for e in r['events'])==set(RULES['event_kinds'])
    assert r==advance(s,1200)


def test_cross_language_fixture_is_current():
    source=fixture_state()
    path=Path(__file__).resolve().parents[2]/'frontend/tests/fixtures/tycoon-golden.json'
    data=json.loads(path.read_text())
    for item in data:
        assert advance(item['source'],item['target'])==item['expected']


@pytest.fixture
def clock(monkeypatch):
    value=[1000]
    monkeypatch.setattr('app.tycoon.now',lambda:value[0]*60)
    return value


def get(client,account):
    r=client.get('/api/tycoon',headers=account['headers']);assert r.status_code==200,r.text;return r.json()


def command(client,account,snap,kind,args,slot=1000,op=None):
    return client.post('/api/tycoon/commands',headers=account['headers'],json={'operation_id':op or str(uuid4()),'base_revision':snap['revision'],'at_slot':slot,'kind':kind,'args':args})


def test_hire_assign_settle_upgrade_and_revision_conflict(client,account,clock):
    snap=get(client,account);r=command(client,account,snap,'hire',{'candidate':'maya'});assert r.status_code==200,r.text;snap=r.json()
    bus=snap['state']['fleet'][0];driver=snap['state']['drivers'][0]
    r=command(client,account,snap,'assign',{'bus_id':bus['id'],'driver_id':driver['id'],'route_id':'21','departures':[1001,1005,1009],'ticket_price':250});assert r.status_code==200,r.text
    assigned=r.json();clock[0]=1020
    settled=client.post('/api/tycoon/settle',headers=account['headers'],json={}).json()
    assert len(settled['state']['settled'])==3
    again=client.post('/api/tycoon/settle',headers=account['headers'],json={}).json()
    assert again==settled
    assert command(client,account,assigned,'loan',{'amount':100000},1020).status_code==409
    snap=command(client,account,settled,'unassign',{'assignment_id':settled['state']['assignments'][0]['id']},1020).json()
    bus=snap['state']['fleet'][0];op=str(uuid4());r=command(client,account,snap,'upgrade',{'bus_id':bus['id'],'fleet_revision':bus['revision'],'upgrade':'brakes'},1020,op);assert r.status_code==200,r.text
    repeated=command(client,account,snap,'upgrade',{'bus_id':bus['id'],'fleet_revision':bus['revision'],'upgrade':'brakes'},1020,op)
    assert repeated.json()==r.json()
    assert r.json()['state']['fleet'][0]['upgrades']['brakes']==1


def test_loan_repayment_limits_and_interest(client,account,clock):
    snap=get(client,account);r=command(client,account,snap,'loan',{'amount':100000});assert r.status_code==200;r=r.json();loan=r['state']['loans'][0]
    assert command(client,account,r,'loan',{'amount':2000000}).status_code==409
    clock[0]=1440;r=client.post('/api/tycoon/settle',headers=account['headers'],json={}).json();assert r['state']['loans'][0]['balance']==100120
    paid=command(client,account,r,'repay',{'loan_id':loan['id'],'amount':100120},1440);assert paid.status_code==200;assert paid.json()['state']['loans'][0]['balance']==0


def test_queued_commands_cannot_bypass_the_24_hour_catchup_window(client,account,clock):
    snap=get(client,account)
    snap=command(client,account,snap,'hire',{'candidate':'maya'}).json()
    bus=snap['state']['fleet'][0];driver=snap['state']['drivers'][0]
    snap=command(client,account,snap,'assign',{'bus_id':bus['id'],'driver_id':driver['id'],'route_id':'21','departures':list(range(0,1440,30)),'ticket_price':250}).json()
    clock[0]=10000
    replay=command(client,account,snap,'loan',{'amount':100000},9000)
    assert replay.status_code==200,replay.text
    final=client.post('/api/tycoon/settle',headers=account['headers'],json={}).json()['state']
    assert final['skipped_slots']==7560
    assert len(final['settled'])<=48
    assert all(e['slot']>8560 for e in final['ledger'] if e['kind']=='ai_fares')
    assert client.post('/api/tycoon/settle',headers=account['headers'],json={'through_slot':5000}).status_code==422


def test_future_and_overlapping_schedules_refused(client,account,clock):
    snap=get(client,account);assert client.post('/api/tycoon/settle',headers=account['headers'],json={'through_slot':1001}).status_code==422
    snap=command(client,account,snap,'hire',{'candidate':'maya'}).json();bus=snap['state']['fleet'][0];driver=snap['state']['drivers'][0]
    assert command(client,account,snap,'assign',{'bus_id':bus['id'],'driver_id':driver['id'],'route_id':'21','departures':[1001,1002],'ticket_price':250}).status_code==422
    assert command(client,account,snap,'assign',{'bus_id':bus['id'],'driver_id':driver['id'],'route_id':'80','departures':[1001],'ticket_price':250}).status_code==409


def test_company_capacity_and_inspection_revision(client,account,clock):
    snap=get(client,account);bus=snap['state']['fleet'][0]
    assert command(client,account,snap,'repair',{'bus_id':bus['id'],'fleet_revision':99}).status_code==409
    inspect=client.get('/api/tycoon/inspection/'+bus['id'],headers=account['headers']).json();assert inspect['estimate']['cost']==0
    upgraded=command(client,account,snap,'terminal',{'terminal_id':snap['state']['terminals'][0]['id']});assert upgraded.status_code==200;assert upgraded.json()['state']['terminals'][0]['capacity']==10


def test_worn_battery_charge_never_credits_negative_cost(client,account,app,clock):
    snap=get(client,account);bus=snap['state']['fleet'][0]
    with app.state.sessions() as db:
        b=db.get(OwnedBus,bus['id']);b.model_id='leaf-e80'
        c=db.get(FleetCondition,bus['id']);c.wear={**wear_new(),'energy':10000};c.energy_units=296000
        db.commit()
    snap=get(client,account)
    response=command(client,account,snap,'energy',{'bus_id':bus['id'],'fleet_revision':0,'units':1000000})
    assert response.status_code==200,response.text
    assert response.json()['state']['fleet'][0]['energy_units']==222000
    assert response.json()['state']['money']==snap['state']['money']


def test_manual_service_updates_reputation_once(client,account):
    from tests.test_api import valid_result
    body = valid_result()
    assert client.post('/api/results',headers=account['headers'],json=body).status_code == 200
    reputation = get(client,account)['state']['reputation']
    assert reputation == 72
    client.post('/api/results',headers=account['headers'],json=body)
    assert get(client,account)['state']['reputation'] == reputation


def test_financing_is_not_reported_as_operating_profit(client,account,clock):
    snap=get(client,account)
    response=command(client,account,snap,'loan',{'amount':100000})
    assert response.status_code == 200
    report=client.get('/api/company/reports?period=daily&on=1970-01-01',headers=account['headers']).json()
    assert report['income']==0 and report['net']==0
    assert report['financing_in']==100000 and report['cash_flow']==100000


def test_fleet_reconciliation_keeps_stale_delta_until_explicit_choice(client,account,clock):
    from tests.test_api import valid_result
    snap=get(client,account);bus=snap['state']['fleet'][0]
    changed=command(client,account,snap,'upgrade',{'bus_id':bus['id'],'fleet_revision':bus['revision'],'upgrade':'tires'});assert changed.status_code==200
    body=valid_result();body['owned_bus_id']=bus['id'];body['fleet_delta']={'base_revision':0,'energy_used':200,'wear_added':{'engine':2,'brakes':3,'tires':4,'energy':1}}
    result=client.post('/api/results',headers=account['headers'],json=body);assert result.status_code==200,result.text
    conflicts=client.get('/api/tycoon/fleet-conflicts',headers=account['headers']).json()['items'];assert len(conflicts)==1
    snap=get(client,account);current=snap['state']['fleet'][0];assert current['wear']['tires']==0
    resolved=command(client,account,snap,'reconcile',{'conflict_id':conflicts[0]['id'],'fleet_revision':current['revision'],'choice':'merge'});assert resolved.status_code==200,resolved.text
    assert resolved.json()['state']['fleet'][0]['wear']['tires']==4
    assert client.get('/api/tycoon/fleet-conflicts',headers=account['headers']).json()['items']==[]
