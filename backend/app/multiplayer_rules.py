"""Pure movement/race checks. Incoming client timestamps never control elapsed time."""
import math
from dataclasses import dataclass, field
from collections import deque

SPAWN = [-236.5, 1.12, 218.0]
CHECKPOINTS = [[-236.5, 150.0], [-236.5, 70.0], [-236.5, -20.0], [-236.5, -120.0]]
CHECKPOINT_RADIUS = 10.0
RACE_MIN_SECONDS = 20.0


@dataclass
class Movement:
    position: list = field(default_factory=lambda: list(SPAWN))
    rotation: list = field(default_factory=lambda: [0, 0, 0, 1])
    speed: float = 0.0
    sequence: int = -1
    received: float = 0.0
    distance: float = 0.0
    valid_updates: int = 0
    samples: deque = field(default_factory=deque)


def finite_number(value):
    return type(value) in (int, float) and abs(value) <= 10**12 and math.isfinite(value)


def validate_pose(previous: Movement, data: dict, received: float, max_speed=32.0, bounds=(-760, -760, 1520, 1520)):
    p, q, speed, seq = data.get('p'), data.get('q'), data.get('speed'), data.get('seq')
    if not isinstance(p, list) or len(p) != 3 or not isinstance(q, list) or len(q) != 4 or not all(finite_number(v) for v in p + q) or not finite_number(speed) or type(seq) is not int:
        return 'malformed_pose'
    if seq <= previous.sequence or seq > 2**53:
        return 'replayed_sequence'
    x, z, width, height = bounds
    if not x <= p[0] <= x+width or not z <= p[2] <= z+height or not -.5 <= p[1] <= 12:
        return 'world_bounds'
    norm = math.sqrt(sum(v*v for v in q))
    if not .85 <= norm <= 1.15:
        return 'invalid_rotation'
    if abs(speed) > max_speed:
        return 'speed_limit'
    dt = received - previous.received
    if previous.sequence < 0:
        if math.dist(p, previous.position) > 5:
            return 'spawn_teleport'
        if abs(speed) > 1.5:
            return 'initial_speed_limit'
    else:
        if dt < .025:
            return 'too_frequent'  # benign bursts are dropped, not integrity strikes
        elapsed = min(dt, .6)
        horizontal = math.hypot(p[0] - previous.position[0], p[2] - previous.position[2])
        # Receipt intervals can compress when one rendered client is briefly
        # descheduled. Allow at most 100 ms of prior-speed movement, not an
        # unbounded client timestamp. The sustained speed/position check below
        # still rejects a client repeatedly spending this per-packet slack.
        jitter_distance = min(max_speed, abs(previous.speed)) * .1
        if horizontal > max_speed * elapsed + .35 + jitter_distance or abs(p[1]-previous.position[1]) > 5*elapsed + .5:
            return 'teleport_limit'
        acceleration_limit = 12 if abs(speed) >= abs(previous.speed) else 100
        if abs(speed-previous.speed) > acceleration_limit*elapsed + 1.2:
            return 'acceleration_limit'
        dot = min(1, abs(sum(a*b for a,b in zip(previous.rotation, q))/norm))
        if 2*math.acos(dot) > 3*elapsed + .4:
            return 'rotation_limit'
        samples = [s for s in previous.samples if received-s[0] <= 1.3]
        if samples and received-samples[0][0] >= .65:
            t, old = samples[0]
            inferred = math.hypot(p[0]-old[0], p[2]-old[2])/(received-t)
            if inferred > abs(speed) + 3:
                return 'speed_position_mismatch'
    flags = data.get('keys', {})
    if not isinstance(flags, dict) or len(flags) > 10:
        return 'invalid_keys'
    for key, value in flags.items():
        if key not in ('throttle','brake','left','right','hazards','doors','lights','horn','steer') or not finite_number(value) or not -1 <= value <= 1:
            return 'invalid_keys'
    articulation = data.get('articulation', 0)
    if not finite_number(articulation) or abs(articulation) > 1.6:
        return 'invalid_articulation'
    return None


def accept_pose(previous: Movement, data: dict, received: float):
    old = list(previous.position)
    previous.distance += math.hypot(data['p'][0]-old[0], data['p'][2]-old[2])
    previous.position = list(data['p'])
    norm = math.sqrt(sum(v*v for v in data['q']))
    previous.rotation = [v/norm for v in data['q']]
    previous.speed = data['speed']
    previous.sequence = data['seq']
    previous.received = received
    previous.valid_updates += 1
    previous.samples.append((received, list(data['p'])))
    while previous.samples and received-previous.samples[0][0] > 1.3:
        previous.samples.popleft()
    return old


def checkpoint_crossed(old, new, index, checkpoints=CHECKPOINTS):
    if index >= len(checkpoints):
        return False
    x, z = checkpoints[index]
    dx, dz = new[0]-old[0], new[2]-old[2]
    length2 = dx*dx+dz*dz
    t = max(0, min(1, ((x-old[0])*dx+(z-old[2])*dz)/(length2 or 1)))
    return math.hypot(old[0]+dx*t-x, old[2]+dz*t-z) <= CHECKPOINT_RADIUS and dz <= .1
