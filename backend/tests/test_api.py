from copy import deepcopy
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone, timedelta
import json
from pathlib import Path
from uuid import uuid4
import jwt
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from app.catalog import BASE_PHYSICS, catalog_data
from app.models import Player, AuthSession, CloudRevision, Result, now
from app.security import COOKIE, COOKIE_PATH


def operation(**fields):
    return {'operation_id': str(uuid4()), **fields}


def valid_result():
    return {'run_id': str(uuid4()), 'finished_at': datetime.now(timezone.utc).isoformat(),
            'seconds': 100, 'meters': 340, 'liters': .2, 'impacts': 0,
            'route': {'id': '21', 'score': 940, 'fares': 900, 'expenses': 0, 'served': 3, 'missed': 0, 'comfort': 100, 'penalties': 0, 'punctuality': 100}}


def game_save(paint='#217a6d'):
    return {'version': 1, 'paint': paint, 'quality': 'balanced', 'weather': 'clear', 'hour': 15, 'volume': .45, 'sessions': [], 'tutorial': True}


def save_body(version=0, paint='#217a6d'):
    return operation(base_version=version, client_id=str(uuid4()), document=game_save(paint))


def register_other(client):
    result = client.post('/api/auth/register', json={'email': 'other@example.com', 'password': 'Different-test-password-19', 'display_name': 'Other Driver'})
    assert result.status_code == 201
    return {'Authorization': f"Bearer {result.json()['access_token']}"}


def test_health_docs_and_openapi(client):
    assert client.get('/api/health').json()['status'] == 'ok'
    assert client.get('/docs').status_code == 200
    schema = client.get('/openapi.json').json()
    assert '/api/saves/conflicts/{conflict_id}/resolve' in schema['paths']
    assert '/api/multiplayer/rooms' in schema['paths']


def test_register_profile_hash_and_starter_fleet(client, account, app):
    response = client.get('/api/profile', headers=account['headers'])
    assert response.status_code == 200
    assert response.json()['level'] == 1
    assert response.json()['xp'] == 0
    assert response.json()['money'] == 5000000
    with app.state.sessions() as db:
        user = db.get(Player, account['user_id'])
        assert user.password_hash.startswith('$argon2id$')
        assert account['password'] not in user.password_hash
    fleet = client.get('/api/fleet', headers=account['headers']).json()['items']
    assert len(fleet) == 1 and fleet[0]['model_id'] == 'cb-120'
    assert 'password_hash' not in response.text


def test_duplicate_email_is_case_insensitive(client, account):
    response = client.post('/api/auth/register', json={'email': account['email'].upper(), 'password': account['password'], 'display_name': 'Duplicate'})
    assert response.status_code == 409


@pytest.mark.parametrize('patch', [{'password': 'tiny123'}, {'email': 'not-an-email'}, {'display_name': ' '}, {'admin': True}])
def test_registration_validation(client, patch):
    body = {'email': 'valid@example.com', 'password': 'A-long-test-password-42', 'display_name': 'Driver', **patch}
    response = client.post('/api/auth/register', json=body)
    assert response.status_code == 422
    assert body['password'] not in response.text


def test_login_refresh_cookie_rotation_and_logout(client, account):
    login = client.post('/api/auth/login', json={'email': account['email'], 'password': account['password']})
    assert login.status_code == 200
    cookie = login.headers['set-cookie']
    assert 'HttpOnly' in cookie and 'Secure' in cookie and 'SameSite=lax' in cookie and 'Path=/api/auth' in cookie
    old = client.cookies.get(COOKIE)
    refreshed = client.post('/api/auth/refresh')
    assert refreshed.status_code == 200
    assert client.cookies.get(COOKIE) != old
    headers = {'Authorization': f"Bearer {refreshed.json()['access_token']}"}
    assert client.get('/api/profile', headers=headers).status_code == 200
    assert client.post('/api/auth/logout', headers=headers).status_code == 204
    assert client.get('/api/profile', headers=headers).status_code == 401
    assert client.post('/api/auth/refresh').status_code == 401
    assert client.post('/api/auth/logout').status_code == 204


