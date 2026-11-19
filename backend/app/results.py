import math
from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session
from .catalog import LINES
from .common import digest, profile, progression, lock_player
from .database import get_db
from .errors import ApiError
from .fleet import own_bus
from .models import Player, Result, Ledger, OwnedBus, FleetConflict, TycoonState, now
from .fleet_specs import BY_ID
from .tycoon import conditions
from .tycoon_engine import empty_state
from .schemas import RouteSubmission
from .security import current_player
from .leaderboards import record_valid_result, record_profit
from .multiplayer_rewards import award_session_for_result

router = APIRouter(tags=['Results and progression'])


def validate_result(data: RouteSubmission):
    route = data.route
    line = next(line for line in LINES if line['id'] == route.id)
    stops = len(line['stops'])
    if route.served + route.missed != stops:
        raise ApiError(422, 'invalid_result', 'Served and missed stops must account for the entire route.')
    if route.served == stops and (data.seconds < line['min_seconds'] or data.meters < line['min_meters']):
        raise ApiError(422, 'impossible_journey', 'Journey time or distance is below this route’s minimum.')
    if data.seconds < route.served * 2 or data.meters > data.seconds * 32 + 20:
        raise ApiError(422, 'impossible_journey', 'Journey duration and distance imply impossible travel.')
    if route.fares > (stops - 1) * 4 * 250 or route.fares % 50:
        raise ApiError(422, 'impossible_fares', 'Fares exceed the bounded Northbank passenger demand or fare increments.')
    if route.served == 0 and route.fares:
        raise ApiError(422, 'impossible_fares', 'A route without any served stops cannot collect fares.')
    if route.expenses > 500000 or route.penalties > 100000 or route.penalties % 5 or route.penalties < route.missed * 100:
        raise ApiError(422, 'invalid_result', 'Expenses or penalties are outside the supported game rules.')
    if data.liters > 2 + data.seconds * 30 / 3600:
        raise ApiError(422, 'impossible_fuel', 'Fuel usage exceeds the supported bus model’s consumption bound.')
    expected = max(0, math.floor(route.served * 150 + route.comfort * 2 + route.punctuality * 2 + route.fares / 10 - route.penalties + .5))
    # Frontend rounds comfort and punctuality after using their fractional values
    # in the score. A two-point rounding tolerance preserves existing results.
    if abs(route.score - expected) > 2:
        raise ApiError(422, 'invalid_score', 'Submitted score does not match the published scoring formula.')
    timestamp = data.finished_at.timestamp()
    if timestamp > now() + 300 or timestamp < now() - 366 * 86400:
        raise ApiError(422, 'invalid_timestamp', 'Result timestamp is outside the supported offline sync window.')


def result_view(row):
    return {'id': row.id, 'run_id': row.run_id, 'route_id': row.route_id, 'payload': row.payload,
            'xp_awarded': row.xp_awarded, 'money_awarded': row.money_awarded, 'received_at': row.received_at}


