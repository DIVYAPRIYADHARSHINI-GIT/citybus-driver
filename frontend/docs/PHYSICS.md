# Driving model and calibration

## Scope

This is an interactive game model, **not a certified bus handling model or a driver-training safety tool**. Values below are chosen calibration parameters for the fictional CB 120 unless explicitly described as measured test output. They are not claimed to be specifications of a real manufacturer's bus.

## Coordinate system and units

- World / physics: metres, seconds, kilograms, newtons and newton-metres.
- Up: +Y; forward: −Z; right: +X.
- Display exceptions: km/h, RPM, bar, litres and °C.
- Physics timestep: 1/120 s; rendering and audio updates do not determine the timestep.
- Chassis mass: 12,000 kg, with an optional 0–5,000 kg test ballast.
- Bus envelope: 12 × 2.5 m; axle positions z = −3.9 / +2.1 m, giving 6.0 m wheelbase. Wheel radius 0.5 m.

## Suspension and tire contact

Four cannon-es `RaycastVehicle` wheels apply spring/damper and tire impulses to one rigid chassis. Its mass and collision shape produce real pitch/roll and contact-load changes. The wheel centers and wheel rotation are driven from the raycast vehicle, not a path animation.

Initial suspension parameters:

| Parameter | Value |
| --- | --- |
| Rest length | 0.60 m |
| Travel limit | ±0.24 m |
| cannon-es stiffness | 32 at base mass |
| Compression / relaxation damping | 4.5 / 3.2 at base mass |
| Maximum force per spring | 100,000 N |
| Roll influence | 0.65 |

Cannon multiplies its stiffness/damper coefficients by chassis mass. When ballast is added, these coefficients are multiplied by `baseMass / currentMass`, preserving spring/damper strength in physical units. Without this normalization, adding ballast would incorrectly stiffen the springs and leave ride height unchanged. A test asserts that 5,000 kg ballast compresses the actual settled chassis by more than 20 mm.

Chosen grip coefficients: dry 0.82, wet 0.48, gravel 0.36. The per-wheel coefficient is adjusted by `(cornerLoad / baseNominalCornerLoad)^−0.09`, with bounded inputs. Rear-wheel drive is limited by suspension load × grip. Off-road ground uses gravel resistance and grip. Snow currently uses **wet grip**, not a snow/ice tire model.

This is not a Pacejka tire, a tire-temperature model, a rotating-wheel ABS solver or a deformable tire. No tire wear, tire pressure, true pneumatic suspension leveling, chassis flexibility or articulated-bus joint is modeled.

## Drivetrain

Piecewise-linear torque curve, N·m:

| RPM | 0 | 400 | 650 | 1,000 | 1,400 | 1,800 | 2,200 | 2,400 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Torque | 0 | 360 | 650 | 1,150 | 1,200 | 1,080 | 760 | 0 |

- Idle: 650 RPM; redline: 2,400 RPM.
- Forward ratios: 3.6, 2.1, 1.42, 1.0, 0.74, 0.61.
- Reverse ratio: 4.1; final drive: 5.4; efficiency: 0.88.
- Tractive force = torque × ratio × final drive × efficiency × clutch coupling / wheel radius.
- Automatic upshift above 1,850 RPM; downshift below 900 RPM, with shift torque interruption.
- The manual clutch blends free and shaft RPM. Low RPM with near-full coupling stalls the engine. Manual shifts require a disengaged clutch; overspeed downshifts are refused.
- Positive engine drive is cut above 27 m/s; this is an engine governor, not a teleporting velocity clamp.

The engine/clutch/automatic torque-converter behavior is a reduced-order approximation. There is no measured diesel combustion model, crankshaft angular-inertia integration, detailed clutch friction-temperature behavior or real transmission ECU map.

## Brakes and resistance

- Service demand: pedal × 78,000 N × usable-air-pressure factor.
- Available pressure scales from 2 to 7 bar.
- ABS approximation caps demanded braking to mass × gravity × surface grip × 0.94 and displays intervention on high brake demand.
- Parking/low-air/door/ramp holding demand: 60,000 N before the adhesion cap.
- Spring brake engages below 2.5 bar; door pneumatics require at least 4 bar.
- Door cycling consumes 0.18 bar. Increasing service-pedal application consumes air; the running-engine compressor replenishes the reservoir up to approximately 9 bar.
- Retarder: three levels, speed-dependent, without service-air consumption.
- Engine drag acts with a coupled drivetrain on closed throttle.
- Rolling resistance coefficient: 0.008 paved / 0.03 gravel.
- Aerodynamic force: ½ × 1.225 kg/m³ × 7.4 m² × 0.65 × speed².

**Important implementation detail:** cannon-es `setBrake` accepts an impulse cap. This implementation converts its desired force to N·s using the fixed timestep and splits it across wheels. Treating that parameter as newtons produces unrealistically short stopping distances.

## Measured automated stopping checks

Test conditions: base 12,000 kg vehicle settled on a flat test plane, initial velocity 50 km/h along −Z, running engine, automatic drive, retarder off, pressure initially 8 bar, full service brake. Stop criterion: forward speed below 0.1 m/s. Distance is the actual change in chassis position, not a separately calculated UI estimate.

| Surface | Simulated braking distance | Simulated elapsed time |
| --- | ---: | ---: |
| Dry | 14.41 m | 2.07 s |
| Wet | 20.98 m | 3.02 s |
| Gravel | 26.06 m | 3.76 s |

These values **exclude human reaction time**, use selected grip parameters and are not real-world stopping-distance guarantees. Pneumatic propagation delay is not yet modeled. Unit tests assert that wet braking is longer than dry, that the bus does not reverse at the stopping threshold, and that the result remains in a broad 10–65 m sanity range.

## Replay

The live body is sampled at 10 Hz into a 300-frame ring. Position is linearly interpolated, orientation uses normalized shortest-arc quaternion slerp, and speed/steering are interpolated. The recorded body is rendered while the authoritative simulation remains paused. A test ensures interpolation never mutates the recording; a browser test ensures replay never changes the live rigid body.

Only vehicle trajectory/steering is recorded. It is not a complete event-sourced replay of dashboard state, audio, wheel suspension, weather, passengers or traffic.

## Implementation references

- cannon-es RaycastVehicle API: https://pmndrs.github.io/cannon-es/docs/classes/RaycastVehicle.html
- cannon-es source: https://github.com/pmndrs/cannon-es
- Three.js rendering documentation: https://threejs.org/docs/

Manufacturer references were consulted for the general city-bus class, but this fictional model is not presented as an exact Scania or Mercedes bus. Its 12,000 kg base mass follows the requested game target; the remainder is explicit game calibration.
