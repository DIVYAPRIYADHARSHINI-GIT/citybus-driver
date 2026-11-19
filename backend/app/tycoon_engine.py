"""Deterministic integer simulation. See frontend/src/tycoon/engine.ts for the
identical offline implementation; cross-language golden fixtures are tested.
All money is cents; wear is basis points (0..10000); energy is ml or Wh.
"""
from copy import deepcopy
from .fleet_specs import RULES, BY_ID


def clamp(n, lo, hi):
    return max(lo, min(hi, n))


def stable_hash(value):
    result = 2166136261
    for char in value:
        result = ((result ^ ord(char)) * 16777619) & 0xffffffff
    return result


def wear_new():
    return {'engine': 0, 'brakes': 0, 'tires': 0, 'energy': 0}


def empty_state(slot):
    return {'schema': 1, 'cursor': slot, 'assignments': [], 'loans': [], 'events': [],
            'ledger': [], 'settled': [], 'reputation': 70, 'skipped_slots': 0,
            'claims': [], 'achievements': [], 'event_cursor': slot // 180,
            'daily': {}, 'weekly': {}}


def add_ledger(state, key, kind, amount, slot, route=None):
    if any(e['id'] == key for e in state['ledger']):
        return
    state['ledger'].append({'id': key, 'kind': kind, 'amount': amount, 'slot': slot, 'route': route})
    state['ledger'] = state['ledger'][-4000:]
    state['money'] += amount


def skill(driver, key):
    aliases = {'comfort': 'service', 'economy': 'economy', 'punctuality': 'safety'}
    return driver['skills'].get(key, driver['skills'].get(aliases.get(key, key), 60))


def event_effects(state, slot):
    result = {'fuel': 100, 'demand': 100, 'delay': 0, 'strike': False}
    for event in state['events']:
        if event['start'] <= slot < event['end']:
            choice = event.get('choice', 'ignore')
            if event['kind'] == 'fuel-spike':
                result['fuel'] = 110 if choice == 'respond' else 150
            if event['kind'] == 'festival':
                result['demand'] = 155 if choice == 'respond' else 120
            if event['kind'] == 'weather':
                result['delay'] = 8 if choice == 'respond' else 25
            if event['kind'] == 'strike' and choice != 'respond':
                result['strike'] = True
    return result


