"""Fictional design/catalog data; not manufacturer-certified specifications.
All 24 models have explicit procedural driving profiles. Not certified vehicle data.
"""
from copy import deepcopy

BASE_PHYSICS = {
    'mass_kg': 12000, 'length_m': 12, 'width_m': 2.5, 'wheelbase_m': 6,
    'wheel_radius_m': .5, 'idle_rpm': 650, 'redline_rpm': 2400,
    'final_drive': 5.4, 'efficiency': .88, 'gear_ratios': [3.6, 2.1, 1.42, 1, .74, .61],
    'reverse_ratio': 4.1,
    'torque_curve': [[0, 0], [400, 360], [650, 650], [1000, 1150], [1400, 1200], [1800, 1080], [2200, 760], [2400, 0]],
}

# id, name, category, kW, capacity, tank L, comfort /100, euro price, minimum level
ROWS = [
    ('cb-120', 'CB 120', 'city', 204, 36, 260, 70, 180000, 1),
    ('sprout-60', 'Sprout 60', 'mini', 90, 16, 85, 52, 38000, 1),
    ('swift-75', 'Swift 75', 'mini', 110, 20, 100, 58, 47000, 1),
    ('loop-80', 'Loop 80', 'mini', 125, 24, 115, 62, 59000, 2),
    ('village-85', 'Village 85', 'mini', 135, 28, 130, 68, 72000, 2),
    ('civic-105', 'Civic 105', 'city', 185, 32, 220, 68, 145000, 2),
    ('avenue-125', 'Avenue 125', 'city', 225, 44, 280, 76, 210000, 3),
    ('metro-130', 'Metro 130', 'city', 245, 52, 300, 78, 235000, 3),
    ('link-180', 'Link 180', 'articulated', 260, 80, 360, 70, 285000, 4),
    ('flex-185', 'Flex 185', 'articulated', 280, 88, 380, 76, 315000, 4),
    ('union-190', 'Union 190', 'articulated', 300, 96, 400, 80, 345000, 5),
    ('ribbon-210', 'Ribbon 210', 'articulated', 330, 110, 450, 82, 395000, 6),
    ('vista-120', 'Vista 120', 'coach', 250, 45, 400, 82, 230000, 3),
    ('horizon-130', 'Horizon 130', 'coach', 280, 49, 450, 88, 285000, 4),
    ('voyager-135', 'Voyager 135', 'coach', 310, 53, 500, 92, 335000, 5),
    ('continental-140', 'Continental 140', 'coach', 340, 57, 540, 96, 390000, 6),
    ('skyline-110', 'Skyline 110', 'double-decker', 225, 65, 300, 72, 260000, 4),
    ('summit-120', 'Summit 120', 'double-decker', 260, 76, 340, 78, 300000, 4),
    ('panorama-125', 'Panorama 125', 'double-decker', 280, 84, 370, 85, 345000, 5),
    ('crown-130', 'Crown 130', 'double-decker', 310, 92, 400, 90, 395000, 6),
    ('leaf-e80', 'Leaf E80', 'electric', 150, 24, 0, 76, 180000, 3),
    ('pulse-e120', 'Pulse E120', 'electric', 240, 44, 0, 85, 340000, 4),
    ('current-e130', 'Current E130', 'electric', 280, 54, 0, 89, 390000, 5),
    ('aurora-e180', 'Aurora E180', 'electric', 360, 84, 0, 92, 495000, 6),
]


def catalog_data():
    from .fleet_specs import BY_ID
    result = []
    for id_, name, category, power, capacity, tank, comfort, price, level in ROWS:
        compatible = id_ in BY_ID
        stats = {'power_kw': power, 'capacity': capacity, 'fuel_tank_l': tank, 'comfort': comfort,
                 'energy': 'electric' if category == 'electric' else 'diesel',
                 'battery_kwh': (200 + capacity * 4) if category == 'electric' else None,
                 'physics_profile': deepcopy(BASE_PHYSICS) if id_ == 'cb-120' else deepcopy(BY_ID[id_]) if compatible else None,
                 'physics_status': 'cb120-raycast-v1' if id_ == 'cb-120' else 'fleet-raycast-v2' if compatible else 'requires-dedicated-geometry-and-drivetrain'}
        result.append({'id': id_, 'name': name, 'category': category, 'stats': stats,
                       'price': price * 100, 'required_level': level, 'drive_ready': compatible})
    return result


LINES = [
    {'id': '21', 'name': 'Library Local', 'stops': ['terminal', 'market', 'library'], 'due': [0, 55, 115], 'min_seconds': 30, 'min_meters': 260},
    {'id': '36', 'name': 'Civic Circle', 'stops': ['terminal', 'market', 'library', 'park', 'civic', 'oldtown'], 'due': [0, 55, 115, 180, 250, 335], 'min_seconds': 80, 'min_meters': 750},
    {'id': '80', 'name': 'River Express', 'stops': ['hospital', 'university', 'river', 'terminal'], 'due': [0, 90, 215, 365], 'min_seconds': 70, 'min_meters': 600},
]
from .world_data import NEW_LINES
LINES += NEW_LINES
DRIVER_TEMPLATES = [
    {'id': 'maya', 'name': 'Maya Chen', 'skills': {'safety': 68, 'economy': 72, 'service': 80}, 'salary_daily': 18000, 'hire_cost': 35000},
    {'id': 'elias', 'name': 'Elias Novak', 'skills': {'safety': 82, 'economy': 65, 'service': 70}, 'salary_daily': 19500, 'hire_cost': 40000},
    {'id': 'amina', 'name': 'Amina Silva', 'skills': {'safety': 78, 'economy': 85, 'service': 75}, 'salary_daily': 21500, 'hire_cost': 45000},
    {'id': 'nora', 'name': 'Nora Patel', 'skills': {'safety': 90, 'economy': 80, 'service': 88}, 'salary_daily': 25000, 'hire_cost': 60000},
]
TERMINALS = [
    {'id': 'southbank', 'name': 'Southbank Terminal', 'capacity': 5, 'price': 0},
    {'id': 'riverside', 'name': 'Riverside Depot', 'capacity': 10, 'price': 1500000},
    {'id': 'university', 'name': 'University Exchange', 'capacity': 8, 'price': 1200000},
]
MISSIONS = [
    {'id': 'first-service', 'name': 'First service', 'target': 1, 'metric': 'routes', 'reward_xp': 100, 'reward_money': 25000},
    {'id': 'ten-stops', 'name': 'A familiar face', 'target': 10, 'metric': 'stops', 'reward_xp': 200, 'reward_money': 50000},
    {'id': 'all-lines', 'name': 'Know your city', 'target': 3, 'metric': 'lines', 'reward_xp': 300, 'reward_money': 75000},
]
