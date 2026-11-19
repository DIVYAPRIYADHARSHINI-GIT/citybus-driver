"""Idempotent seed data; schema creation is exclusively handled by Alembic."""
from .catalog import catalog_data
from .config import Settings
from .database import engine_for, factory_for
from .models import BusModel


def seed(db):
    from .leaderboards import record_valid_result, record_profit
    from .models import Result, Ledger
    from sqlalchemy import select
    from .models import WorldDefinition
    from .world_data import MAPS, WEATHER
    for item in [*MAPS, {'id':'weather', 'presets':WEATHER}]:
        existing = db.get(WorldDefinition, item['id'])
        if existing:
            if existing.document != item:
                existing.document = item
                existing.revision += 1
        else:
            db.add(WorldDefinition(id=item['id'], revision=1, document=item))
    for data in catalog_data():
        existing = db.get(BusModel, data['id'])
        if existing:
            for key, value in data.items():
                setattr(existing, key, value)
        else:
            db.add(BusModel(**data))
    db.flush()
    from .models import Player, CompanyRoute
    from .world_data import NEW_LINES
    for user_id in db.scalars(select(Player.id)):
        existing_lines = set(db.scalars(select(CompanyRoute.line_id).where(CompanyRoute.user_id == user_id)))
        for line in NEW_LINES:
            if line['id'] not in existing_lines:
                db.add(CompanyRoute(user_id=user_id, line_id=line['id'], timetable={'departure_minutes': [], 'relative_stop_seconds': line['due']}, ticket_price=250))
    for result in db.scalars(select(Result)):
        record_valid_result(db, result)
    for ledger in db.scalars(select(Ledger)):
        record_profit(db, ledger, ledger.created_at)
    db.commit()


if __name__ == '__main__':
    engine = engine_for(Settings().database_url)
    with factory_for(engine)() as db:
        seed(db)
    engine.dispose()
    print('Seeded 24 fictional bus models. Northbank lines, missions and recruitment templates are versioned API seed definitions.')
