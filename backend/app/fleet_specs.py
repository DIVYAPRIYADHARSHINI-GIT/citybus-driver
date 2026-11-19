"""Original game calibration, not manufacturer specifications. Units are explicit.
CB120 baseline values intentionally preserve the approved Stage 1 model.
"""
from copy import deepcopy
from .catalog import BASE_PHYSICS


def _spec(id_, name, category, mass, length, width, height, power, tank, capacity, brakes, radius=.5, idle=650, redline=2400, battery=0, cg=.58, suspension=32, final_drive=5.4):
    scale = power / 204
    return {
        'id': id_, 'name': name, 'category': category, 'mass_kg': mass, 'length_m': length,
        'width_m': width, 'height_m': height, 'power_kw': power, 'tank_l': tank,
        'capacity': capacity, 'brake_force_n': brakes, 'wheel_radius_m': radius,
        'wheelbase_m': round((10.8 if category == 'articulated' else length) * .5, 3),
        'front_length_m': 10.8 if category == 'articulated' else length,
        'idle_rpm': idle, 'redline_rpm': redline, 'final_drive': final_drive,
        'gear_ratios': [3.6, 2.1, 1.42, 1, .74, .61], 'reverse_ratio': 4.1,
        'torque_curve': [[round(rpm * redline / 2400), round(torque * scale * 2400 / redline)] for rpm, torque in BASE_PHYSICS['torque_curve']],
        'battery_kwh': battery, 'energy': 'electric' if battery else 'diesel',
        'suspension': suspension, 'cg_offset_m': cg, 'drag_area_m2': round(width * height * .85, 3),
        'consumption_per_km': 1250 if battery else round(320 * power / 204),
        'consumption_unit': 'Wh/km' if battery else 'ml/km',
        'motor_torque_nm': 650 if battery else 0, 'motor_ratio': 10 if battery else 0,
        'regen_force_n': 14000 if battery else 0, 'max_speed_mps': 25 if category in ('mini', 'double-decker') else 27,
        'front_mass_kg': 11000 if category == 'articulated' else mass,
        'rear_mass_kg': 7000 if category == 'articulated' else 0,
        'rear_length_m': 7.2 if category == 'articulated' else 0,
        'max_articulation_rad': .75 if category == 'articulated' else 0,
    }

