from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session
from .common import level, lock_player, command_cached, remember, charge
from .database import get_db
from .errors import ApiError
from .models import BusModel, OwnedBus, Player, Terminal
from .schemas import Purchase, OwnedPatch, Upgrade
from .security import current_player

router = APIRouter(tags=['Catalog and fleet'])


def bus_view(bus):
    return {key: getattr(bus, key) for key in ('id', 'name', 'category', 'stats', 'price', 'required_level', 'drive_ready')}


def owned_view(bus):
    return {key: getattr(bus, key) for key in ('id', 'model_id', 'upgrades', 'paint', 'damage', 'mileage_m', 'fuel_l')}


def own_bus(db, player, id_):
    bus = db.get(OwnedBus, id_)
    if not bus or bus.user_id != player.id:
        raise ApiError(404, 'not_found', 'Owned bus not found.')
    return bus


@router.get('/catalog')
def catalog(db: Session = Depends(get_db)):
    return {'items': [bus_view(b) for b in db.scalars(select(BusModel).order_by(BusModel.price))], 'currency': 'EUR', 'price_unit': 'cents'}


@router.get('/fleet')
def fleet(player: Player = Depends(current_player), db: Session = Depends(get_db)):
    return {'items': [owned_view(b) for b in db.scalars(select(OwnedBus).where(OwnedBus.user_id == player.id))]}


@router.post('/fleet/purchase')
def purchase(data: Purchase, player: Player = Depends(current_player), db: Session = Depends(get_db)):
    player = lock_player(db, player)
    payload = data.model_dump(mode='json')
    cached = command_cached(db, player, data.operation_id, 'purchase', payload)
    if cached:
        return cached.response
    model = db.get(BusModel, data.model_id)
    if not model:
        raise ApiError(404, 'not_found', 'Bus model not found.')
    if model.required_level > level(player):
        raise ApiError(409, 'level_locked', 'Earn more XP to unlock this model.')
    capacity = sum(t.capacity for t in db.scalars(select(Terminal).where(Terminal.user_id == player.id)))
    fleet_count = len(db.scalars(select(OwnedBus.id).where(OwnedBus.user_id == player.id)).all())
    if fleet_count >= capacity:
        raise ApiError(409, 'terminal_full', 'Upgrade or buy a terminal before expanding the fleet.')
    charge(db, player, model.price, 'bus_purchase', model.id)
    bus = OwnedBus(user_id=player.id, model_id=model.id, fuel_l=model.stats['fuel_tank_l'] * .8)
    db.add(bus)
    db.flush()
    result = {'bus': owned_view(bus), 'money': player.money, 'drive_ready': model.drive_ready}
    remember(db, player, data.operation_id, 'purchase', payload, result)
    db.commit()
    return result


@router.patch('/fleet/{bus_id}')
def paint_bus(bus_id: str, data: OwnedPatch, player: Player = Depends(current_player), db: Session = Depends(get_db)):
    bus = own_bus(db, player, bus_id)
    bus.paint = data.paint.lower()
    db.commit()
    return owned_view(bus)


@router.post('/fleet/{bus_id}/upgrades')
def upgrade_bus(bus_id: str, data: Upgrade, player: Player = Depends(current_player), db: Session = Depends(get_db)):
    player = lock_player(db, player)
    payload = {**data.model_dump(mode='json'), 'bus_id': bus_id}
    cached = command_cached(db, player, data.operation_id, 'upgrade', payload)
    if cached:
        return cached.response
    bus = own_bus(db, player, bus_id)
    rank = bus.upgrades.get(data.upgrade, 0)
    if rank >= 3:
        raise ApiError(409, 'upgrade_maxed', 'This upgrade is already at its maximum level.')
    charge(db, player, (rank + 1) * 10000, 'bus_upgrade', bus.id)
    bus.upgrades = {**bus.upgrades, data.upgrade: rank + 1}
    result = {'bus': owned_view(bus), 'money': player.money, 'effect': 'Company inventory upgrade; driving physics unchanged in Stage 3.'}
    remember(db, player, data.operation_id, 'upgrade', payload, result)
    db.commit()
    return result