def test_refresh_reuse_revokes_family(client, account):
    original = client.cookies.get(COOKIE)
    new = client.post('/api/auth/refresh').json()
    replay = client.post('/api/auth/refresh', headers={'Cookie': f'{COOKIE}={original}'})
    assert replay.status_code == 401
    assert replay.json()['error']['code'] == 'refresh_reuse'
    assert client.get('/api/profile', headers={'Authorization': f"Bearer {new['access_token']}"}).status_code == 401


def test_expiry_wrong_audience_and_wrong_token_type(client, account, app):
    cfg = app.state.settings
    claims = jwt.decode(account['access_token'], app.state.signing_key, algorithms=['HS256'], audience=cfg.jwt_audience, issuer=cfg.jwt_issuer)
    for patch in ({'exp': now() - 1}, {'aud': 'other-app'}, {'type': 'refresh'}):
        token = jwt.encode({**claims, **patch}, app.state.signing_key, algorithm='HS256')
        assert client.get('/api/profile', headers={'Authorization': f'Bearer {token}'}).status_code == 401
    assert client.get('/api/profile').status_code == 401


def test_brute_force_persistent_lockout(client, account):
    for _ in range(5):
        assert client.post('/api/auth/login', json={'email': account['email'], 'password': 'wrong-password-123'}).status_code == 401
    blocked = client.post('/api/auth/login', json={'email': account['email'], 'password': account['password']})
    assert blocked.status_code == 429
    assert blocked.json()['error']['details']['retry_after'] > 0


def test_profile_cannot_patch_economy(client, account):
    assert client.patch('/api/profile', headers=account['headers'], json={'money': 999999999}).status_code == 422
    response = client.patch('/api/profile', headers=account['headers'], json={'display_name': 'New Driver', 'avatar': 'driver-blue', 'settings': {'units': 'metric'}})
    assert response.status_code == 200
    assert response.json()['display_name'] == 'New Driver'
    assert client.patch('/api/profile', headers=account['headers'], json={'avatar': 'javascript:alert(1)'}).status_code == 422


def test_catalog_matches_offline_copy_and_physics(client):
    response = client.get('/api/catalog')
    assert response.status_code == 200
    items = response.json()['items']
    assert len(items) == 24
    assert len({b['category'] for b in items}) == 6
    cb = next(b for b in items if b['id'] == 'cb-120')
    assert cb['stats']['physics_profile'] == BASE_PHYSICS
    assert cb['stats']['fuel_tank_l'] == 260
    assert cb['stats']['physics_profile']['mass_kg'] == 12000
    from app.fleet_specs import BY_ID
    assert len(BY_ID) == 24
    assert {b['id'] for b in items if b['drive_ready']} == set(BY_ID)
    copy = json.loads((Path(__file__).resolve().parents[2] / 'frontend/src/online/catalog.json').read_text())
    assert sorted(copy, key=lambda b: b['id']) == sorted(catalog_data(), key=lambda b: b['id'])
    for b in items:
        assert b['stats']['power_kw'] > 0 and b['price'] > 0
        if b['category'] == 'electric':
            assert b['stats']['fuel_tank_l'] == 0 and b['stats']['battery_kwh'] > 0


def test_purchase_is_idempotent_and_funds_are_authoritative(client, account):
    body = operation(model_id='sprout-60')
    first = client.post('/api/fleet/purchase', headers=account['headers'], json=body)
    assert first.status_code == 200
    second = client.post('/api/fleet/purchase', headers=account['headers'], json=body)
    assert second.json() == first.json()
    assert client.get('/api/profile', headers=account['headers']).json()['money'] == 1200000
    assert len(client.get('/api/fleet', headers=account['headers']).json()['items']) == 2
    assert client.post('/api/fleet/purchase', headers=account['headers'], json=operation(model_id='sprout-60')).status_code == 409
    assert client.post('/api/fleet/purchase', headers=account['headers'], json={**body, 'model_id': 'cb-120'}).status_code == 409


