from hashlib import sha256
import json
from sqlalchemy import select
from .catalog import catalog_data, MISSIONS
from .errors import ApiError
from .models import Player, Command, Ledger, Result


def digest(payload) -> str:
    return sha256(json.dumps(payload, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()).hexdigest()


def level(player):
    return 1 + player.xp // 500


def profile(player):
    return {'id': player.id, 'email': player.email, 'display_name': player.display_name, 'avatar': player.avatar,
            'level': level(player), 'xp': player.xp, 'money': player.money, 'currency': 'EUR',
            'settings': player.settings, 'achievements': player.achievements,
            'unlocks': [b['id'] for b in catalog_data() if b['required_level'] <= level(player)]}


def lock_player(db, player):
    return db.scalar(select(Player).where(Player.id == player.id).with_for_update().execution_options(populate_existing=True))


def command_cached(db, player, operation_id, kind, payload):
    row = db.scalar(select(Command).where(Command.user_id == player.id, Command.operation_id == str(operation_id)))
    if row and (row.kind != kind or row.payload_hash != digest(payload)):
        raise ApiError(409, 'idempotency_mismatch', 'That operation id was already used for different data.')
    return row


def remember(db, player, operation_id, kind, payload, result, status=200):
    db.add(Command(user_id=player.id, operation_id=str(operation_id), kind=kind,
                   payload_hash=digest(payload), response=result, status=status))


def charge(db, player, amount: int, kind: str, reference: str):
    if player.money < amount:
        raise ApiError(409, 'insufficient_funds', 'There is not enough money for this purchase.')
    player.money -= amount
    db.add(Ledger(user_id=player.id, kind=kind, amount=-amount, reference=reference))


def progression(db, player):
    results = db.scalars(select(Result).where(Result.user_id == player.id)).all()
    counts = {'routes': sum(r.payload['route']['served'] > 0 for r in results),
              'stops': sum(r.payload['route']['served'] for r in results),
              'lines': len({r.route_id for r in results if r.payload['route']['served'] > 0})}
    return {'missions': [{**m, 'progress': min(m['target'], counts[m['metric']]), 'claimed': m['id'] in player.claimed_missions} for m in MISSIONS],
            'achievements': [{'id': 'first-shift', 'name': 'First shift', 'earned': 'first-shift' in player.achievements},
                             {'id': 'smooth-operator', 'name': 'Smooth operator', 'earned': 'smooth-operator' in player.achievements},
                             {'id': 'ten-services', 'name': 'Ten services', 'earned': 'ten-services' in player.achievements},
                             {'id': 'first-race', 'name': 'First checkpoint race', 'earned': 'first-race' in player.achievements},
                             {'id': 'race-winner', 'name': 'Northbank Sprint winner', 'earned': 'race-winner' in player.achievements},
                             {'id': 'shared-city-service', 'name': 'Shared city service', 'earned': 'shared-city-service' in player.achievements}],
            'counts': counts}
