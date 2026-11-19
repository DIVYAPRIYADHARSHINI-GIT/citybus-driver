from datetime import date, datetime, timedelta, timezone
from typing import Literal
from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session
from .catalog import DRIVER_TEMPLATES, TERMINALS, LINES
from .common import charge, lock_player, command_cached, remember
from .database import get_db
from .errors import ApiError
from .models import Player, Driver, Terminal, CompanyRoute, Ledger
from .schemas import Hire, Train, Operation, RoutePlan
from .security import current_player

router = APIRouter(prefix='/company', tags=['Company'])


def driver_view(d):
    return {k: getattr(d, k) for k in ('id', 'template_id', 'name', 'skills', 'salary_daily', 'active')}


def owned(db, model, id_, player):
    row = db.get(model, id_)
    if not row or row.user_id != player.id:
        raise ApiError(404, 'not_found', 'Company resource not found.')
    return row


@router.get('')
def company(player: Player = Depends(current_player), db: Session = Depends(get_db)):
    return {'name': f'{player.display_name} Transit', 'money': player.money, 'currency': 'EUR',
            'drivers': [driver_view(d) for d in db.scalars(select(Driver).where(Driver.user_id == player.id))],
            'terminals': [{'id': t.id, 'template_id': t.template_id, 'name': t.name, 'capacity': t.capacity} for t in db.scalars(select(Terminal).where(Terminal.user_id == player.id))],
            'routes': [{'id': r.id, 'line_id': r.line_id, 'timetable': r.timetable, 'ticket_price': r.ticket_price} for r in db.scalars(select(CompanyRoute).where(CompanyRoute.user_id == player.id))],
            'recruitment': DRIVER_TEMPLATES, 'terminal_catalog': TERMINALS, 'lines': LINES,
            'notice': 'Roster/planning APIs only. No automatic driver earnings or salary scheduler. Custom company fares do not yet replace the offline city fare table.'}


@router.post('/drivers')
def hire(data: Hire, player: Player = Depends(current_player), db: Session = Depends(get_db)):
    player = lock_player(db, player)
    payload = data.model_dump(mode='json')
    cached = command_cached(db, player, data.operation_id, 'hire', payload)
    if cached:
        return cached.response
    template = next((d for d in DRIVER_TEMPLATES if d['id'] == data.template_id), None)
    if not template:
        raise ApiError(404, 'not_found', 'Driver candidate not found.')
    driver = db.scalar(select(Driver).where(Driver.user_id == player.id, Driver.template_id == data.template_id))
    if driver and driver.active:
        raise ApiError(409, 'already_hired', 'This driver is already employed.')
    charge(db, player, template['hire_cost'], 'driver_hire', template['id'])
    if driver:
        driver.active = True
    else:
        driver = Driver(user_id=player.id, template_id=template['id'], name=template['name'], skills=template['skills'], salary_daily=template['salary_daily'])
        db.add(driver)
    db.flush()
    result = {'driver': driver_view(driver), 'money': player.money}
    remember(db, player, data.operation_id, 'hire', payload, result)
    db.commit()
    return result


@router.delete('/drivers/{driver_id}', status_code=204)
def fire(driver_id: str, player: Player = Depends(current_player), db: Session = Depends(get_db)):
    driver = owned(db, Driver, driver_id, player)
    driver.active = False
    db.commit()


@router.post('/drivers/{driver_id}/train')
def train(driver_id: str, data: Train, player: Player = Depends(current_player), db: Session = Depends(get_db)):
    player = lock_player(db, player)
    payload = {**data.model_dump(mode='json'), 'driver_id': driver_id}
    cached = command_cached(db, player, data.operation_id, 'train', payload)
    if cached:
        return cached.response
    driver = owned(db, Driver, driver_id, player)
    if not driver.active or driver.skills[data.skill] >= 100:
        raise ApiError(409, 'training_unavailable', 'Driver is inactive or that skill is already maxed.')
    charge(db, player, 15000, 'driver_training', driver.id)
    driver.skills = {**driver.skills, data.skill: min(100, driver.skills[data.skill] + 5)}
    result = {'driver': driver_view(driver), 'money': player.money}
    remember(db, player, data.operation_id, 'train', payload, result)
    db.commit()
    return result


@router.post('/terminals')
def buy_terminal(data: Hire, player: Player = Depends(current_player), db: Session = Depends(get_db)):
    player = lock_player(db, player)
    payload = data.model_dump(mode='json')
    cached = command_cached(db, player, data.operation_id, 'terminal', payload)
    if cached:
        return cached.response
    template = next((t for t in TERMINALS if t['id'] == data.template_id), None)
    if not template:
        raise ApiError(404, 'not_found', 'Terminal not found.')
    if db.scalar(select(Terminal).where(Terminal.user_id == player.id, Terminal.template_id == template['id'])):
        raise ApiError(409, 'already_owned', 'This terminal is already owned.')
    charge(db, player, template['price'], 'terminal_purchase', template['id'])
    terminal = Terminal(user_id=player.id, template_id=template['id'], name=template['name'], capacity=template['capacity'])
    db.add(terminal)
    db.flush()
    result = {'id': terminal.id, 'name': terminal.name, 'capacity': terminal.capacity, 'money': player.money}
    remember(db, player, data.operation_id, 'terminal', payload, result)
    db.commit()
    return result


@router.put('/routes/{line_id}')
def plan_route(line_id: str, data: RoutePlan, player: Player = Depends(current_player), db: Session = Depends(get_db)):
    route = db.scalar(select(CompanyRoute).where(CompanyRoute.user_id == player.id, CompanyRoute.line_id == line_id))
    if not route:
        raise ApiError(404, 'not_found', 'Northbank line not found.')
    route.timetable = {**route.timetable, 'departure_minutes': data.departure_minutes}
    route.ticket_price = data.ticket_price
    db.commit()
    return {'line_id': line_id, 'timetable': route.timetable, 'ticket_price': route.ticket_price, 'scope': 'company-planning'}


@router.get('/reports')
def report(period: Literal['daily', 'monthly'] = 'daily', on: date | None = None, player: Player = Depends(current_player), db: Session = Depends(get_db)):
    day = on or datetime.now(timezone.utc).date()
    start = datetime(day.year, day.month, day.day if period == 'daily' else 1, tzinfo=timezone.utc)
    if period == 'daily':
        end = start + timedelta(days=1)
    else:
        end = datetime(day.year + (day.month == 12), day.month % 12 + 1, 1, tzinfo=timezone.utc)
    rows = db.scalars(select(Ledger).where(Ledger.user_id == player.id, Ledger.created_at >= int(start.timestamp()), Ledger.created_at < int(end.timestamp())).order_by(Ledger.created_at)).all()
    operating = [r for r in rows if r.kind not in ('tycoon_loan_draw', 'tycoon_loan_repayment')]
    income = sum(max(0, r.amount) for r in operating)
    expenses = -sum(min(0, r.amount) for r in operating)
    return {'period': period, 'start': start.isoformat(), 'end': end.isoformat(), 'timezone': 'UTC', 'currency': 'EUR',
            'income': income, 'expenses': expenses, 'net': income - expenses,
            'financing_in': sum(r.amount for r in rows if r.kind == 'tycoon_loan_draw'),
            'financing_out': -sum(r.amount for r in rows if r.kind == 'tycoon_loan_repayment'),
            'cash_flow': sum(r.amount for r in rows if r.kind != 'tycoon_interest'),
            'entries': [{'id': r.id, 'kind': r.kind, 'amount': r.amount, 'reference': r.reference, 'created_at': r.created_at} for r in rows]}