def test_locked_models_and_owned_bus_isolation(client, account):
    assert client.post('/api/fleet/purchase', headers=account['headers'], json=operation(model_id='crown-130')).status_code == 409
    bus = client.get('/api/fleet', headers=account['headers']).json()['items'][0]
    assert client.patch(f"/api/fleet/{bus['id']}", headers=account['headers'], json={'paint': '#aabbcc'}).json()['paint'] == '#aabbcc'
    other = register_other(client)
    assert client.patch(f"/api/fleet/{bus['id']}", headers=other, json={'paint': '#000000'}).status_code == 404
    assert client.patch(f"/api/fleet/{bus['id']}", headers=account['headers'], json={'fuel_l': 260}).status_code == 422


def test_upgrades_are_bounded_and_idempotent(client, account):
    bus = client.get('/api/fleet', headers=account['headers']).json()['items'][0]
    body = operation(upgrade='comfort')
    url = f"/api/fleet/{bus['id']}/upgrades"
    assert client.post(url, headers=account['headers'], json=body).json()['bus']['upgrades']['comfort'] == 1
    assert client.post(url, headers=account['headers'], json=body).json()['bus']['upgrades']['comfort'] == 1
    for _ in range(2):
        assert client.post(url, headers=account['headers'], json=operation(upgrade='comfort')).status_code == 200
    assert client.post(url, headers=account['headers'], json=operation(upgrade='comfort')).status_code == 409


def test_company_hire_train_fire_routes_reports(client, account):
    company = client.get('/api/company', headers=account['headers']).json()
    assert [r['line_id'] for r in company['routes']] == ['21', '36', '80', 'M1', 'M2', 'H1', 'H2']
    body = operation(template_id='maya')
    hired = client.post('/api/company/drivers', headers=account['headers'], json=body)
    assert hired.status_code == 200
    driver = hired.json()['driver']
    assert client.post('/api/company/drivers', headers=account['headers'], json=body).json() == hired.json()
    training = operation(skill='safety')
    url = f"/api/company/drivers/{driver['id']}/train"
    result = client.post(url, headers=account['headers'], json=training)
    assert result.json()['driver']['skills']['safety'] == driver['skills']['safety'] + 5
    assert client.post(url, headers=account['headers'], json=training).json() == result.json()
    assert client.delete(f"/api/company/drivers/{driver['id']}", headers=account['headers']).status_code == 204
    assert client.post(url, headers=account['headers'], json=operation(skill='safety')).status_code == 409
    plan = {'departure_minutes': [480, 600], 'ticket_price': 300}
    assert client.put('/api/company/routes/21', headers=account['headers'], json=plan).json()['ticket_price'] == 300
    assert client.put('/api/company/routes/21', headers=account['headers'], json={**plan, 'departure_minutes': [600, 480]}).status_code == 422
    for period in ('daily', 'monthly'):
        report = client.get(f'/api/company/reports?period={period}', headers=account['headers']).json()
        assert report['expenses'] == 50000 and report['income'] == 0 and report['net'] == -50000


def test_terminal_purchase_and_company_isolation(client, account):
    response = client.post('/api/company/terminals', headers=account['headers'], json=operation(template_id='riverside'))
    assert response.status_code == 200
    assert client.post('/api/company/terminals', headers=account['headers'], json=operation(template_id='riverside')).status_code == 409
    driver = client.post('/api/company/drivers', headers=account['headers'], json=operation(template_id='elias')).json()['driver']
    other = register_other(client)
    assert client.delete(f"/api/company/drivers/{driver['id']}", headers=other).status_code == 404


