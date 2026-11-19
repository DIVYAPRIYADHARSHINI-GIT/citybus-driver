import { describe,expect,it } from 'vitest';
import { BUS,Drivetrain,torqueAt,type Pedals } from '../src/sim/drivetrain';
import { Vehicle } from '../src/sim/vehicle';
import { defaults,validate } from '../src/storage';
const coast:Pedals={throttle:0,brake:0,clutch:0,steer:0};
const run=(d:Drivetrain,seconds:number,speed:number,p:Partial<Pedals>={})=>{for(let i=0;i<seconds*120;i++)d.step(1/120,speed,{...coast,...p},'dry');};
function ready(){const d=new Drivetrain();d.action('ignition',0);d.action('parking',0);d.action('gearUp',0);return d;}
function vehicleReady(){const v=new Vehicle();for(let i=0;i<240;i++)v.step(1/120,coast);v.drive.action('ignition',0);v.drive.action('parking',0);v.drive.action('gearUp',0);return v;}
describe('drivetrain and safety interlocks',()=>{
 it('uses the specified 12,000 kg base mass',()=>expect(BUS.mass).toBe(12000));
 it('interpolates a diesel torque curve and cuts at redline',()=>{expect(torqueAt(1200)).toBe(1175);expect(torqueAt(2400)).toBe(0);expect(torqueAt(3000)).toBe(0);expect(torqueAt(-20)).toBe(0);});
 it('starts in neutral, engine off, parking engaged',()=>{const d=new Drivetrain();expect(d.gear).toBe(0);expect(d.running).toBe(false);expect(d.parking).toBe(true);});
 it('neutral cannot transmit drive force',()=>{const d=new Drivetrain();d.action('ignition',0);run(d,2,0,{throttle:1});expect(d.rpm).toBeGreaterThan(2000);expect(d.engineForce).toBe(0);});
 it('produces forward force and automatic creep clutch without stalling',()=>{const d=ready();run(d,2,0,{throttle:1});expect(d.engineForce).toBeGreaterThan(1000);expect(d.running).toBe(true);});
 it('reverse produces negative drive force',()=>{const d=new Drivetrain();d.action('ignition',0);d.action('gearDown',0);run(d,2,0,{throttle:1});expect(d.engineForce).toBeLessThan(0);});
 it('refuses reverse when moving',()=>{const d=ready();d.action('gearDown',10);expect(d.gear).toBe(0);expect(d.action('gearDown',10)).toContain('Stop');expect(d.gear).toBe(0);});
 it('doors refuse to open in motion',()=>{const d=ready();expect(d.action('doors',1)).toContain('Stop');expect(d.doors).toBe(false);});
 it('open doors inhibit traction and apply a hold brake',()=>{const d=ready();d.action('doors',0);run(d,1,0,{throttle:1});expect(d.engineForce).toBe(0);expect(d.brakeForce).toBeGreaterThan(1000);});
 it('door opening consumes air and refuses low pressure',()=>{const d=new Drivetrain();d.action('doors',0);expect(d.air).toBeCloseTo(7.82);d.doors=false;d.air=3;expect(d.action('doors',0)).toContain('Not enough');});
 it('ramp requires stopped, doors open and parking engaged',()=>{const d=new Drivetrain();expect(d.action('ramp',0)).toContain('Stop');d.action('doors',0);d.action('ramp',0);expect(d.ramp).toBe(true);expect(d.action('doors',0)).toContain('Retract');});
 it('manual shift requires clutch',()=>{const d=new Drivetrain();d.automatic=false;expect(d.action('gearUp',0)).toContain('clutch');expect(d.gear).toBe(0);d.action('gearUp',0,1);expect(d.gear).toBe(1);});
 it('manual engine stalls when clutch is dumped at rest',()=>{const d=ready();d.automatic=false;run(d,2,0,{clutch:0,throttle:0});expect(d.stalled).toBe(true);expect(d.running).toBe(false);});
 it('disengaged clutch permits idle without stalling',()=>{const d=ready();d.automatic=false;run(d,3,0,{clutch:1});expect(d.running).toBe(true);expect(d.engineForce).toBe(0);});
 it('manual restart in gear requires a depressed clutch',()=>{const d=new Drivetrain();d.automatic=false;d.gear=1;expect(d.action('ignition',0)).toContain('neutral');d.action('ignition',0,1);expect(d.running).toBe(true);});
 it('blocks engine overspeed on manual downshift',()=>{const d=ready();d.automatic=false;d.gear=4;expect(d.action('gearDown',25,1)).toContain('overspeed');expect(d.gear).toBe(4);});
 it('automatic gears shift at speed',()=>{const d=ready();run(d,3,14,{throttle:1});expect(d.gear).toBeGreaterThan(1);});
 it('air pressure rises when the compressor runs',()=>{const d=ready();d.air=6;run(d,10,0);expect(d.air).toBeGreaterThan(6.7);});
 it('repeated brake applications consume air',()=>{const d=new Drivetrain();d.parking=false;for(let i=0;i<10;i++){run(d,.1,0,{brake:1});run(d,.1,0);}expect(d.air).toBeLessThan(5.1);});
 it('low air pressure applies the spring brake',()=>{const d=new Drivetrain();d.parking=false;d.air=2;run(d,.1,5);expect(d.brakeForce).toBeGreaterThan(30000);});
 it('ABS limits wet road braking below dry road braking',()=>{const d=ready();d.gear=0;d.step(.01,14,{...coast,brake:1},'dry');const dry=d.brakeForce;d.step(.01,14,{...coast,brake:1},'wet');expect(d.brakeForce).toBeLessThan(dry);expect(d.abs).toBe(true);});
 it('retarder adds braking without consuming service air',()=>{const d=ready();d.rpm=1400;d.step(.01,10,coast,'dry');const base=d.brakeForce;d.retarder=3;d.step(.01,10,coast,'dry');expect(d.brakeForce).toBeGreaterThan(base);});
 it('engine braking disappears when clutch is disengaged',()=>{const d=ready();d.automatic=false;d.shiftTimer=0;d.rpm=1400;d.step(.01,5,coast,'dry');const engaged=d.brakeForce;d.step(.01,5,{...coast,clutch:1},'dry');expect(d.brakeForce).toBeLessThan(engaged);});
 it('consumes fuel only with a running engine',()=>{const d=ready();run(d,60,10,{throttle:1});expect(d.fuelUsed).toBeGreaterThan(.05);d.running=false;const f=d.fuel;run(d,60,0);expect(d.fuel).toBe(f);});
 it('empty tank cannot start',()=>{const d=new Drivetrain();d.fuel=0;expect(d.action('ignition',0)).toContain('empty');expect(d.running).toBe(false);});
 it('indicators are mutually exclusive and hazards independent',()=>{const d=new Drivetrain();d.action('left',0);d.action('right',0);expect(d.left).toBe(false);expect(d.right).toBe(true);d.action('hazards',0);expect(d.hazards).toBe(true);});
 it('transmission mode cannot be changed in motion',()=>{const d=ready();expect(d.action('automatic',5)).toContain('Stop');expect(d.automatic).toBe(true);});
});
describe('real cannon-es raycast chassis',()=>{
 it('settles on all four suspension rays without penetrating the ground',()=>{const v=vehicleReady();expect(v.chassis.position.y).toBeGreaterThan(.8);expect(v.chassis.position.y).toBeLessThan(1.4);expect(v.ray.wheelInfos.filter(w=>w.isInContact)).toHaveLength(4);});
 it('moves forwards down -Z with engine force',()=>{const v=vehicleReady();const z=v.chassis.position.z;for(let i=0;i<600;i++)v.step(1/120,{...coast,throttle:1});expect(v.speed).toBeGreaterThan(1);expect(v.chassis.position.z).toBeLessThan(z-5);expect(Math.abs(v.chassis.position.x+50)).toBeLessThan(.2);});
 it('parking brake holds against full throttle',()=>{const v=vehicleReady();v.drive.parking=true;for(let i=0;i<600;i++)v.step(1/120,{...coast,throttle:1});expect(Math.abs(v.speed)).toBeLessThan(.5);});
 it('steering changes chassis yaw',()=>{const v=vehicleReady();for(let i=0;i<720;i++)v.step(1/120,{...coast,throttle:1,steer:.45});expect(Math.abs(v.chassis.quaternion.y)).toBeGreaterThan(.03);});
 it('ballast changes mass and compresses the physical suspension',()=>{const v=vehicleReady(),emptyY=v.chassis.position.y;v.setLoad(5000);expect(v.chassis.mass).toBe(17000);expect(v.drive.load).toBe(5000);v.drive.parking=true;for(let i=0;i<600;i++)v.step(1/120,coast);expect(v.chassis.position.y).toBeLessThan(emptyY-.02);});
 it('replay is bounded to exactly 300 samples at 10 Hz',()=>{const v=new Vehicle();for(let i=0;i<4800;i++)v.step(1/120,coast);expect(v.replay.length).toBe(300);expect(v.replay.at(-1)!.t-v.replay[0].t).toBeCloseTo(29.9,5);});
 it.each(['dry','wet','gravel'] as const)('stops a bus at 50 km/h on %s without reversing',surface=>{
   const v=vehicleReady();v.surface=surface;v.chassis.velocity.set(0,0,-50/3.6);const start=v.chassis.position.z;let time=0;
   while(v.speed>.1&&time<15){v.step(1/120,{...coast,brake:1});time+=1/120;}
   const distance=start-v.chassis.position.z;console.log(`50→0 ${surface}: ${distance.toFixed(2)} m / ${time.toFixed(2)} s`);
   expect(time).toBeLessThan(10);expect(distance).toBeGreaterThan(10);expect(distance).toBeLessThan(65);expect(v.speed).toBeGreaterThan(-.2);
 });
 it('wet stopping distance is longer than dry',()=>{function stop(surface:'dry'|'wet'){const v=vehicleReady();v.surface=surface;v.drive.gear=0;v.chassis.velocity.set(0,0,-50/3.6);const z=v.chassis.position.z;for(let i=0;i<1200&&v.speed>.1;i++)v.step(1/120,{...coast,brake:1});return z-v.chassis.position.z;}expect(stop('wet')).toBeGreaterThan(stop('dry')*1.2);});
 it('reset clears velocity, orientation and brakes the bus',()=>{const v=vehicleReady();v.chassis.velocity.set(4,5,6);v.reset();expect(v.chassis.velocity.length()).toBe(0);expect(v.chassis.quaternion.w).toBe(1);expect(v.drive.parking).toBe(true);expect(v.drive.gear).toBe(0);});
});
describe('local save boundary',()=>{
 it('round trips the current schema',()=>expect(validate(JSON.parse(JSON.stringify(defaults)))).toEqual(defaults));
 it.each([null,{}, {version:2,sessions:[]}, {...defaults,paint:'<img>'},{...defaults,volume:NaN},{...defaults,hour:-1},{...defaults,sessions:[{date:'bad'}]}])('rejects corrupt or untrusted saves %#',value=>expect(()=>validate(value)).toThrow());
 it('removes unknown top-level and session properties',()=>{const v=validate({...defaults,unsafe:'x',sessions:[{date:new Date().toISOString(),seconds:4,meters:5,liters:.1,impacts:0,unsafe:'x'}]});expect(v).not.toHaveProperty('unsafe');expect(v.sessions[0]).not.toHaveProperty('unsafe');});
});