def settle_trip(state, assignment, departure, bus, driver):
    route = RULES['routes'][assignment['route_id']]
    end = departure + route['duration_slots']
    key = f"{assignment['id']}:{departure}"
    if key in state['settled']:
        return
    state['settled'].append(key)
    state['settled'] = state['settled'][-10000:]
    spec = BY_ID.get(bus['model_id'])
    if not spec:
        return
    wear = bus['wear']
    upgrades = bus['upgrades']
    effects = event_effects(state, departure)
    seed = stable_hash(key)
    safety = skill(driver, 'safety')
    comfort = clamp(skill(driver, 'comfort') + upgrades.get('seats', 0) * 5 + upgrades.get('interior', 0) * 2 - wear['tires'] // 500, 0, 100)
    punctuality = clamp(skill(driver, 'punctuality') - effects['delay'] + (seed % 13) - 6, 0, 100)
    breakdown = max(wear.values()) > 7000 and seed % 10000 < (max(wear.values()) - 6500) // 2
    demand = max(1, spec['capacity'] * (40 + state['reputation']) // 150)
    passengers = clamp(demand * effects['demand'] // 100 + seed % 7 - 3, 0, spec['capacity'])
    if effects['strike'] or breakdown or driver['morale'] < 15:
        passengers = 0
    fare = passengers * assignment['ticket_price']
    used = max(1, route['meters'] * spec['consumption_per_km'] // 1000)
    used = used * (130 - skill(driver, 'economy') // 2) // 100
    used = used * (100 + wear['energy'] // 200) // 100
    rate = RULES['energy_cents_per_kwh'] if spec['energy'] == 'electric' else RULES['fuel_cents_per_litre']
    # Depot purchases exactly the energy consumed. This preserves the tank/SOC;
    # manual trips consume stored energy instead. The purchase is always explicit.
    fuel_cost = (used * rate * effects['fuel'] + 99999) // 100000
    wages = (driver['salary_daily'] * route['duration_slots'] + 479) // 480
    maintenance = 25 + route['meters'] * (5 + wear['engine'] // 1000) // 1000
    fine = 2500 if seed % 100 < max(0, 70 - safety) else 0
    repair = 4500 if breakdown else 0
    toll = route.get('toll_cents', 0) if not effects['strike'] else 0
    for kind, amount in [('ai_fares', fare), ('energy', -fuel_cost), ('wages', -wages), ('maintenance', -maintenance), ('fines', -fine), ('breakdown', -repair), ('toll', -toll)]:
        if amount:
            add_ledger(state, f'{key}:{kind}', kind, amount, end, route['id'])
    distance = route['meters'] if not effects['strike'] else 0
    bus['mileage_m'] += distance
    for part, rate in [('engine', 3), ('brakes', 4), ('tires', 5), ('energy', 2)]:
        wear[part] = clamp(wear[part] + (distance * rate + 999) // 1000 + (10 if breakdown else 0), 0, 10000)
    if bus['service_due_m'] and bus['mileage_m'] >= bus['service_due_m']:
        cost = inspection(bus)['cost']
        if state['money'] >= cost:
            add_ledger(state, f'{key}:scheduled', 'scheduled_service', -cost, end, route['id'])
            bus['wear'] = wear_new()
            bus['damage'] = 0
            bus['service_due_m'] = bus['mileage_m'] + 10000
    bus['revision'] += 1
    driver['morale'] = clamp(driver['morale'] + (1 if passengers else -2) + (1 if driver['salary_daily'] >= 20000 else 0), 0, 100)
    quality = (punctuality + comfort + safety) // 3 - (20 if fine else 0) - (30 if breakdown else 0)
    state['reputation'] = clamp(state['reputation'] + (1 if quality >= 75 else -2 if quality < 50 else 0), 0, 100)
    state['xp'] += 5 + passengers // 5
    day, week = str(end // 1440), str(end // 10080)
    state['daily'][day] = state['daily'].get(day, 0) + 1
    state['weekly'][week] = state['weekly'].get(week, 0) + 1
    for prefix, period, progress, target, reward in [('daily', day, state['daily'][day], 3, 2000), ('weekly', week, state['weekly'][week], 15, 15000)]:
        claim = f'{prefix}:{period}'
        if progress >= target and claim not in state['claims']:
            state['claims'].append(claim)
            add_ledger(state, f'mission:{claim}', 'mission_reward', reward, end)
            state['xp'] += 25 if prefix == 'daily' else 100
    if 'first-dispatch' not in state['achievements']:
        state['achievements'].append('first-dispatch')
    if state['reputation'] >= 90 and 'trusted-operator' not in state['achievements']:
        state['achievements'].append('trusted-operator')


def inspection(bus):
    parts = {part: wear * RULES['wear_repair_cents_per_bp'][part] for part, wear in bus['wear'].items()}
    parts['body'] = bus['damage'] * 45
    return {'parts': parts, 'cost': sum(parts.values()), 'condition': 100 - max(bus['wear'].values()) // 100}


def advance(source, target):
    state = deepcopy(source)
    target = max(state['cursor'], int(target))
    start = state['cursor']
    if target - start > RULES['catchup_slots']:
        state['skipped_slots'] += target - start - RULES['catchup_slots']
        start = target - RULES['catchup_slots']
    trips = {}
    for assignment in state['assignments']:
        if not assignment['active']:
            continue
        route = RULES['routes'][assignment['route_id']]
        duration = route['duration_slots']
        for day in range(max(0, (start - duration) // 1440), target // 1440 + 1):
            for minute in assignment['departures']:
                departure = day * 1440 + minute
                if departure >= assignment['effective_slot'] and start < departure + duration <= target:
                    trips.setdefault(departure + duration, []).append((assignment, departure))
    buses = {b['id']: b for b in state['fleet']}
    drivers = {d['id']: d for d in state['drivers']}
    # Process every retained minute chronologically. Advancing in one batch or
    # in small calls has identical event, morale and loan effects.
    for slot in range(start + 1, target + 1):
        if slot % 180 == 0 and slot // 180 > state['event_cursor']:
            bucket = slot // 180
            state['events'].append({'id': f'event:{bucket}', 'kind': RULES['event_kinds'][bucket % len(RULES['event_kinds'])], 'start': slot, 'end': slot + 120, 'choice': None})
            state['event_cursor'] = bucket
        for event in state['events']:
            if event['end'] <= slot and not event.get('finalized'):
                if event.get('choice') != 'respond':
                    if event['kind'] == 'quit':
                        candidates = sorted([d for d in state['drivers'] if d['active']], key=lambda d: (d['morale'], d['id']))
                        if candidates and candidates[0]['morale'] < 50:
                            candidates[0]['active'] = False
                            for a in state['assignments']:
                                if a['driver_id'] == candidates[0]['id']:
                                    a['active'] = False
                    if event['kind'] == 'recall':
                        for b in state['fleet']:
                            b['wear']['energy'] = min(10000, b['wear']['energy'] + 200)
                            b['revision'] += 1
                    if event['kind'] == 'strike':
                        state['reputation'] = max(0, state['reputation'] - 3)
                event['finalized'] = True
        for assignment, departure in sorted(trips.get(slot, []), key=lambda row: row[0]['id']):
            bus, driver = buses.get(assignment['bus_id']), drivers.get(assignment['driver_id'])
            if assignment['active'] and bus and driver and driver['active'] and not bus.get('reserved'):
                settle_trip(state, assignment, departure, bus, driver)
        if slot % 1440 == 0:
            for loan in state['loans']:
                day = slot // 1440
                if day > loan['interest_day'] and loan['balance'] > 0:
                    interest = (loan['balance'] * RULES['loan_daily_bps'] + 9999) // 10000
                    loan['balance'] += interest
                    loan['interest_day'] = day
                    add_ledger(state, f"loan:{loan['id']}:{day}", 'interest', -interest, slot)
                    state['money'] += interest
    state['events'] = state['events'][-30:]
    state['event_cursor'] = target // 180
    state['cursor'] = target
    state['bankruptcy_warning'] = state['money'] < 0 or sum(l['balance'] for l in state['loans']) > max(100000, state['money'] * 3)
    return state