def test_result_updates_progression_once_and_records_mileage(client, account):
    body = valid_result()
    response = client.post('/api/results', headers=account['headers'], json=body)
    assert response.status_code == 200, response.text
    profile = response.json()['profile']
    assert profile['xp'] == 287  # 120 stops + 47 score + 20 comfort + 100 first mission
    assert profile['money'] == 5000000 + 900 + 25000
    assert 'first-shift' in profile['achievements'] and 'smooth-operator' in profile['achievements']
    again = client.post('/api/results', headers=account['headers'], json=body)
    assert again.status_code == 200 and again.json()['duplicate']
    assert again.json()['profile']['xp'] == profile['xp']
    fleet = client.get('/api/fleet', headers=account['headers']).json()['items'][0]
    assert fleet['mileage_m'] == 340 and fleet['fuel_l'] == pytest.approx(209.8)
    progression = client.get('/api/progression', headers=account['headers']).json()
    assert progression['missions'][0]['claimed']
    changed = {**body, 'meters': 500}
    assert client.post('/api/results', headers=account['headers'], json=changed).status_code == 409


def test_levels_unlock_models_and_mission_rewards_are_not_repeated(client, account):
    for _ in range(3):
        assert client.post('/api/results', headers=account['headers'], json=valid_result()).status_code == 200
    player = client.get('/api/profile', headers=account['headers']).json()
    assert player['xp'] == 661 and player['level'] == 2
    assert 'loop-80' in player['unlocks'] and 'crown-130' not in player['unlocks']
    assert player['money'] == 5000000 + 3 * 900 + 25000
    missions = client.get('/api/progression', headers=account['headers']).json()['missions']
    assert missions[0]['claimed'] and not missions[1]['claimed']


def test_result_concurrent_retry_is_single_credit(app, client, account):
    body = valid_result()
    def send():
        another = TestClient(app, base_url='https://testserver')
        try:
            return another.post('/api/results', headers=account['headers'], json=body)
        finally:
            another.close()
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(lambda _: send(), range(2)))
    assert all(r.status_code == 200 for r in responses)
    assert sum(not r.json()['duplicate'] for r in responses) == 1
    assert len(client.get('/api/results', headers=account['headers']).json()['items']) == 1


@pytest.mark.parametrize('mutate', [
    lambda b: b.update(seconds=1), lambda b: b.update(meters=2), lambda b: b.update(meters=100000),
    lambda b: b.update(liters=100), lambda b: b['route'].update(fares=100000),
    lambda b: b['route'].update(score=999999), lambda b: b['route'].update(comfort=101),
    lambda b: b['route'].update(served=2), lambda b: b['route'].update(fares=901),
    lambda b: b['route'].update(penalties=-20), lambda b: b.update(finished_at=(datetime.now(timezone.utc)+timedelta(days=1)).isoformat()),
    lambda b: b.update(finished_at=(datetime.now(timezone.utc)-timedelta(days=400)).isoformat()),
    lambda b: b.update(owned_bus_id=str(uuid4())),
])
def test_invalid_results_never_credit_progress(client, account, mutate):
    body = valid_result()
    mutate(body)
    response = client.post('/api/results', headers=account['headers'], json=body)
    assert response.status_code in (422, 404), response.text
    profile = client.get('/api/profile', headers=account['headers']).json()
    assert profile['xp'] == 0 and profile['money'] == 5000000
    assert client.get('/api/results', headers=account['headers']).json()['items'] == []


def test_results_are_account_scoped(client, account):
    assert client.post('/api/results', headers=account['headers'], json=valid_result()).status_code == 200
    other = register_other(client)
    assert client.get('/api/results', headers=other).json()['items'] == []


