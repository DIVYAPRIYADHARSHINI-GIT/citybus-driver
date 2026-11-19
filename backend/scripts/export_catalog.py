"""Regenerate the frontend's offline fallback from the authoritative API catalog."""
import json
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.catalog import catalog_data
from app.fleet_specs import SPECS, RULES
from app.world_data import MAPS, WEATHER

if __name__ == '__main__':
    destination = Path(__file__).resolve().parents[2] / 'frontend/src/online/catalog.json'
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(catalog_data(), indent=2) + '\n')
    print(f'Generated {destination}')
    directory = destination.parents[1] / 'tycoon'
    directory.mkdir(parents=True, exist_ok=True)
    (directory / 'specs.json').write_text(json.dumps(SPECS, indent=2) + '\n')
    (directory / 'rules.json').write_text(json.dumps(RULES, indent=2) + '\n')
    (destination.parents[1] / 'city/worlds.json').write_text(json.dumps({'maps': MAPS, 'weather': WEATHER}, indent=2) + '\n')
