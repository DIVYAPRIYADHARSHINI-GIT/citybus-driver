"""Versioned original world definitions, exported verbatim for offline play.
New regions retain Northbank as their connected historic district. Metres, seconds,
km/h and integer euro cents. No geographic or manufacturer claims.
"""
from copy import deepcopy

MAPS = [
    {'id': 'northbank', 'name': 'Northbank City', 'kind': 'city', 'description': 'The original riverside district. Learn the rhythm of the road.', 'bounds': [-310, -455, 620, 760], 'nodes': [], 'roads': [], 'stops': [], 'routes': [], 'landmarks': []},
    {'id': 'meridian', 'name': 'Meridian Metropolis', 'kind': 'city', 'description': 'A connected metropolitan grid, civic avenues and the Northbank historic district.', 'bounds': [-310, -800, 1600, 1110], 'nodes': [], 'roads': [], 'stops': [], 'routes': [], 'landmarks': []},
    {'id': 'coastway', 'name': 'Coastway Intercity', 'kind': 'intercity', 'description': 'Long-distance express roads, sweeping bends, a viaduct, tunnel and rest areas.', 'bounds': [-420, -1720, 1960, 2050], 'nodes': [], 'roads': [], 'stops': [], 'routes': [], 'landmarks': []},
]
metro = MAPS[1]
for col, x in enumerate([480, 720, 960, 1200]):
    for row, z in enumerate([240, 0, -240, -480, -720]):
        ident = f'M{col}{row}'
        metro['nodes'].append({'id': ident, 'x': x, 'z': z, 'signal': True})
        if row:
            metro['roads'].append([f'M{col}{row-1}', ident, False])
        if col:
            metro['roads'].append([f'M{col-1}{row}', ident, False])
metro['roads'] += [['SE', 'M00', False], ['E', 'M01', False], ['NE', 'M02', False]]
metro['stops'] = [
    ['m-depot', 'Meridian Coach Station', 'M00>M01:0', 30],
    ['m-market', 'Grand Market', 'M00>M01:0', 150],
    ['m-opera', 'Opera Avenue', 'M01>M02:0', 100],
    ['m-finance', 'Financial Quarter', 'M02>M03:0', 100],
    ['m-museum', 'Museum District', 'M03>M04:0', 100],
    ['m-gardens', 'Sky Gardens', 'M04>M14:0', 100],
    ['m-arena', 'Metropolitan Arena', 'M14>M24:0', 100],
    ['m-east', 'East Exchange', 'M24>M34:0', 100],
]
metro['routes'] = [
    {'id':'M1','name':'Metropolitan Spine','description':'Station → Market → Opera → Finance → Museum. Dense signalized avenues.','stops':['m-depot','m-market','m-opera','m-finance','m-museum'],'due':[0,60,150,250,350],'color':'#b2d9ef','min_seconds':90,'min_meters':700,'meters':800,'duration_slots':8,'level':2},
    {'id':'M2','name':'Arts & Gardens','description':'Museum → Gardens → Arena → East Exchange. Cross-city service.','stops':['m-museum','m-gardens','m-arena','m-east'],'due':[0,120,220,320],'color':'#e0b4d7','min_seconds':80,'min_meters':600,'meters':740,'duration_slots':7,'level':3},
]
metro['landmarks'] = [{'kind':'plaza','x':600,'z':-120,'name':'MERIDIAN CIVIC PLAZA'}, {'kind':'fuel','x':500,'z':205,'name':'MERIDIAN ENERGY'}, {'kind':'toll','x':1100,'z':-715,'name':'EAST CONGESTION ZONE'}]
coast = MAPS[2]
coast['nodes'] = [{'id':i,'x':x,'z':z,'signal':False} for i,x,z in [('C0',-240,-800),('C1',-240,-1200),('C2',-240,-1600),('C3',900,-1600),('C4',1250,-1450),('C5',1400,-1100),('C6',1400,-400),('C7',1400,240)]]
coast['roads'] = [[a,b,True] for a,b in [('HN','C0'),('C0','C1'),('C1','C2'),('C2','C3'),('C3','C4'),('C4','C5'),('C5','C6'),('C6','C7'),('C7','SE')]]
coast['stops'] = [
    ['c-south','Coastway Gateway','HN>C0:0',40], ['c-rest','Pine Rest Stop','C0>C1:0',100],
    ['c-north','North Coast Station','C1>C2:0',180], ['c-bay','Bay View','C2>C3:0',500],
    ['c-port','Port Interchange','C5>C6:0',260], ['c-east','East Rest Stop','C6>C7:0',320],
]
coast['routes'] = [
    {'id':'H1','name':'North Coast Express','description':'Gateway → Pine Rest → North Coast. Long straight expressway running.','stops':['c-south','c-rest','c-north'],'due':[0,110,240],'color':'#e9c48b','min_seconds':70,'min_meters':700,'meters':940,'duration_slots':6,'level':2},
    {'id':'H2','name':'Coastal Connector','description':'North Coast → Bay View → Port → East Rest. Bends, tunnel and viaduct.','stops':['c-north','c-bay','c-port','c-east'],'due':[0,160,440,600],'color':'#96d4ca','min_seconds':170,'min_meters':2600,'meters':3200,'duration_slots':12,'level':3},
]
coast['landmarks'] = [{'kind':'rest','x':-215,'z':-920,'name':'PINE REST / COFFEE'}, {'kind':'bridge','x':300,'z':-1600,'name':'COASTWAY VIADUCT'}, {'kind':'tunnel','x':680,'z':-1600,'name':'COAST RIDGE TUNNEL'}, {'kind':'toll','x':-235,'z':-1120,'name':'NORTH COAST TOLL'}, {'kind':'fuel','x':-220,'z':-875,'name':'PINE FUEL & CHARGE'}]
WEATHER = [
    {'id':'clear','name':'Clear skies','surface':'dry','fog_density':.0018,'traffic':'normal'},
    {'id':'rain','name':'Rain','surface':'wet','fog_density':.0045,'traffic':'normal'},
    {'id':'fog','name':'Damp fog','surface':'wet','fog_density':.017,'traffic':'normal'},
    {'id':'jam','name':'Rush hour','surface':'dry','fog_density':.0025,'traffic':'high'},
]
BY_MAP = {m['id']: m for m in MAPS}
NEW_LINES = [{**deepcopy(r), 'map_id':m['id']} for m in MAPS for r in m['routes']]
LINE_MAP = {**{i:'northbank' for i in ['21','36','80']}, **{r['id']:r['map_id'] for r in NEW_LINES}}
COURSES = {
    'northbank': {'id':'northbank-sprint-v1','line_id':'21','spawn':[-236.5,1.12,218.0],'checkpoints':[[-236.5,z] for z in [150,70,-20,-120]],'minimum_seconds':20.,'minimum_meters':300},
    'meridian': {'id':'meridian-sprint-v1','line_id':'M1','spawn':[483.5,1.12,214.0],'checkpoints':[[483.5,z] for z in [130,30,-80,-200]],'minimum_seconds':24.,'minimum_meters':380},
    'coastway': {'id':'coastway-sprint-v1','line_id':'H1','spawn':[-234.75,1.12,-436.0],'checkpoints':[[-234.75,z] for z in [-530,-650,-800,-960]],'minimum_seconds':30.,'minimum_meters':480},
}
