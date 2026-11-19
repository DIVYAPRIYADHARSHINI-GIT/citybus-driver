import * as C from 'cannon-es';
import { BUS, Drivetrain, grip, type Surface, type Pedals } from './drivetrain';
import {specFor,wearNew,upgradeEffects,stableHash,type Wear,type Spec} from '../tycoon/engine';
export interface Frame { t: number; p: [number,number,number]; q: [number,number,number,number]; speed: number; steer: number; rear?:{p:[number,number,number];q:[number,number,number,number]} }
export class Vehicle {
  world = new C.World({ gravity: new C.Vec3(0,-9.81,0) });
  chassis: C.Body; ray: C.RaycastVehicle; drive = new Drivetrain();
  surface: Surface = 'dry'; steer = 0; distance = 0; elapsed = 0; impacts = 0; peakImpact = 0;
  replay: Frame[] = []; private recordClock = 0; private collisionCooldown = 0;
  readonly forward = new C.Vec3(); readonly prev = new C.Vec3();
  resetPoint={x:-50,z:45,yaw:0};
  roadClassifier:((p:{x:number;z:number})=>boolean)|null=null;
  trailer:C.Body|null=null;trailerRay:C.RaycastVehicle|null=null;joint:C.HingeConstraint|null=null;trackWear=true;private wearMeters=0;private faultKilometer=0;
  constructor() {
    this.world.broadphase = new C.SAPBroadphase(this.world);
    (this.world.solver as C.GSSolver).iterations = 12;
    this.world.defaultContactMaterial.friction = .4;
    const ground = new C.Body({ mass: 0, shape: new C.Plane() });
    ground.quaternion.setFromEuler(-Math.PI/2,0,0); ground.aabbNeedsUpdate=true; this.world.addBody(ground);
    this.chassis = new C.Body({ mass: BUS.mass, linearDamping: .006, angularDamping: .18, allowSleep: false });
    this.chassis.addShape(new C.Box(new C.Vec3(1.22,1.25,5.9)), new C.Vec3(0,.58,0));
    this.ray = new C.RaycastVehicle({ chassisBody: this.chassis, indexRightAxis: 0, indexUpAxis: 1, indexForwardAxis: 2 });
    for (const [x,z] of [[-1.04,-3.9],[1.04,-3.9],[-1.04,2.1],[1.04,2.1]]) {
      this.ray.addWheel({ radius: BUS.wheelRadius, directionLocal: new C.Vec3(0,-1,0), axleLocal: new C.Vec3(-1,0,0),
        chassisConnectionPointLocal: new C.Vec3(x,-.1,z), suspensionRestLength: .6,
        suspensionStiffness: 32, dampingRelaxation: 3.2, dampingCompression: 4.5,
        maxSuspensionForce: 100000, maxSuspensionTravel: .24, frictionSlip: grip.dry,
        rollInfluence: .65, customSlidingRotationalSpeed: -25, useCustomSlidingRotationalSpeed: false });
    }
    this.ray.addToWorld(this.world);
    this.chassis.addEventListener('collide', (event: { contact: C.ContactEquation }) => {
      const impact = Math.abs(event.contact.getImpactVelocityAlongNormal());
      if (impact > 2.5 && this.collisionCooldown <= 0) { this.impacts++; this.peakImpact = impact; this.collisionCooldown = 3; }
    });
    this.reset();
  }
  addBox(x: number, y: number, z: number, sx: number, sy: number, sz: number, yaw = 0) {
    const b = new C.Body({ mass:0, shape:new C.Box(new C.Vec3(sx/2,sy/2,sz/2)), position:new C.Vec3(x,y,z) });
    b.quaternion.setFromEuler(0,yaw,0); b.aabbNeedsUpdate=true; this.world.addBody(b); return b;
  }
  configure(modelId:string,wear:Wear=wearNew(),upgrades:Record<string,number>={}){
    const spec=specFor(modelId);if(!spec)throw new Error('Model is collection-only.');if(this.joint)this.world.removeConstraint(this.joint);if(this.trailerRay)this.trailerRay.removeFromWorld(this.world);this.joint=null;this.trailer=null;this.trailerRay=null;
    this.drive.configure(spec,wear,upgrades);this.trackWear=true;this.wearMeters=0;this.faultKilometer=0;
    for(const shape of [...this.chassis.shapes])this.chassis.removeShape(shape);
    this.chassis.mass=spec.front_mass_kg;const length=spec.front_length_m;
    this.chassis.addShape(new C.Box(new C.Vec3(spec.width_m/2-.03,modelId==='cb-120'?1.25:(spec.height_m-.8)/2,length/2-.1)),new C.Vec3(0,spec.cg_offset_m,0));this.chassis.updateMassProperties();
    this.ray.wheelInfos.forEach((w,i)=>{w.radius=spec.wheel_radius_m;w.chassisConnectionPointLocal.set((i%2?1:-1)*(spec.width_m/2-.21),-.1,i<2?-length*.325:length*.175);w.suspensionStiffness=upgradeEffects(spec,wear,upgrades).suspension;w.rollInfluence=modelId==='cb-120'?.65:Math.min(1,.65+(spec.cg_offset_m-.58)*.4);});
    if(spec.rear_length_m>0){
      this.trailer=new C.Body({mass:spec.rear_mass_kg,angularDamping:.22,linearDamping:.006,allowSleep:false});this.trailer.addShape(new C.Box(new C.Vec3(1.22,1.25,spec.rear_length_m/2-.1)),new C.Vec3(0,.58,0));
      this.trailerRay=new C.RaycastVehicle({chassisBody:this.trailer,indexRightAxis:0,indexUpAxis:1,indexForwardAxis:2});for(const x of [-1.04,1.04])this.trailerRay.addWheel({radius:.5,directionLocal:new C.Vec3(0,-1,0),axleLocal:new C.Vec3(-1,0,0),chassisConnectionPointLocal:new C.Vec3(x,-.1,1.1),suspensionRestLength:.6,suspensionStiffness:32,dampingRelaxation:3.2,dampingCompression:4.5,maxSuspensionForce:100000,maxSuspensionTravel:.24,frictionSlip:grip.dry,rollInfluence:.65});this.trailerRay.addToWorld(this.world);
      this.joint=new C.HingeConstraint(this.chassis,this.trailer,{pivotA:new C.Vec3(0,0,length/2+.2),pivotB:new C.Vec3(0,0,-spec.rear_length_m/2-.2),axisA:new C.Vec3(0,1,0),axisB:new C.Vec3(0,1,0),maxForce:1e7,collideConnected:false});this.world.addConstraint(this.joint);
    }
    this.setLoad(this.drive.load);this.reset();
  }
  reset() {
    this.chassis.position.set(this.resetPoint.x,1.25,this.resetPoint.z); this.chassis.quaternion.setFromEuler(0,this.resetPoint.yaw,0);
    this.chassis.velocity.setZero(); this.chassis.angularVelocity.setZero(); this.chassis.force.setZero(); this.chassis.torque.setZero();
    this.chassis.aabbNeedsUpdate = true; this.chassis.wakeUp(); this.prev.copy(this.chassis.position);
    this.steer = 0; this.drive.parking = true; this.drive.gear = 0; this.drive.doors = false; this.drive.ramp = false;
    this.replay = []; this.recordClock = 0;
    if(this.trailer){const offset=new C.Vec3(0,0,this.drive.spec.front_length_m/2+this.drive.spec.rear_length_m/2+.4);this.chassis.quaternion.vmult(offset,offset);this.trailer.position.copy(this.chassis.position.vadd(offset));this.trailer.quaternion.copy(this.chassis.quaternion);this.trailer.velocity.setZero();this.trailer.angularVelocity.setZero();this.trailer.aabbNeedsUpdate=true;}
  }
  get speed() { this.chassis.quaternion.vmult(new C.Vec3(0,0,-1),this.forward); return this.chassis.velocity.dot(this.forward); }
  get onRoad() {
    if(this.roadClassifier)return this.roadClassifier(this.chassis.position);
    const {x,z} = this.chassis.position;
    const d = Math.abs(z) <= 60 ? Math.abs(x) : Math.hypot(x, Math.abs(z)-60);
    return d > 40 && d < 60;
  }
  get actualSurface(): Surface { return this.onRoad ? this.surface : 'gravel'; }
  step(dt: number, pedals: Pedals) {
    const speed = this.speed;
    const spec=this.drive.spec,effect=upgradeEffects(spec,this.drive.wear,this.drive.upgrades);
    this.drive.step(dt,speed,pedals,this.actualSurface);
    const maxAngle = spec.steer_angle_rad / (1 + Math.abs(speed)*.045);
    const target = pedals.steer * maxAngle;
    this.steer += (target-this.steer)*Math.min(1,dt*4);
    for(let i=0;i<4;i++) {
      const w = this.ray.wheelInfos[i];
      // Mild load sensitivity: actual spring force drives the friction constraint.
      const nominal = spec.front_mass_kg*9.81/4;
      w.frictionSlip = grip[this.actualSurface] * Math.pow(clampPositive(w.suspensionForce/nominal),-.09)*effect.grip;
      this.ray.setSteeringValue(i<2 ? this.steer : 0,i);
      const tractionLimit=Math.max(0,w.suspensionForce)*w.frictionSlip;
      const engineForce=Math.sign(this.drive.engineForce)*Math.min(Math.abs(this.drive.engineForce/2),tractionLimit);
      this.ray.applyEngineForce(i>1 ? engineForce : 0,i);
      // cannon-es brake is an impulse (N·s), NOT a force; fixed-step conversion matters.
      this.ray.setBrake(this.drive.brakeForce * dt/(this.trailer?6:4),i);
    }
    if(this.trailerRay&&this.trailer){for(let i=0;i<2;i++){this.trailerRay.wheelInfos[i].frictionSlip=grip[this.actualSurface]*effect.grip;this.trailerRay.setBrake(this.drive.brakeForce*dt/6,i);}const forwardA=this.chassis.quaternion.vmult(new C.Vec3(0,0,-1)),forwardB=this.trailer.quaternion.vmult(new C.Vec3(0,0,-1)),angle=Math.atan2(forwardA.cross(forwardB).y,forwardA.dot(forwardB));const torque=-angle*55000-(this.trailer.angularVelocity.y-this.chassis.angularVelocity.y)*7000;this.trailer.torque.y+=torque;this.chassis.torque.y-=torque;if(Math.abs(angle)>spec.max_articulation_rad){this.trailer.torque.y-=Math.sign(angle)*(Math.abs(angle)-spec.max_articulation_rad)*250000;}}
    // Aerodynamic and rolling resistance, avoiding a sign flip at a standstill.
    const resistance = Math.min(Math.abs(speed)*(spec.mass_kg+this.drive.load)/dt, .5*1.225*spec.drag_area_m2*.65*speed*speed + (this.actualSurface==='gravel' ? .03 : .008)*(spec.mass_kg+this.drive.load)*9.81);
    if(Math.abs(speed)>.01) this.chassis.applyForce(this.forward.scale(-Math.sign(speed)*resistance));
    this.world.step(dt); this.elapsed += dt; this.collisionCooldown -= dt;
    const traveled=this.chassis.position.distanceTo(this.prev);this.distance += traveled; this.prev.copy(this.chassis.position);
    if(this.trackWear){this.wearMeters+=traveled;for(const [part,rate] of [['engine',.003],['brakes',.004],['tires',.005],['energy',.002]] as [keyof Wear,number][])this.drive.wear[part]=Math.min(10000,this.drive.wear[part]+traveled*rate*(part==='brakes'?1+pedals.brake:1));if(Math.floor(this.wearMeters/1000)>this.faultKilometer){this.faultKilometer=Math.floor(this.wearMeters/1000);if(stableHash(`${spec.id}:${this.faultKilometer}`)%10000<effect.breakdownPerKm*10000){this.drive.broken=true;this.drive.running=false;this.drive.lastMessage='Wear-related breakdown. Park safely and arrange maintenance.';}}}
    this.recordClock += dt;
    if(this.recordClock+1e-9>=.1) {
      this.recordClock-=.1; const p=this.chassis.position, q=this.chassis.quaternion;
      const rear=this.trailer?{p:[this.trailer.position.x,this.trailer.position.y,this.trailer.position.z] as Frame['p'],q:[this.trailer.quaternion.x,this.trailer.quaternion.y,this.trailer.quaternion.z,this.trailer.quaternion.w] as Frame['q']}:undefined;
      this.replay.push({t:this.elapsed,p:[p.x,p.y,p.z],q:[q.x,q.y,q.z,q.w],speed:this.speed,steer:this.steer,...(rear?{rear}:{})});
      if(this.replay.length>300) this.replay.shift();
    }
  }
  setLoad(kg: number) {
    const spec=this.drive.spec;
    this.drive.load = Math.max(0,Math.min(Math.max(5000,spec.capacity*75),kg));
    const frontShare=this.trailer?spec.front_mass_kg/spec.mass_kg:1;
    this.chassis.mass=spec.front_mass_kg+this.drive.load*frontShare;this.chassis.updateMassProperties();
    if(this.trailer&&this.trailerRay){this.trailer.mass=spec.rear_mass_kg+this.drive.load*(1-frontShare);this.trailer.updateMassProperties();const n=spec.rear_mass_kg/this.trailer.mass;for(const w of this.trailerRay.wheelInfos){w.suspensionStiffness=32*n;w.dampingRelaxation=3.2*n;w.dampingCompression=4.5*n;}}
    // Cannon multiplies each spring/damper coefficient by chassis mass. Normalize
    // back to the base mass so adding ballast does not magically stiffen springs.
    const normalization=this.drive.spec.front_mass_kg/this.chassis.mass;
    for(const w of this.ray.wheelInfos){w.suspensionStiffness=upgradeEffects(this.drive.spec,this.drive.wear,this.drive.upgrades).suspension*normalization;w.dampingRelaxation=3.2*normalization;w.dampingCompression=4.5*normalization;}
  }
}
function clampPositive(v: number) { return Math.max(.3,Math.min(2.5,v)); }