@router.post('/results')
def submit(data: RouteSubmission, player: Player = Depends(current_player), db: Session = Depends(get_db)):
    player = lock_player(db, player)
    payload = data.model_dump(mode='json')
    if data.fleet_delta is None:
        payload.pop('fleet_delta', None)
    hashed = digest(payload)
    existing = db.scalar(select(Result).where(Result.user_id == player.id, Result.run_id == str(data.run_id)))
    if existing:
        if existing.payload_hash != hashed:
            raise ApiError(409, 'idempotency_mismatch', 'This run id already has a different result.')
        return {'result': result_view(existing), 'profile': profile(player), 'duplicate': True}
    validate_result(data)
    # A finite daily intake cap bounds offline-client abuse. This is plausibility
    # validation, not server-authoritative multiplayer anti-cheat.
    recent = db.scalars(select(Result).where(Result.user_id == player.id, Result.received_at > now() - 86400)).all()
    if len(recent) >= 100:
        raise ApiError(429, 'daily_result_limit', 'The daily result sync limit has been reached.', {'retry_after': 3600})
    route = data.route
    xp = route.served * 40 + route.score // 20 + route.comfort // 5 if route.served else 0
    money = route.fares - route.expenses
    player.xp += xp
    player.money += money
    db.add(Ledger(user_id=player.id, kind='route_fares', amount=route.fares, reference=str(data.run_id)))
    if route.expenses:
        db.add(Ledger(user_id=player.id, kind='route_expenses', amount=-route.expenses, reference=str(data.run_id)))
    row = Result(user_id=player.id, run_id=str(data.run_id), route_id=route.id, payload=payload,
                 payload_hash=hashed, xp_awarded=xp, money_awarded=money)
    db.add(row)
    bus = own_bus(db, player, str(data.owned_bus_id)) if data.owned_bus_id else db.scalar(select(OwnedBus).where(OwnedBus.user_id == player.id, OwnedBus.model_id == 'cb-120').order_by(OwnedBus.id))
    if bus:
        spec = BY_ID.get(bus.model_id)
        if not spec:
            raise ApiError(422, 'unsupported_drivetrain', 'This model is collection-only.')
        condition = conditions(db, bus)
        delta = data.fleet_delta
        if delta and delta.base_revision != condition.revision:
            db.add(FleetConflict(user_id=player.id, bus_id=bus.id, revision=condition.revision,
                                local_document={**delta.model_dump(), 'meters': data.meters, 'impacts': data.impacts, 'run_id': str(data.run_id)},
                                server_document={'wear': condition.wear, 'energy_units': condition.energy_units, 'mileage_m': bus.mileage_m, 'damage': bus.damage}))
        else:
            bus.mileage_m += data.meters
            bus.fuel_l = max(0, bus.fuel_l - data.liters)
            bus.damage = min(100, bus.damage + data.impacts * 18)
            used = delta.energy_used if delta else round(data.liters * 1000)
            if used > (spec['battery_kwh'] or spec['tank_l']) * 1000:
                raise ApiError(422, 'impossible_energy', 'Consumed energy exceeds the vehicle capacity.')
            condition.energy_units = max(0, condition.energy_units - used)
            added = delta.wear_added if delta else {p: math.ceil(data.meters * r / 1000) for p, r in [('engine', 3), ('brakes', 4), ('tires', 5), ('energy', 2)]}
            condition.wear = {p: min(10000, condition.wear.get(p, 0) + added[p]) for p in added}
            condition.revision += 1
    db.flush()
    progress = progression(db, player)
    achievements = set(player.achievements)
    if route.served:
        achievements.add('first-shift')
    if route.served == len(next(l for l in LINES if l['id'] == route.id)['stops']) and route.comfort >= 95 and route.penalties == 0:
        achievements.add('smooth-operator')
    if progress['counts']['routes'] >= 10:
        achievements.add('ten-services')
    player.achievements = sorted(achievements)
    claimed = set(player.claimed_missions)
    for mission in progress['missions']:
        if mission['progress'] >= mission['target'] and mission['id'] not in claimed:
            claimed.add(mission['id'])
            player.xp += mission['reward_xp']
            player.money += mission['reward_money']
            row.xp_awarded += mission['reward_xp']
            row.money_awarded += mission['reward_money']
            db.add(Ledger(user_id=player.id, kind='mission_reward', amount=mission['reward_money'], reference=mission['id']))
    player.claimed_missions = sorted(claimed)
    company = db.get(TycoonState, player.id)
    if not company:
        company = TycoonState(user_id=player.id, revision=0, document=empty_state(now() // 60))
        db.add(company)
    safety = max(0, 100 - data.impacts * 20 - route.penalties // 10)
    quality = (route.punctuality + route.comfort + safety) // 3
    reputation = company.document.get('reputation', 70)
    company.document = {**company.document, 'reputation': max(0, min(100, reputation + (2 if quality >= 85 else -3 if quality < 50 else 0)))}
    company.revision = (company.revision or 0) + 1
    db.flush()
    record_valid_result(db, row)
    for entry in db.scalars(select(Ledger).where(Ledger.user_id == player.id, Ledger.reference == str(data.run_id))):
        record_profit(db, entry)
    award_session_for_result(db, player, row)
    db.commit()
    return {'result': result_view(row), 'profile': profile(player), 'duplicate': False}


@router.get('/results')
def list_results(limit: int = Query(50, ge=1, le=200), player: Player = Depends(current_player), db: Session = Depends(get_db)):
    return {'items': [result_view(r) for r in db.scalars(select(Result).where(Result.user_id == player.id).order_by(Result.received_at.desc(), Result.id).limit(limit))]}


@router.get('/progression')
def get_progression(player: Player = Depends(current_player), db: Session = Depends(get_db)):
    return progression(db, player)
