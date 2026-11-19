from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session
from .database import get_db
from .models import WorldDefinition
from .errors import ApiError

router = APIRouter(tags=['World catalog'])

@router.get('/maps')
def maps(db: Session = Depends(get_db)):
    return {'items': [{'revision': r.revision, **r.document} for r in db.scalars(select(WorldDefinition).where(WorldDefinition.id != 'weather').order_by(WorldDefinition.id))]}

@router.get('/maps/{map_id}')
def map_detail(map_id: str, db: Session = Depends(get_db)):
    row = db.get(WorldDefinition, map_id)
    if not row or map_id == 'weather':
        raise ApiError(404, 'map_not_found', 'Unknown map.')
    return {'revision': row.revision, **row.document}

@router.get('/maps/{map_id}/routes')
def routes(map_id: str, db: Session = Depends(get_db)):
    map_detail(map_id, db)
    from .catalog import LINES
    from .world_data import LINE_MAP
    return {'items': [r for r in LINES if LINE_MAP[r['id']] == map_id]}

@router.get('/weather')
def weather(db: Session = Depends(get_db)):
    row = db.get(WorldDefinition, 'weather')
    if not row:
        raise ApiError(503, 'not_seeded', 'Seed the world catalog first.')
    return {'revision': row.revision, **row.document}
