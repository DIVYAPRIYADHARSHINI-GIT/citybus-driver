"""Versioned company commands and deterministic, on-demand settlement.
No worker pays routes independently: every request catches up under the player lock.
"""
from copy import deepcopy
from uuid import UUID
from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import Field, model_validator
from sqlalchemy import select
from sqlalchemy.orm import Session
from .catalog import DRIVER_TEMPLATES, TERMINALS, catalog_data
from .fleet_specs import BY_ID, RULES
from .tycoon_engine import advance, empty_state, wear_new, inspection, add_ledger, clamp
from .models import Player, OwnedBus, Driver, Terminal, Ledger, TycoonState, FleetCondition, FleetConflict, now
from .database import get_db
from .security import current_player
from .errors import ApiError
from .common import lock_player, command_cached, remember
from .schemas import StrictModel

router = APIRouter(prefix='/tycoon', tags=['Tycoon simulation'])


class TycoonCommand(StrictModel):
    operation_id: UUID
    base_revision: int = Field(ge=0)
    at_slot: int = Field(ge=0)
    kind: str = Field(max_length=30)
    args: dict = Field(default_factory=dict)


class SettleRequest(StrictModel):
    through_slot: int | None = Field(default=None, ge=0)


def conditions(db, bus):
    row = db.get(FleetCondition, bus.id)
    if not row:
        spec = BY_ID.get(bus.model_id)
        row = FleetCondition(bus_id=bus.id, revision=0, wear=wear_new(), energy_units=round((spec['battery_kwh'] * 1000 * .8) if spec and spec['energy'] == 'electric' else bus.fuel_l * 1000), service_due_m=0, reserved=False)
        db.add(row)
        db.flush()
    return row


