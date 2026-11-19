from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.orm import Session
from .common import lock_player, command_cached, remember, digest
from .database import get_db
from .errors import ApiError
from .models import Player, CloudHead, CloudRevision, Conflict
from .schemas import SaveRequest, ResolveRequest
from .security import current_player

router = APIRouter(tags=['Cloud saves'])


def head_for(db, player):
    head = db.get(CloudHead, player.id)
    if head is None:
        head = CloudHead(user_id=player.id, version=0)
        db.add(head)
        db.flush()
    return head


def head_view(db, head):
    revision = db.get(CloudRevision, head.revision_id) if head.revision_id else None
    return {'version': head.version, 'revision_id': head.revision_id, 'document': revision.document if revision else None,
            'updated_at': revision.created_at if revision else None}


def conflict_view(db, conflict):
    local = db.get(CloudRevision, conflict.local_revision)
    server = db.get(CloudRevision, conflict.server_revision)
    return {'id': conflict.id, 'server_version': conflict.server_version, 'resolved': conflict.resolved,
            'choice': conflict.choice, 'created_at': conflict.created_at,
            'local': {'revision_id': local.id, 'document': local.document, 'created_at': local.created_at},
            'server': {'revision_id': server.id, 'document': server.document, 'created_at': server.created_at}}


def create_conflict(db, player, head, local):
    conflict = Conflict(user_id=player.id, local_revision=local.id, server_revision=head.revision_id, server_version=head.version)
    db.add(conflict)
    db.flush()
    return conflict


def accept(db, head, revision):
    head.version += 1
    revision.version = head.version
    head.revision_id = revision.id
    db.flush()
    return head_view(db, head)


@router.get('/saves')
def get_save(player: Player = Depends(current_player), db: Session = Depends(get_db)):
    head = db.get(CloudHead, player.id)
    return head_view(db, head) if head else {'version': 0, 'revision_id': None, 'document': None, 'updated_at': None}


@router.put('/saves')
def put_save(data: SaveRequest, player: Player = Depends(current_player), db: Session = Depends(get_db)):
    player = lock_player(db, player)
    payload = data.model_dump(mode='json', exclude_none=True)
    cached = command_cached(db, player, data.operation_id, 'save', payload)
    if cached:
        return JSONResponse(cached.response, status_code=cached.status)
    head = head_for(db, player)
    document = payload['document']
    if head.revision_id and digest(db.get(CloudRevision, head.revision_id).document) == digest(document):
        result = head_view(db, head)
        remember(db, player, data.operation_id, 'save', payload, result)
        db.commit()
        return result
    revision = CloudRevision(user_id=player.id, client_id=str(data.client_id), base_version=data.base_version, document=document)
    db.add(revision)
    db.flush()
    if data.base_version != head.version:
        if not head.revision_id:
            raise ApiError(409, 'invalid_base_version', 'The cloud is empty; start from version 0.')
        conflict = create_conflict(db, player, head, revision)
        result = ApiError(409, 'sync_conflict', 'Both versions were preserved. Choose which one to use.', {'conflict': conflict_view(db, conflict)}).body()
        remember(db, player, data.operation_id, 'save', payload, result, 409)
        db.commit()
        return JSONResponse(result, status_code=409)
    result = accept(db, head, revision)
    remember(db, player, data.operation_id, 'save', payload, result)
    db.commit()
    return result


@router.get('/saves/conflicts')
def conflicts(player: Player = Depends(current_player), db: Session = Depends(get_db)):
    rows = db.scalars(select(Conflict).where(Conflict.user_id == player.id, Conflict.resolved.is_(False)).order_by(Conflict.created_at.desc()).limit(50))
    return {'items': [conflict_view(db, row) for row in rows]}


@router.post('/saves/conflicts/{conflict_id}/resolve')
def resolve(conflict_id: str, data: ResolveRequest, player: Player = Depends(current_player), db: Session = Depends(get_db)):
    player = lock_player(db, player)
    payload = {**data.model_dump(mode='json'), 'conflict_id': conflict_id}
    cached = command_cached(db, player, data.operation_id, 'resolve', payload)
    if cached:
        return JSONResponse(cached.response, status_code=cached.status)
    conflict = db.get(Conflict, conflict_id)
    if not conflict or conflict.user_id != player.id:
        raise ApiError(404, 'not_found', 'Save conflict not found.')
    if conflict.resolved:
        raise ApiError(409, 'already_resolved', 'This conflict has already been resolved. Refresh cloud status.')
    head = head_for(db, player)
    if head.version != data.expected_version or head.version != conflict.server_version:
        # A third device saved while the choice dialog was open. Never overwrite
        # that revision with a stale resolution; preserve it in a new conflict.
        updated = create_conflict(db, player, head, db.get(CloudRevision, conflict.local_revision))
        conflict.resolved = True
        conflict.choice = 'superseded'
        result = ApiError(409, 'sync_conflict', 'The cloud changed again. Review the newest versions.', {'conflict': conflict_view(db, updated)}).body()
        remember(db, player, data.operation_id, 'resolve', payload, result, 409)
        db.commit()
        return JSONResponse(result, status_code=409)
    selected = db.get(CloudRevision, conflict.local_revision if data.choice == 'local' else conflict.server_revision)
    revision = CloudRevision(user_id=player.id, client_id=selected.client_id, base_version=head.version, document=selected.document)
    db.add(revision)
    db.flush()
    result = accept(db, head, revision)
    conflict.resolved = True
    conflict.choice = data.choice
    conflict.resolved_revision = revision.id
    remember(db, player, data.operation_id, 'resolve', payload, result)
    db.commit()
    return result


@router.get('/saves/history')
def history(player: Player = Depends(current_player), db: Session = Depends(get_db)):
    return {'items': [{'id': r.id, 'version': r.version, 'base_version': r.base_version, 'created_at': r.created_at,
                       'document': r.document} for r in db.scalars(select(CloudRevision).where(CloudRevision.user_id == player.id).order_by(CloudRevision.created_at.desc(), CloudRevision.id).limit(50))]}