SPECS = [
    _spec('cb-120', 'CB 120', 'city', 12000, 12, 2.5, 3.3, 204, 260, 36, 78000),
    _spec('sprout-60', 'Sprout 60', 'mini', 5800, 6.5, 2.2, 2.9, 90, 85, 16, 38000, radius=.4, idle=750, redline=3000, cg=.38, suspension=36, final_drive=4.8),
    _spec('civic-105', 'Civic 105', 'city', 10200, 10.5, 2.5, 3.2, 185, 220, 32, 71000, cg=.52, suspension=34),
    _spec('link-180', 'Link 180', 'articulated', 18000, 18, 2.5, 3.3, 260, 360, 80, 114000, cg=.6, suspension=34),
    _spec('vista-120', 'Vista 120', 'coach', 13800, 12, 2.55, 3.65, 250, 400, 45, 90000, cg=.83, suspension=28, final_drive=4.4),
    _spec('skyline-110', 'Skyline 110', 'double-decker', 15000, 11, 2.55, 4.3, 225, 300, 65, 96000, cg=1.1, suspension=30),
    _spec('leaf-e80', 'Leaf E80', 'electric', 9500, 8, 2.4, 3.2, 150, 0, 24, 69000, radius=.46, idle=0, redline=11000, battery=296, cg=.38, suspension=38),
]
# Explicit additional game profiles; never inferred from the marketing name.
SPECS += [
    _spec('swift-75', 'Swift 75', 'mini', 6600, 7.5, 2.3, 3.0, 110, 100, 20, 44000, radius=.42, idle=740, redline=2900, cg=.40, suspension=35, final_drive=4.9),
    _spec('loop-80', 'Loop 80', 'mini', 7200, 8.0, 2.35, 3.05, 125, 115, 24, 48000, radius=.44, idle=720, redline=2800, cg=.43, suspension=34, final_drive=5.0),
    _spec('village-85', 'Village 85', 'mini', 7900, 8.5, 2.4, 3.1, 135, 130, 28, 53000, radius=.45, idle=700, redline=2700, cg=.46, suspension=33, final_drive=4.7),
    _spec('avenue-125', 'Avenue 125', 'city', 12600, 12.5, 2.5, 3.3, 225, 280, 44, 83000, cg=.60, suspension=33, final_drive=5.3),
    _spec('metro-130', 'Metro 130', 'city', 13300, 13, 2.55, 3.4, 245, 300, 52, 88000, cg=.62, suspension=34, final_drive=5.2),
    _spec('flex-185', 'Flex 185', 'articulated', 18800, 18.5, 2.5, 3.35, 280, 380, 88, 119000, cg=.62, suspension=35, final_drive=5.3),
    _spec('union-190', 'Union 190', 'articulated', 19800, 19, 2.55, 3.4, 300, 400, 96, 126000, cg=.64, suspension=36, final_drive=5.2),
    _spec('ribbon-210', 'Ribbon 210', 'articulated', 22000, 21, 2.55, 3.45, 330, 450, 110, 140000, cg=.65, suspension=37, final_drive=5.1),
    _spec('horizon-130', 'Horizon 130', 'coach', 14700, 13, 2.55, 3.7, 280, 450, 49, 96000, cg=.85, suspension=29, final_drive=4.3),
    _spec('voyager-135', 'Voyager 135', 'coach', 15500, 13.5, 2.55, 3.75, 310, 500, 53, 101000, cg=.87, suspension=30, final_drive=4.2),
    _spec('continental-140', 'Continental 140', 'coach', 16300, 14, 2.55, 3.8, 340, 540, 57, 107000, cg=.89, suspension=31, final_drive=4.1),
    _spec('summit-120', 'Summit 120', 'double-decker', 16400, 12, 2.55, 4.35, 260, 340, 76, 106000, cg=1.12, suspension=31, final_drive=5.3),
    _spec('panorama-125', 'Panorama 125', 'double-decker', 17200, 12.5, 2.55, 4.4, 280, 370, 84, 112000, cg=1.14, suspension=32, final_drive=5.2),
    _spec('crown-130', 'Crown 130', 'double-decker', 18400, 13, 2.55, 4.45, 310, 400, 92, 120000, cg=1.16, suspension=33, final_drive=5.1),
    _spec('pulse-e120', 'Pulse E120', 'electric', 14200, 12, 2.5, 3.3, 240, 0, 44, 94000, idle=0, redline=12000, battery=376, cg=.42, suspension=39),
    _spec('current-e130', 'Current E130', 'electric', 15600, 13, 2.55, 3.35, 280, 0, 54, 104000, idle=0, redline=12500, battery=416, cg=.44, suspension=40),
    _spec('aurora-e180', 'Aurora E180', 'electric', 21400, 18, 2.55, 3.4, 360, 0, 84, 138000, idle=0, redline=13000, battery=536, cg=.48, suspension=40),
]
for s in SPECS:
    articulated = s['category'] == 'articulated' or s['id'] == 'aurora-e180'
    if articulated and s['id'] != 'link-180':
        s['front_length_m'] = round(s['length_m'] * .6, 2)
        s['rear_length_m'] = round(s['length_m'] * .4, 2)
        s['front_mass_kg'] = round(s['mass_kg'] * .61)
        s['rear_mass_kg'] = s['mass_kg'] - s['front_mass_kg']
        s['wheelbase_m'] = s['front_length_m'] * .5
        s['max_articulation_rad'] = .72
    s['steer_angle_rad'] = .5 if s['id'] == 'cb-120' else (.55 if s['category'] == 'mini' else .46 if s['category'] == 'coach' else .48)
    s['turning_radius_m'] = round(s['wheelbase_m'] / __import__('math').tan(s['steer_angle_rad']), 2)
    s['cockpit_trim'] = {'mini': '#877257', 'city': '#426d67', 'articulated': '#655879', 'coach': '#68564c', 'double-decker': '#536680', 'electric': '#326f79'}[s['category']]
    if s['energy'] == 'electric' and s['id'] != 'leaf-e80':
        s['motor_torque_nm'] = round(s['power_kw'] * 4.3)
        s['motor_ratio'] = 9.4
        s['regen_force_n'] = round(s['mass_kg'] * 1.4)
        s['consumption_per_km'] = round(s['mass_kg'] * .115)
SPECS[0]['torque_curve'] = deepcopy(BASE_PHYSICS['torque_curve'])
SPECS[0]['drag_area_m2'] = 7.4
BY_ID = {s['id']: s for s in SPECS}

RULES = {
    'version': 1, 'tick_seconds': 60, 'catchup_slots': 1440, 'slots_per_day': 1440,
    'fuel_cents_per_litre': 180, 'energy_cents_per_kwh': 28,
    'training_cost': 15000, 'hire_cost': 35000, 'loan_daily_bps': 12,
    'loan_limit': 2000000, 'loan_min': 100000, 'reputation_start': 70,
    'upgrades': {'engine': 18000, 'brakes': 12000, 'suspension': 15000, 'tires': 9000, 'seats': 11000, 'paint': 3000, 'interior': 6000},
    'wear_repair_cents_per_bp': {'engine': 12, 'brakes': 7, 'tires': 5, 'energy': 14},
    'routes': {
        '21': {'id': '21', 'name': 'Library Local', 'meters': 340, 'duration_slots': 3, 'stops': 3, 'level': 1},
        '36': {'id': '36', 'name': 'Civic Circle', 'meters': 1600, 'duration_slots': 7, 'stops': 6, 'level': 2},
        '80': {'id': '80', 'name': 'River Express', 'meters': 1850, 'duration_slots': 8, 'stops': 4, 'level': 3},
    },
    'event_kinds': ['fuel-spike', 'strike', 'festival', 'weather', 'quit', 'recall'],
}
from .world_data import NEW_LINES
for line in NEW_LINES:
    RULES['routes'][line['id']] = {key: line[key] for key in ('id', 'name', 'meters', 'duration_slots', 'level', 'map_id')}
    RULES['routes'][line['id']]['stops'] = len(line['stops'])
for route in RULES['routes'].values():
    route['toll_cents'] = 250 if route['id'] in ('M2', 'H1', 'H2') else 0
