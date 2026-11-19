from sqlalchemy import select, text, func
from .models import Player, MultiplayerReward, RoomParticipation, Ledger, BoardEntry, Result, SocialPreference, now
from .leaderboards import week_key


def transaction(db):
    if db.bind.dialect.name == 'sqlite':
        db.execute(text('BEGIN IMMEDIATE'))


def award_race(sessions, room_id, user_id, milliseconds, position, checkpoint_count, suspicious=False, map_id='northbank', bus_class='city'):
    with sessions() as db:
        transaction(db)
        player = db.scalar(select(Player).where(Player.id == user_id).with_for_update())
        existing = db.scalar(select(MultiplayerReward).where(MultiplayerReward.room_id == room_id, MultiplayerReward.user_id == user_id, MultiplayerReward.kind == 'race'))
        if existing:
            return {'xp': existing.xp, 'money': existing.money, 'credited': True, 'duplicate': True}
        prefs = db.get(SocialPreference, user_id)
        if suspicious or (prefs and prefs.review_flag) or checkpoint_count != 4:
            return {'xp': 0, 'money': 0, 'credited': False, 'reason': 'integrity_review'}
        today = db.scalars(select(MultiplayerReward).where(MultiplayerReward.user_id == user_id, MultiplayerReward.created_at > now()-86400)).all()
        if len(today) >= 30:
            return {'xp': 0, 'money': 0, 'credited': False, 'reason': 'daily_reward_cap'}
        xp, money = (100, 5000) if position == 1 else (60, 2500)
        result = {'time_ms': milliseconds, 'position': position, 'checkpoints': checkpoint_count, 'map_id': map_id, 'bus_class': bus_class}
        reward = MultiplayerReward(room_id=room_id, user_id=user_id, kind='race', xp=xp, money=money, result=result)
        db.add(reward)
        db.flush()
        player.xp += xp
        player.money += money
        player.achievements = sorted(set(player.achievements) | {'first-race'} | ({'race-winner'} if position == 1 else set()))
        db.add(Ledger(user_id=user_id, kind='race_reward', amount=money, reference=reward.id))
        from .world_data import COURSES
        db.add(BoardEntry(user_id=user_id, source_type='race', source_id=reward.id, line_id=COURSES[map_id]['line_id'], map_id=map_id, bus_class=bus_class, week=week_key(), time_ms=milliseconds, score=max(0, 10000-milliseconds//100), profit=0))
        db.commit()
        return {'xp': xp, 'money': money, 'credited': True, 'duplicate': False}


def award_session_for_result(db, player, result):
    route = result.payload['route']
    if route['served'] <= 0 or route['missed']:
        return
    prefs = db.get(SocialPreference, player.id)
    if prefs and prefs.review_flag:
        return
    if db.scalar(select(func.count()).select_from(MultiplayerReward).where(MultiplayerReward.user_id == player.id, MultiplayerReward.created_at > now()-86400)) >= 30:
        return
    from datetime import datetime
    finished = int(datetime.fromisoformat(result.payload['finished_at']).timestamp())
    rows = db.scalars(select(RoomParticipation).where(RoomParticipation.user_id == player.id, RoomParticipation.mode == 'city', RoomParticipation.joined_at <= finished-30, RoomParticipation.distance_m >= 200, RoomParticipation.valid_updates >= 30, RoomParticipation.review_flag.is_(False)).order_by(RoomParticipation.joined_at.desc()).limit(20)).all()
    for participation in rows:
        from .world_data import LINE_MAP
        if participation.map_id != LINE_MAP[result.route_id]:
            continue
        if finished-participation.joined_at > 7200:
            continue
        if participation.left_at and participation.left_at < finished-10:
            continue
        old = db.scalar(select(MultiplayerReward.id).where(MultiplayerReward.room_id == participation.room_id, MultiplayerReward.user_id == player.id, MultiplayerReward.kind == 'session'))
        if old:
            continue
        # A result belongs to at most one shared session; receipt/source UUIDs
        # remain the same idempotent route pipeline rather than a client claim.
        reward = MultiplayerReward(room_id=participation.room_id, user_id=player.id, kind='session', xp=25, money=1000, result={'run_id': result.run_id})
        db.add(reward)
        db.flush()
        player.xp += 25
        player.money += 1000
        result.xp_awarded += 25
        result.money_awarded += 1000
        player.achievements = sorted(set(player.achievements) | {'shared-city-service'})
        db.add(Ledger(user_id=player.id, kind='session_reward', amount=1000, reference=reward.id))
        break