def state_for(db, player):
    record = db.get(TycoonState, player.id)
    if not record:
        record = TycoonState(user_id=player.id, revision=0, document=empty_state(now() // 60))
        db.add(record)
        db.flush()
    state = deepcopy(record.document)
    state.update(money=player.money, xp=player.xp, fleet=[], drivers=[], terminals=[])
    for bus in db.scalars(select(OwnedBus).where(OwnedBus.user_id == player.id).order_by(OwnedBus.id)):
        c = conditions(db, bus)
        state['fleet'].append({'id': bus.id, 'model_id': bus.model_id, 'upgrades': bus.upgrades, 'paint': bus.paint, 'damage': round(bus.damage), 'mileage_m': round(bus.mileage_m), 'wear': c.wear, 'energy_units': c.energy_units, 'revision': c.revision, 'service_due_m': c.service_due_m, 'reserved': c.reserved})
    metadata = state.get('driver_meta', {})
    for d in db.scalars(select(Driver).where(Driver.user_id == player.id).order_by(Driver.id)):
        skills = {**d.skills, 'punctuality': d.skills.get('punctuality', d.skills.get('safety', 60)), 'comfort': d.skills.get('comfort', d.skills.get('service', 60))}
        state['drivers'].append({'id': d.id, 'template_id': d.template_id, 'name': d.name, 'skills': skills, 'salary_daily': d.salary_daily, 'active': d.active, 'morale': metadata.get(d.id, {}).get('morale', 75)})
    for t in db.scalars(select(Terminal).where(Terminal.user_id == player.id).order_by(Terminal.id)):
        state['terminals'].append({'id': t.id, 'template_id': t.template_id, 'name': t.name, 'capacity': t.capacity})
    return record, state


def persist(db, player, record, state):
    player.money, player.xp = state['money'], state['xp']
    for bus in state['fleet']:
        b = db.get(OwnedBus, bus['id'])
        if not b:
            continue
        c = conditions(db, b)
        b.upgrades, b.paint, b.damage, b.mileage_m = bus['upgrades'], bus['paint'], bus['damage'], bus['mileage_m']
        spec = BY_ID.get(b.model_id)
        if spec and spec['energy'] == 'diesel':
            b.fuel_l = bus['energy_units'] / 1000
        c.wear, c.energy_units, c.revision = bus['wear'], bus['energy_units'], bus['revision']
        c.service_due_m, c.reserved = bus['service_due_m'], bus['reserved']
    for driver in state['drivers']:
        d = db.get(Driver, driver['id'])
        if d:
            d.skills, d.salary_daily, d.active = driver['skills'], driver['salary_daily'], driver['active']
    for terminal in state['terminals']:
        t = db.get(Terminal, terminal['id'])
        if t:
            t.capacity = terminal['capacity']
    state['driver_meta'] = {d['id']: {'morale': d['morale']} for d in state['drivers']}
    existing = set(db.scalars(select(Ledger.reference).where(Ledger.user_id == player.id, Ledger.kind.like('tycoon_%'))))
    for entry in state['ledger']:
        if entry['id'] not in existing:
            ledger = Ledger(user_id=player.id, kind='tycoon_' + entry['kind'], amount=entry['amount'], reference=entry['id'], created_at=entry['slot'] * 60)
            db.add(ledger)
            from .leaderboards import record_profit
            record_profit(db, ledger)
    record.document = deepcopy(state)
    record.revision += 1
    db.flush()


def view(record, state):
    return {'revision': record.revision, 'server_slot': now() // 60, 'state': state, 'rules': RULES,
            'reconciliation': 'Server settlement is authoritative; offline state is a forecast. Commands use operation UUIDs and revision checks. Stale commands are kept for explicit retry/cancel.'}


def target_slot(value):
    current = now() // 60
    if value is not None and value > current:
        raise ApiError(422, 'future_settlement', 'Cannot settle simulated routes in the future.')
    if value is not None and value < current - RULES['catchup_slots']:
        raise ApiError(422, 'expired_settlement', 'Settlement target is outside the retained catch-up window.')
    return current if value is None else value


def cap_to_server_window(state):
    floor = max(0, now() // 60 - RULES['catchup_slots'])
    if state['cursor'] < floor:
        state['skipped_slots'] += floor - state['cursor']
        state['cursor'] = floor
    return state


def require(state, collection, id_):
    item = next((v for v in state[collection] if v['id'] == id_), None)
    if not item:
        raise ApiError(404, 'not_found', f'{collection} resource not found in your company.')
    return item


def spend(state, cents, key, kind, slot):
    if state['money'] < cents:
        raise ApiError(409, 'insufficient_funds', 'Not enough money for this company action.')
    add_ledger(state, key, kind, -cents, slot)


def integer(args, key, low, high):
    value = args.get(key)
    if type(value) is not int or not low <= value <= high:
        raise ApiError(422, 'invalid_argument', f'{key} must be an integer from {low} to {high}.')
    return value


def apply_command(db, player, state, command, slot):
    args, kind, key = command.args, command.kind, f'cmd:{command.operation_id}'
    level = 1 + state['xp'] // 500
    if kind == 'hire':
        candidate = next((d for d in DRIVER_TEMPLATES if d['id'] == args.get('candidate')), None)
        if not candidate:
            raise ApiError(404, 'not_found', 'Candidate not found.')
        existing = next((d for d in state['drivers'] if d['template_id'] == candidate['id']), None)
        if existing and existing['active']:
            raise ApiError(409, 'already_hired', 'Driver already employed.')
        spend(state, candidate['hire_cost'], key, 'hire', slot)
        if existing:
            existing['active'] = True
            existing['morale'] = 75
        else:
            skills = {**candidate['skills'], 'punctuality': candidate['skills']['safety'], 'comfort': candidate['skills']['service']}
            driver = Driver(id=str(command.operation_id), user_id=player.id, template_id=candidate['id'], name=candidate['name'], skills=skills, salary_daily=candidate['salary_daily'], active=True)
            db.add(driver)
            db.flush()
            state['drivers'].append({'id': driver.id, 'template_id': driver.template_id, 'name': driver.name, 'skills': skills, 'salary_daily': driver.salary_daily, 'active': True, 'morale': 75})
    elif kind in ('train', 'salary', 'fire'):
        driver = require(state, 'drivers', args.get('driver_id'))
        if kind == 'fire':
            driver['active'] = False
            for a in state['assignments']:
                if a['driver_id'] == driver['id']:
                    a['active'] = False
        elif kind == 'salary':
            new = integer(args, 'salary_daily', 10000, 100000)
            driver['morale'] = clamp(driver['morale'] + (5 if new > driver['salary_daily'] else -8), 0, 100)
            driver['salary_daily'] = new
        else:
            skill = args.get('skill')
            if skill not in ('safety', 'punctuality', 'comfort', 'economy') or not driver['active']:
                raise ApiError(422, 'invalid_skill', 'Choose an active driver and one of the four skills.')
            old = driver['skills'].get(skill, 60)
            if old >= 100:
                raise ApiError(409, 'maxed', 'Skill already maxed.')
            spend(state, RULES['training_cost'], key, 'training', slot)
            driver['skills'] = {**driver['skills'], skill: min(100, old + 5)}
    elif kind == 'purchase':
        model = next((b for b in catalog_data() if b['id'] == args.get('model_id')), None)
        if not model:
            raise ApiError(404, 'not_found', 'Model not found.')
        if level < model['required_level']:
            raise ApiError(409, 'level_locked', 'This bus is level locked.')
        if len(state['fleet']) >= sum(t['capacity'] for t in state['terminals']):
            raise ApiError(409, 'terminal_full', 'Buy or upgrade a terminal before expanding the fleet.')
        spend(state, model['price'], key, 'bus_purchase', slot)
        b = OwnedBus(id=str(command.operation_id), user_id=player.id, model_id=model['id'], fuel_l=model['stats']['fuel_tank_l'] * .8)
        db.add(b)
        db.flush()
        c = conditions(db, b)
        state['fleet'].append({'id': b.id, 'model_id': b.model_id, 'upgrades': {}, 'paint': b.paint, 'damage': 0, 'mileage_m': 0, 'wear': c.wear, 'energy_units': c.energy_units, 'revision': 0, 'service_due_m': 0, 'reserved': False})
    elif kind == 'assign':
        bus, driver = require(state, 'fleet', args.get('bus_id')), require(state, 'drivers', args.get('driver_id'))
        route = RULES['routes'].get(args.get('route_id'))
        if not route or level < route['level']:
            raise ApiError(409, 'route_locked', 'Route unavailable at this level.')
        if bus['model_id'] not in BY_ID or not driver['active'] or bus['reserved']:
            raise ApiError(409, 'unavailable', 'Select a drive-ready unreserved bus and active driver.')
        if any(a['active'] and (a['bus_id'] == bus['id'] or a['driver_id'] == driver['id']) for a in state['assignments']):
            raise ApiError(409, 'already_assigned', 'Bus or driver already has an active assignment.')
        departures = args.get('departures')
        if not isinstance(departures, list) or not 1 <= len(departures) <= 48 or any(type(v) is not int or v < 0 or v > 1439 for v in departures) or departures != sorted(set(departures)):
            raise ApiError(422, 'invalid_schedule', 'Use 1–48 unique sorted minutes in the UTC day.')
        if len(departures) > 1 and min([b-a for a,b in zip(departures, departures[1:])] + [1440-departures[-1]+departures[0]]) < route['duration_slots']:
            raise ApiError(422, 'overlap', 'Departures overlap the route duration.')
        state['assignments'].append({'id': str(command.operation_id), 'bus_id': bus['id'], 'driver_id': driver['id'], 'route_id': route['id'], 'departures': departures, 'ticket_price': integer(args, 'ticket_price', 100, 1000), 'active': True, 'effective_slot': slot})
    elif kind == 'unassign':
        require(state, 'assignments', args.get('assignment_id'))['active'] = False
    elif kind in ('upgrade', 'repair', 'service', 'paint', 'energy', 'reserve'):
        bus = require(state, 'fleet', args.get('bus_id'))
        if args.get('fleet_revision') != bus['revision']:
            raise ApiError(409, 'fleet_revision_conflict', 'Fleet changed since inspection. Refresh the estimate before retrying.', {'bus': bus})
        if any(a['active'] and a['bus_id'] == bus['id'] for a in state['assignments']):
            raise ApiError(409, 'bus_assigned', 'Unassign this bus before maintenance or manual driving.')
        spec = BY_ID.get(bus['model_id'])
        if not spec:
            raise ApiError(409, 'collection_only', 'Handling and maintenance are not implemented for this model.')
        if kind == 'upgrade':
            part = args.get('upgrade')
            if part not in RULES['upgrades']:
                raise ApiError(422, 'invalid_upgrade', 'Unknown upgrade.')
            rank = bus['upgrades'].get(part, 0)
            if rank >= 3:
                raise ApiError(409, 'maxed', 'Upgrade already maxed.')
            spend(state, RULES['upgrades'][part] * (rank + 1), key, 'upgrade', slot)
            bus['upgrades'] = {**bus['upgrades'], part: rank + 1}
        elif kind == 'repair':
            spend(state, inspection(bus)['cost'], key, 'repair', slot)
            bus['wear'], bus['damage'] = wear_new(), 0
        elif kind == 'service':
            bus['service_due_m'] = bus['mileage_m'] + integer(args, 'after_meters', 1000, 50000)
        elif kind == 'paint':
            import re
            paint = args.get('paint', '')
            if not isinstance(paint, str) or not re.fullmatch(r'#[a-fA-F0-9]{6}', paint):
                raise ApiError(422, 'invalid_paint', 'Use a hex colour.')
            spend(state, 3000, key, 'paint', slot)
            bus['paint'] = paint.lower()
        elif kind == 'reserve':
            if type(args.get('reserved')) is not bool:
                raise ApiError(422, 'invalid_reservation', 'reserved must be boolean.')
            bus['reserved'] = args['reserved']
        else:
            capacity = spec['battery_kwh'] * 1000 * (40000 - bus['wear']['energy']) // 40000 if spec['energy'] == 'electric' else spec['tank_l'] * 1000
            amount = max(0, min(integer(args, 'units', 1, 1000000), capacity - bus['energy_units']))
            rate = RULES['energy_cents_per_kwh'] if spec['energy'] == 'electric' else RULES['fuel_cents_per_litre']
            spend(state, (amount * rate + 999) // 1000, key, 'depot_energy', slot)
            bus['energy_units'] = min(capacity, bus['energy_units'] + amount)
        bus['revision'] += 1
    elif kind == 'terminal-buy':
        template = next((t for t in TERMINALS if t['id'] == args.get('template_id')), None)
        if not template or any(t['template_id'] == template['id'] for t in state['terminals']):
            raise ApiError(409, 'unavailable_terminal', 'Terminal unavailable or already owned.')
        if level < 2:
            raise ApiError(409, 'level_locked', 'Terminal expansion unlocks at level 2.')
        spend(state, template['price'], key, 'terminal_purchase', slot)
        t = Terminal(id=str(command.operation_id), user_id=player.id, template_id=template['id'], name=template['name'], capacity=template['capacity'])
        db.add(t)
        db.flush()
        state['terminals'].append({'id': t.id, 'template_id': t.template_id, 'name': t.name, 'capacity': t.capacity})
    elif kind == 'reconcile':
        conflict = db.get(FleetConflict, args.get('conflict_id'))
        if not conflict or conflict.user_id != player.id or conflict.resolved:
            raise ApiError(404, 'not_found', 'Unresolved fleet conflict not found.')
        bus = require(state, 'fleet', conflict.bus_id)
        if args.get('fleet_revision') != bus['revision']:
            raise ApiError(409, 'fleet_revision_conflict', 'Fleet changed again. Inspect the current version first.')
        if args.get('choice') not in ('merge', 'server'):
            raise ApiError(422, 'invalid_choice', 'Choose conservative delta merge or retain server state.')
        if args['choice'] == 'merge':
            delta = conflict.local_document
            bus['mileage_m'] += round(delta['meters'])
            bus['damage'] = min(100, bus['damage'] + delta['impacts'] * 18)
            bus['energy_units'] = max(0, bus['energy_units'] - delta['energy_used'])
            bus['wear'] = {p: min(10000, bus['wear'][p] + delta['wear_added'][p]) for p in bus['wear']}
            bus['revision'] += 1
        conflict.resolved = True
        conflict.local_document = {**conflict.local_document, 'resolution': args['choice']}
    elif kind == 'terminal':
        terminal = require(state, 'terminals', args.get('terminal_id'))
        if terminal['capacity'] >= 25:
            raise ApiError(409, 'maxed', 'Terminal at maximum capacity.')
        spend(state, terminal['capacity'] * 20000, key, 'terminal_upgrade', slot)
        terminal['capacity'] = min(25, terminal['capacity'] + 5)
    elif kind == 'loan':
        amount = integer(args, 'amount', RULES['loan_min'], RULES['loan_limit'])
        if sum(l['balance'] for l in state['loans']) + amount > RULES['loan_limit']:
            raise ApiError(409, 'credit_limit', 'Combined loan limit exceeded.')
        state['loans'].append({'id': str(command.operation_id), 'balance': amount, 'principal': amount, 'interest_day': slot // 1440})
        add_ledger(state, key, 'loan_draw', amount, slot)
    elif kind == 'repay':
        loan = require(state, 'loans', args.get('loan_id'))
        amount = min(integer(args, 'amount', 1, 10000000), loan['balance'])
        spend(state, amount, key, 'loan_repayment', slot)
        loan['balance'] -= amount
    elif kind == 'event':
        event = require(state, 'events', args.get('event_id'))
        if event['end'] <= slot or event.get('choice'):
            raise ApiError(409, 'event_closed', 'Event expired or already answered.')
        choice = args.get('choice')
        if choice not in ('respond', 'ignore'):
            raise ApiError(422, 'invalid_choice', 'Choose respond or ignore.')
        if choice == 'respond':
            cost = {'fuel-spike': 5000, 'strike': 15000, 'festival': 10000, 'weather': 3000, 'quit': 10000, 'recall': 0}[event['kind']]
            spend(state, cost, key, 'event_response', slot)
            if event['kind'] in ('strike', 'quit'):
                for d in state['drivers']:
                    d['morale'] = min(100, d['morale'] + 15)
            if event['kind'] == 'recall':
                for b in state['fleet']:
                    b['wear']['energy'] = 0
                    b['revision'] += 1
        event['choice'] = choice
    else:
        raise ApiError(422, 'unknown_command', 'Unknown company command.')
    return state


@router.get('')
def snapshot(player: Player = Depends(current_player), db: Session = Depends(get_db)):
    player = lock_player(db, player)
    record, state = state_for(db, player)
    db.commit()
    return view(record, state)


@router.post('/settle')
def settle(data: SettleRequest, player: Player = Depends(current_player), db: Session = Depends(get_db)):
    player = lock_player(db, player)
    record, state = state_for(db, player)
    target = target_slot(data.through_slot)
    old_cursor = state['cursor']
    state = cap_to_server_window(state)
    if target > state['cursor'] or state['cursor'] != old_cursor:
        state = advance(state, target)
        persist(db, player, record, state)
    db.commit()
    return view(record, state)


@router.post('/commands')
def command(data: TycoonCommand, player: Player = Depends(current_player), db: Session = Depends(get_db)):
    player = lock_player(db, player)
    payload = data.model_dump(mode='json')
    cached = command_cached(db, player, data.operation_id, 'tycoon', payload)
    if cached:
        return JSONResponse(cached.response, status_code=cached.status)
    record, state = state_for(db, player)
    if data.base_revision != record.revision:
        raise ApiError(409, 'company_revision_conflict', 'Company changed on another device. No command was applied. Refresh and explicitly retry or cancel.', {'snapshot': view(record, state)})
    state = cap_to_server_window(state)
    slot = max(state['cursor'], min(data.at_slot, now() // 60))
    if data.at_slot > now() // 60 + 1:
        raise ApiError(422, 'future_command', 'Command timestamp is in the future.')
    if now() // 60 - data.at_slot > RULES['catchup_slots']:
        slot = now() // 60  # stale command is effective now, never backdated beyond cap
    state = advance(state, slot)
    state = apply_command(db, player, state, data, slot)
    persist(db, player, record, state)
    result = view(record, state)
    remember(db, player, data.operation_id, 'tycoon', payload, result)
    db.commit()
    return result


@router.get('/inspection/{bus_id}')
def inspect_bus(bus_id: str, player: Player = Depends(current_player), db: Session = Depends(get_db)):
    _, state = state_for(db, player)
    bus = require(state, 'fleet', bus_id)
    db.commit()
    return {'bus': bus, 'estimate': inspection(bus)}


@router.get('/fleet-conflicts')
def fleet_conflicts(player: Player = Depends(current_player), db: Session = Depends(get_db)):
    return {'items': [{'id': c.id, 'bus_id': c.bus_id, 'revision': c.revision, 'local': c.local_document, 'server': c.server_document} for c in db.scalars(select(FleetConflict).where(FleetConflict.user_id == player.id, FleetConflict.resolved.is_(False)))]}
