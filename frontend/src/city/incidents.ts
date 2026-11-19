import {distance,facilities,random,type Point} from './network';
import type {RouteService} from './service';
export interface RoadsideBus extends Point {speed:number;parking:boolean;running:boolean;hazards:boolean;fuel:number}
export class Incidents {
  sharedMode=false;
  time=0;damage=0;dirt=8;jam=true;jamLane='RE>E:0';detour=false;policeCleared=false;policeRequested=false;broken=false;triangle=false;pump=false;fuelAdded=0;tollPaid=false;tollPasses=0;notice='Dispatch: roadworks east of Civic Square. GPS can avoid the closed lane.';private nextEvent:number;private rand:()=>number;private lastImpacts=0;
  constructor(seed=519,public tankCapacity=260){this.rand=random(seed);this.nextEvent=100+this.rand()*60;}
  private fuelBilled=0;
  nearby(bus:Point){return facilities.filter(f=>distance(f,bus)<(f.id==='toll'?28:25));}
  tick(dt:number,bus:RoadsideBus,impacts:number,service:RouteService){this.time+=dt;this.dirt=Math.min(100,this.dirt+dt*.018);if(impacts>this.lastImpacts){this.damage=Math.min(100,this.damage+(impacts-this.lastImpacts)*18);this.lastImpacts=impacts;}
    if(this.damage>=65&&!this.broken){this.broken=true;this.notice='Breakdown: stop, parking brake, engine off, hazards and warning triangle. Request roadside repair.';}
    if(!this.sharedMode&&this.time>this.nextEvent){this.nextEvent=this.time+110+this.rand()*70;const roll=this.rand();if(roll<.4&&!this.policeCleared){this.policeRequested=true;this.notice='Police request: pull over safely and show your documents.';}else if(roll<.7){this.jam=!this.jam;this.notice=this.jam?'Traffic jam east of Civic Square. Choose a detour in GPS.':'Roadworks cleared. Normal routing restored.';}else if(!this.broken){this.broken=true;this.notice='Air-system warning: pull over, switch off and deploy a warning triangle before repair.';}}
    if(this.nearby(bus).some(f=>f.id==='police')&&!this.policeCleared)this.policeRequested=true;
    if(this.pump){if(!this.nearby(bus).some(f=>f.id==='fuel')||Math.abs(bus.speed)>.1||!bus.parking||bus.running){this.pump=false;this.notice='Pump disconnected: unsafe fueling conditions.';}else{const liters=Math.max(0,Math.min(dt*1.2,this.tankCapacity-bus.fuel));this.fuelAdded+=liters;const billed=Math.round(this.fuelAdded*180);service.score.expenses+=billed-this.fuelBilled;this.fuelBilled=billed;}}
    if(this.tollPaid&&facilities.filter(f=>f.id==='toll').every(f=>distance(bus,f)>60))this.tollPaid=false;
  }
  action(action:string,bus:RoadsideBus,service:RouteService){const stopped=Math.abs(bus.speed)<.2&&bus.parking,near=this.nearby(bus);
    if(action==='detour'){this.detour=!this.detour;return this.detour?'GPS avoiding the roadworks. Follow the alternate route.':'GPS using the normal route. Expect a queue at roadworks.';}
    if(!stopped)return 'Stop safely and apply the parking brake first.';
    if(action==='pump'){if(!near.some(f=>f.id==='fuel'))return 'Drive to the fuel pump first.';if(bus.running)return 'Switch off the engine before attaching the fuel hose.';this.pump=!this.pump;return this.pump?'Hose connected. Fuel flows while the roadside panel is closed. €1.80/L.':'Hose disconnected.';}
    if(action==='repair'||action==='wash'){if(!near.some(f=>f.id==='garage'))return 'Drive to Depot Repair & Wash first.';if(bus.running)return 'Switch off the engine before garage service.';if(action==='repair'){if(this.damage===0)return 'No damage needs repair.';service.score.expenses+=Math.round(this.damage*45);this.damage=0;return 'Damage repaired.';}if(this.dirt===0)return 'The bus is already clean.';service.score.expenses+=800;this.dirt=0;return 'Bus washed. €8 charged to this shift.';}
    if(action==='toll'){if(!near.some(f=>f.id==='toll'))return 'Approach the toll booth first.';if(this.tollPaid)return 'This crossing is already paid.';this.tollPaid=true;this.tollPasses++;service.score.expenses+=250;return '€2.50 toll paid. Barrier raised.';}
    if(action==='documents'){if(!this.policeRequested)return 'No document check is pending.';this.policeRequested=false;this.policeCleared=true;return 'Licence, registration and insurance checked. You may continue.';}
    if(action==='triangle'){if(!this.broken)return 'No breakdown requires a triangle.';if(bus.running||!bus.hazards)return 'Switch off the engine and turn on hazards first.';this.triangle=true;return 'Warning triangle deployed behind the bus.';}
    if(action==='roadside-repair'){if(!this.broken)return 'The bus is not broken down.';if(!this.triangle||!bus.hazards||bus.running)return 'Engine off, hazards on and triangle deployed are required.';this.broken=false;this.triangle=false;this.damage=0;service.score.expenses+=4500;return 'Roadside repair complete. €45 charged. Restart when safe.';}
    return 'Service unavailable.';
  }
}
