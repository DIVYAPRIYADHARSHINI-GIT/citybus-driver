// SI units internally: m, s, kg, N, N·m. RPM and bar are explicit exceptions.
import {SPECS,upgradeEffects,wearNew,type Spec,type Wear} from '../tycoon/engine';
export type Surface = 'dry' | 'wet' | 'gravel';
export type Gear = -1 | 0 | 1 | 2 | 3 | 4 | 5 | 6;
export const BUS = Object.freeze({ mass: 12000, length: 12, width: 2.5, wheelbase: 6, wheelRadius: .5,
  idle: 650, redline: 2400, finalDrive: 5.4, efficiency: .88, tank: 260,
  ratios: [0, 3.6, 2.1, 1.42, 1, .74, .61], reverse: 4.1 });
export const grip: Record<Surface, number> = { dry: .82, wet: .48, gravel: .36 };
export const clamp = (n: number, low: number, high: number) => Math.max(low, Math.min(high, n));
export function torqueAt(rpm: number,curve?:number[][]): number {
  const points = curve??[[0, 0], [400, 360], [650, 650], [1000, 1150], [1400, 1200], [1800, 1080], [2200, 760], [2400, 0]];
  for (let i = 1; i < points.length; i++) {
    if (rpm <= points[i][0]) { const [a,b] = points[i-1], [c,d] = points[i]; return Math.max(0, b + (d-b) * (rpm-a)/(c-a)); }
  }
  return 0;
}
export interface Pedals { throttle: number; brake: number; clutch: number; steer: number }
export type Action = 'ignition' | 'parking' | 'gearUp' | 'gearDown' | 'automatic' | 'doors' | 'left' | 'right' | 'hazards' | 'lights' | 'wipers' | 'retarder' | 'horn' | 'radio' | 'ramp';
export class Drivetrain {
  visualPedals:Pedals={throttle:0,brake:0,clutch:0,steer:0};
  spec:Spec=SPECS[0];wear:Wear=wearNew();upgrades:Record<string,number>={};energyUsed=0;broken=false;
  configure(spec:Spec,wear:Wear=wearNew(),upgrades:Record<string,number>={}){this.spec=spec;if(spec.energy==='electric')this.automatic=true;this.wear={...wear};this.upgrades={...upgrades};this.fuel=(spec.battery_kwh||spec.tank_l)*.8;this.gear=0;this.running=false;this.rpm=0;this.parking=true;this.broken=false;this.energyUsed=0;}
  running = false; rpm = 0; gear: Gear = 0; automatic = true; parking = true;
  air = 8; fuel = 210; temperature = 65; doors = false; ramp = false;
  left = false; right = false; hazards = false; lights = false; wipers = false; retarder = 0;
  radio = 0; abs = false; stalled = false; shiftTimer = 0; fuelUsed = 0; lastBrake = 0;
  lastMessage = ''; engineForce = 0; brakeForce = 0; load = 0;
  action(action: Action, speed: number, clutch = 0): string {
    const stopped = Math.abs(speed) < .35;
    if(action==='ignition'&&!this.running&&this.broken)return 'Vehicle fault: repair the bus before starting.';
    if(this.spec.energy==='electric'&&action==='automatic')return 'Electric bus uses a single-speed D / N / R selector.';
    switch (action) {
      case 'ignition':
        if (!this.running && this.gear !== 0 && !(clutch > .85 || this.automatic)) return 'Select neutral or depress the clutch to start.';
        if (!this.running && this.fuel <= 0) return 'Fuel tank is empty.';
        this.running = !this.running; this.rpm = this.running ? this.spec.idle_rpm : 0; this.stalled = false;
        return this.running ? 'Engine started. Check air pressure before moving.' : 'Engine switched off.';
      case 'parking': this.parking = !this.parking; return this.parking ? 'Parking brake applied.' : 'Parking brake released.';
      case 'doors':
        if (!stopped) return 'Stop the bus before opening the doors.';
        if (!this.doors && this.air < 4) return 'Not enough air pressure for the doors.';
        if (this.ramp) return 'Retract the ramp before closing the doors.';
        this.doors = !this.doors; this.air = Math.max(0, this.air-.18); return this.doors ? 'Doors open. Drive interlock active.' : 'Doors closed.';
      case 'ramp':
        if (!stopped || !this.doors || !this.parking) return 'Stop, apply the parking brake and open the doors first.';
        this.ramp = !this.ramp; return this.ramp ? 'Accessibility ramp deployed.' : 'Ramp retracted.';
      case 'automatic': if (!stopped) return 'Stop before changing transmission mode.'; this.automatic = !this.automatic; this.gear = 0; return this.automatic ? 'Automatic transmission. Select D with E.' : 'Manual transmission. Hold Shift to operate the clutch.';
      case 'gearUp': case 'gearDown': {
        if (!this.automatic && clutch < .85) return 'Depress the clutch (Shift) before shifting.';
        const next = this.automatic ? (action === 'gearUp' ? (this.gear < 0 ? 0 : 1) : (this.gear > 0 ? 0 : -1)) : clamp(this.gear + (action === 'gearUp' ? 1 : -1), -1, 6);
        if ((next === -1 || this.gear === -1) && !stopped) return 'Stop before selecting or leaving reverse.';
        const ratio = next < 0 ? this.spec.reverse_ratio : [0,...this.spec.gear_ratios][next];
        if (this.spec.energy!=='electric'&&Math.abs(speed) / this.spec.wheel_radius_m * 60/(2*Math.PI) * ratio * this.spec.final_drive > this.spec.redline_rpm * 1.05) return 'Downshift blocked: engine overspeed.';
        this.gear = next as Gear; this.shiftTimer = .35;
        return `Selected ${this.gear < 0 ? 'reverse' : this.gear === 0 ? 'neutral' : this.automatic ? 'drive' : `gear ${this.gear}`}.`;
      }
      case 'left': this.left = !this.left; this.right = false; return `Left indicator ${this.left ? 'on' : 'off'}.`;
      case 'right': this.right = !this.right; this.left = false; return `Right indicator ${this.right ? 'on' : 'off'}.`;
      case 'hazards': this.hazards = !this.hazards; return `Hazards ${this.hazards ? 'on' : 'off'}.`;
      case 'lights': this.lights = !this.lights; return `Headlights ${this.lights ? 'on' : 'off'}.`;
      case 'wipers': this.wipers = !this.wipers; return `Wipers ${this.wipers ? 'on' : 'off'}.`;
      case 'retarder': this.retarder = (this.retarder+1)%4; return `Retarder level ${this.retarder}.`;
      case 'radio': this.radio = (this.radio+1)%4; return ['Radio off.', 'Radio: Night Line (synthesized).', 'Radio: Green Route (synthesized).', 'Radio: Coast FM (synthesized).'][this.radio];
      case 'horn': return 'Horn';
    }
  }
  step(dt: number, speed: number, input: Pedals, surface: Surface) {
    this.visualPedals={...input};
    if(this.spec.energy==='electric'){this.electricStep(dt,speed,input,surface);return;}
    const spec=this.spec,effect=upgradeEffects(spec,this.wear,this.upgrades);
    const throttle = clamp(input.throttle, 0, 1), brake = clamp(input.brake, 0, 1);
    this.shiftTimer = Math.max(0, this.shiftTimer-dt);
    const wheelRpm = Math.abs(speed)/spec.wheel_radius_m*60/(2*Math.PI);
    if (this.automatic && this.gear > 0 && this.shiftTimer === 0) {
      if (this.rpm > 1850*spec.redline_rpm/2400 && Math.abs(speed)>3 && this.gear < 6) { this.gear = (this.gear+1) as Gear; this.shiftTimer = .45; }
      else if (this.rpm < 900*spec.redline_rpm/2400 && this.gear > 1) { this.gear = (this.gear-1) as Gear; this.shiftTimer = .3; }
    }
    const ratio = this.gear < 0 ? spec.reverse_ratio : [0,...spec.gear_ratios][this.gear];
    const coupling = this.gear === 0 || this.shiftTimer > 0 ? 0 : this.automatic ? clamp(Math.abs(speed)/3 + throttle*.65, .15, 1) : 1-clamp(input.clutch,0,1);
    const shaftRpm = wheelRpm * ratio * spec.final_drive;
    const freeRpm = spec.idle_rpm + throttle*(spec.redline_rpm-spec.idle_rpm);
    const target = this.running ? (this.automatic ? Math.max(spec.idle_rpm, shaftRpm, freeRpm*(1-coupling)) : freeRpm*(1-coupling)+shaftRpm*coupling) : 0;
    this.rpm += (target-this.rpm) * Math.min(1, dt*(coupling > .8 ? 10 : 3));
    if (this.running && !this.automatic && coupling > .92 && this.rpm < 390) { this.running = false; this.stalled = true; this.lastMessage = 'Engine stalled. Depress clutch, select neutral and restart.'; }
    if (this.fuel <= 0) { this.running = false; this.rpm = Math.max(0, this.rpm-dt*800); }
    const powered = this.running && !this.broken && !this.doors && !this.ramp && this.shiftTimer === 0;
    const force = torqueAt(this.rpm,spec.torque_curve) * ratio * spec.final_drive * BUS.efficiency / spec.wheel_radius_m * coupling * effect.power/spec.power_kw;
    this.engineForce = powered ? throttle * force * (this.gear < 0 ? -1 : 1) : 0;
    if (Math.abs(speed) > spec.max_speed_mps && Math.sign(this.engineForce) === Math.sign(speed)) this.engineForce = 0;
    const pressure = clamp((this.air-2)/5, 0, 1);
    const service = brake * effect.brakes * pressure;
    const engineDrag = this.running && throttle < .04 && coupling > .5 ? 130*ratio*spec.final_drive/spec.wheel_radius_m : 0;
    const retarding = this.gear !== 0 ? this.retarder*4200*clamp(Math.abs(speed)/4, 0, 1) : 0;
    const emergency = this.parking || this.air < 2.5 || this.doors || this.ramp;
    const demand = service + engineDrag + retarding + (emergency ? 60000 : 0);
    // Cannon's wheel impulse constraint is not a full rotating-tire model. This ABS
    // pressure limiter conservatively caps demand to available surface adhesion.
    const limit = (spec.mass_kg+this.load) * 9.81 * grip[surface] * .94 * effect.grip;
    this.abs = service > limit && Math.abs(speed) > 1;
    this.brakeForce = Math.min(demand, limit);
    const application = Math.max(0, brake-this.lastBrake);
    this.air = clamp(this.air - application*.3 - brake*dt*.014 + (this.running && this.air<9 ? dt*(.055+this.rpm*.000035) : 0), 0, 10);
    this.lastBrake = brake;
    const liters = this.running ? dt*(1.8+throttle*22*(this.rpm/spec.redline_rpm))/3600*(spec.power_kw/204)*(1+this.wear.energy/20000) : 0;
    this.fuel = Math.max(0, this.fuel-liters); this.fuelUsed += liters;
    this.temperature += ((this.running ? 80+throttle*12 : 18)-this.temperature)*dt*.004;
  }
  private electricStep(dt:number,speed:number,input:Pedals,surface:Surface){const s=this.spec,e=upgradeEffects(s,this.wear,this.upgrades);this.automatic=true;this.shiftTimer=Math.max(0,this.shiftTimer-dt);if(this.fuel<=0||this.broken)this.running=false;this.rpm=Math.abs(speed)/s.wheel_radius_m*60/(2*Math.PI)*s.motor_ratio;const direction=this.gear<0?-1:this.gear>0?1:0;
    const traction=Math.min(s.motor_torque_nm*s.motor_ratio/s.wheel_radius_m,e.power*1000/Math.max(2,Math.abs(speed)));
    this.engineForce=this.running&&!this.doors&&!this.ramp&&!this.shiftTimer?direction*clamp(input.throttle,0,1)*traction:0;if(Math.abs(speed)>s.max_speed_mps&&Math.sign(this.engineForce)===Math.sign(speed))this.engineForce=0;
    const regen=this.running&&this.gear!==0&&this.fuel<e.energyCapacity*.99&&input.throttle<.05?Math.min(s.regen_force_n*(.2+this.retarder*.2+input.brake*.4),e.power*500/Math.max(2,Math.abs(speed)))*clamp(Math.abs(speed)/2,0,1):0;
    const demand=input.brake*e.brakes*clamp((this.air-2)/5,0,1)+regen+(this.parking||this.doors||this.ramp||this.air<2.5?60000:0),limit=(s.mass_kg+this.load)*9.81*grip[surface]*e.grip*.94;this.abs=demand>limit&&Math.abs(speed)>1;this.brakeForce=Math.min(demand,limit);
    this.air=clamp(this.air-Math.max(0,input.brake-this.lastBrake)*.3-input.brake*dt*.014+(this.running&&this.air<9?dt*.12:0),0,10);this.lastBrake=input.brake;
    const kwh=(Math.abs(this.engineForce*speed)/.9+ (this.running?1500:0)-regen*Math.abs(speed)*.65)*dt/3600000;const next=clamp(this.fuel-kwh,0,e.energyCapacity);this.energyUsed+=Math.max(0,this.fuel-next);this.fuel=next;this.temperature+=((this.running?45:18)-this.temperature)*dt*.004;
  }
  get gearLabel() { return this.gear === 0 ? 'N' : this.gear < 0 ? 'R' : this.automatic ? `D${this.gear}` : String(this.gear); }
}
