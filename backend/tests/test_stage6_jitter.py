from app.multiplayer_rules import Movement, validate_pose, accept_pose


def pose(z, sequence):
    return {'p':[0,1,z],'q':[0,0,0,1],'speed':9,'seq':sequence}


def test_bounded_receipt_jitter_does_not_reject_a_plausible_rendered_step():
    previous=Movement(position=[0,1,0],speed=9,sequence=0,received=1)
    assert validate_pose(previous,pose(-1.8,1),1.03) is None
    assert validate_pose(previous,pose(-8,1),1.03)=='teleport_limit'


def test_repeated_jitter_allowance_cannot_bypass_sustained_speed_check():
    previous=Movement(position=[0,1,0],speed=9,sequence=0,received=1)
    previous.samples.append((1,[0,1,0]))
    rejected=None
    for i in range(1,20):
        data=pose(-3*i,i);received=1+.07*i
        rejected=validate_pose(previous,data,received)
        if rejected:break
        accept_pose(previous,data,received)
    assert rejected=='speed_position_mismatch'
