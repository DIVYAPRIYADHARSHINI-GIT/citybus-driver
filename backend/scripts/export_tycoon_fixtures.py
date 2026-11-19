"""Generate cross-language deterministic settlement fixtures from Python."""
import json
import sys
from pathlib import Path
from copy import deepcopy
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from app.tycoon_engine import advance
from tests.test_tycoon import fixture_state
rows=[]
for target in [1000,1004,1020,1440,2200,10000]:
    source=fixture_state()
    source['loans']=[{'id':'loan-a','balance':500000,'principal':500000,'interest_day':0}]
    if target>=1440:
        source['assignments'][0]['departures']=list(range(0,1440,30))
    rows.append({'source':source,'target':target,'expected':advance(source,target)})
for reputation,wear in [(10,0),(95,0),(70,9000)]:
    source=fixture_state();source['reputation']=reputation
    source['fleet'][0]['wear']={k:wear for k in source['fleet'][0]['wear']}
    rows.append({'source':source,'target':1020,'expected':advance(source,1020)})
path=Path(__file__).resolve().parents[2]/'frontend/tests/fixtures/tycoon-golden.json'
path.parent.mkdir(parents=True,exist_ok=True)
path.write_text(json.dumps(rows,indent=2)+'\n')
print('Exported',len(rows),'settlement fixtures')