def test_save_versions_conflict_preserves_both_and_resolves(client, account, app):
    assert client.get('/api/saves', headers=account['headers']).json()['version'] == 0
    first = save_body()
    assert client.put('/api/saves', headers=account['headers'], json=first).json()['version'] == 1
    assert client.put('/api/saves', headers=account['headers'], json=first).json()['version'] == 1
    second = save_body(0, '#aabbcc')
    conflict = client.put('/api/saves', headers=account['headers'], json=second)
    assert conflict.status_code == 409
    data = conflict.json()['error']['details']['conflict']
    assert data['local']['document']['paint'] == '#aabbcc'
    assert data['server']['document']['paint'] == '#217a6d'
    assert client.get('/api/saves', headers=account['headers']).json()['version'] == 1
    assert client.put('/api/saves', headers=account['headers'], json=second).json() == conflict.json()
    resolution = operation(choice='local', expected_version=1)
    resolved = client.post(f"/api/saves/conflicts/{data['id']}/resolve", headers=account['headers'], json=resolution)
    assert resolved.status_code == 200 and resolved.json()['version'] == 2
    assert resolved.json()['document']['paint'] == '#aabbcc'
    assert client.post(f"/api/saves/conflicts/{data['id']}/resolve", headers=account['headers'], json=resolution).json() == resolved.json()
    history = client.get('/api/saves/history', headers=account['headers']).json()['items']
    assert len(history) == 3
    assert {r['document']['paint'] for r in history} == {'#aabbcc', '#217a6d'}


def test_conflict_can_choose_server_without_deleting_local_revision(client, account):
    client.put('/api/saves', headers=account['headers'], json=save_body())
    conflict = client.put('/api/saves', headers=account['headers'], json=save_body(0, '#ffffff')).json()['error']['details']['conflict']
    result = client.post(f"/api/saves/conflicts/{conflict['id']}/resolve", headers=account['headers'], json=operation(choice='server', expected_version=1))
    assert result.status_code == 200
    assert result.json()['document']['paint'] == '#217a6d'
    assert len(client.get('/api/saves/history', headers=account['headers']).json()['items']) == 3


def test_resolution_detects_a_third_device_write(client, account):
    client.put('/api/saves', headers=account['headers'], json=save_body())
    conflict = client.put('/api/saves', headers=account['headers'], json=save_body(0, '#ffffff')).json()['error']['details']['conflict']
    client.put('/api/saves', headers=account['headers'], json=save_body(1, '#000000'))
    result = client.post(f"/api/saves/conflicts/{conflict['id']}/resolve", headers=account['headers'], json=operation(choice='local', expected_version=1))
    assert result.status_code == 409
    updated = result.json()['error']['details']['conflict']
    assert updated['server_version'] == 2 and updated['server']['document']['paint'] == '#000000'
    assert updated['local']['document']['paint'] == '#ffffff'


def test_cloud_cannot_restore_money_or_other_players_data(client, account):
    body = save_body()
    body['document']['money'] = 999999999
    assert client.put('/api/saves', headers=account['headers'], json=body).status_code == 422
    client.put('/api/saves', headers=account['headers'], json=save_body())
    conflict = client.put('/api/saves', headers=account['headers'], json=save_body(0, '#ffffff')).json()['error']['details']['conflict']
    other = register_other(client)
    assert client.get('/api/saves', headers=other).json()['version'] == 0
    assert client.post(f"/api/saves/conflicts/{conflict['id']}/resolve", headers=other, json=operation(choice='local', expected_version=1)).status_code == 404


def test_cors_limits_and_central_errors(client, account, app):
    allowed = client.options('/api/profile', headers={'Origin': 'http://127.0.0.1:4173', 'Access-Control-Request-Method': 'GET'})
    assert allowed.headers['access-control-allow-origin'] == 'http://127.0.0.1:4173'
    assert client.post('/api/auth/refresh', headers={'Origin': 'https://evil.example'}).status_code == 403
    assert client.put('/api/saves', headers=account['headers'], content='x'*460000).status_code == 413
    app.state.settings.rate_limit_per_minute = 1
    app.state.rate_buckets.clear()
    assert client.get('/api/catalog').status_code == 200
    limited = client.get('/api/catalog')
    assert limited.status_code == 429 and limited.headers['retry-after'] == '60'
    assert limited.json()['error']['code'] == 'rate_limited'
