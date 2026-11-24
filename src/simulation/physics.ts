import {
  CheckpointRing,
  DroneState,
  DroneWarning,
  FlightMode,
  FlightPhase,
  ObstacleSensorData,
  RCInput,
  Vec3,
  WorldObstacle,
} from '../types/simulation';
import { FLIGHT_MODES } from './modes';
import { getGroundOrWaterHeight, getTerrainHeight, WATER_LEVEL } from './terrain';
import { WeatherEngine } from './weather';

const GRAVITY = 9.81; // m/s^2
const DRONE_MASS = 0.249; // kg (DJI Mini 5 Pro sub-250g class)
const DRONE_RADIUS = 0.24; // meters bounding radius
const DRONE_GEAR_HEIGHT = 0.085; // meters from center to landing pads
const MAX_WIND_RESISTANCE_MS = 10.7; // Beaufort 5 (~10.7 m/s official Mini Pro rating)
const BASE_HOVER_RPM = 6400;
const MAX_MOTOR_RPM = 13800;
const IDLE_MOTOR_RPM = 2300;
const BATTERY_CAPACITY_WH = 18.96; // 2590mAh @ 7.32V

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * clamp(t, 0, 1);
}

function normalizeAngle(rad: number): number {
  let a = rad % (Math.PI * 2);
  if (a > Math.PI) a -= Math.PI * 2;
  if (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export class DronePhysicsEngine {
  public state: DroneState;
  private obstacles: WorldObstacle[];
  public checkpoints: CheckpointRing[];
  private weather: WeatherEngine;
  private phaseTimer = 0;
  private cscHoldTimer = 0;
  private onEvent?: (event: 'takeoff' | 'land' | 'mode' | 'checkpoint' | 'rth' | 'warning') => void;

  constructor(
    weather: WeatherEngine,
    obstacles: WorldObstacle[],
    checkpoints: CheckpointRing[],
    onEvent?: (event: 'takeoff' | 'land' | 'mode' | 'checkpoint' | 'rth' | 'warning') => void
  ) {
    this.weather = weather;
    this.obstacles = obstacles;
    this.checkpoints = checkpoints;
    this.onEvent = onEvent;
    this.state = this.createInitialState();
  }

  private createInitialState(): DroneState {
    const homeY = getTerrainHeight(0, 0) + DRONE_GEAR_HEIGHT;
    return {
      position: { x: 0, y: homeY, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      yaw: 0, // facing North (-Z)
      pitch: 0,
      roll: 0,
      angularVelocity: { x: 0, y: 0, z: 0 },
      gimbalPitchDeg: -10,
      gimbalYawOffsetDeg: 0,
      motorRPM: [0, 0, 0, 0],
      motorThrottle: [0, 0, 0, 0],
      motorsArmed: false,
      flightPhase: 'GROUNDED',
      flightMode: 'normal',
      homePosition: { x: 0, y: homeY, z: 0 },
      rthAltitude: 36,
      altitudeAGL: 0,
      altitudeHome: 0,
      distanceFromHome: 0,
      horizontalSpeed: 0,
      verticalSpeed: 0,
      airspeed: 0,
      headingDeg: 0,
      batteryPercent: 100,
      batteryVoltage: 8.38,
      batteryCurrentA: 0.4,
      estimatedFlightMin: 34,
      satellites: 24,
      rcSignal: 5,
      windAtDrone: { x: 0, y: 0, z: 0 },
      windSpeedAtDrone: 0,
      windDirectionDeg: 0,
      groundEffectFactor: 1,
      obstacles: {
        front: Infinity,
        back: Infinity,
        left: Infinity,
        right: Infinity,
        down: 0,
        closest: Infinity,
        warningActive: false,
      },
      warnings: [],
      checkpointsCleared: 0,
      totalCheckpoints: this.checkpoints.length,
      flightTimeSec: 0,
      isRecording: false,
      recordingSec: 0,
    };
  }

  public setFlightMode(mode: FlightMode): void {
    if (this.state.flightMode === mode) return;
    this.state.flightMode = mode;
    this.onEvent?.('mode');
  }

  public requestTakeoff(): void {
    if (this.state.batteryPercent <= 2) return;
    if (this.state.flightPhase === 'GROUNDED' || this.state.flightPhase === 'ARMING') {
      this.state.motorsArmed = true;
      this.state.flightPhase = 'TAKING_OFF';
      this.phaseTimer = 0;
      this.state.homePosition = { ...this.state.position };
      this.onEvent?.('takeoff');
    }
  }

  public requestLand(): void {
    if (
      this.state.flightPhase === 'FLYING' ||
      this.state.flightPhase === 'TAKING_OFF' ||
      this.state.flightPhase.startsWith('RTH_')
    ) {
      this.state.flightPhase = 'LANDING';
      this.phaseTimer = 0;
      this.onEvent?.('land');
    }
  }

  public toggleTakeoffLand(): void {
    if (this.state.flightPhase === 'GROUNDED') {
      this.requestTakeoff();
    } else if (this.state.flightPhase === 'LANDING') {
      this.state.flightPhase = 'FLYING';
    } else {
      this.requestLand();
    }
  }

  public toggleRTH(): void {
    if (this.state.flightPhase.startsWith('RTH_')) {
      this.state.flightPhase = 'FLYING';
      return;
    }
    if (this.state.flightPhase === 'FLYING' || this.state.flightPhase === 'LANDING') {
      this.state.flightPhase = 'RTH_ASCEND';
      this.phaseTimer = 0;
      this.onEvent?.('rth');
    }
  }

  public toggleRecording(): void {
    this.state.isRecording = !this.state.isRecording;
    if (!this.state.isRecording) {
      this.state.recordingSec = 0;
    }
  }

  public setGimbalPitch(deg: number): void {
    this.state.gimbalPitchDeg = clamp(deg, -90, 60);
  }

  public rechargeBattery(): void {
    this.state.batteryPercent = 100;
    this.state.batteryVoltage = 8.38;
  }

  public resetToHome(): void {
    const mode = this.state.flightMode;
    this.checkpoints.forEach((c) => {
      c.cleared = false;
    });
    this.state = this.createInitialState();
    this.state.flightMode = mode;
    this.phaseTimer = 0;
  }

  public step(dt: number, rawInput: RCInput): void {
    const clampedDt = Math.min(dt, 0.05);
    const s = this.state;
    const modeCfg = FLIGHT_MODES[s.flightMode];

    // Recording timer
    if (s.isRecording) {
      s.recordingSec += clampedDt;
    }

    // Gimbal tilt control
    if (Math.abs(rawInput.gimbalPitchDelta) > 0.01) {
      s.gimbalPitchDeg = clamp(s.gimbalPitchDeg + rawInput.gimbalPitchDelta * 62 * clampedDt, -90, 60);
    }

    // Sample atmospheric wind at drone altitude & position
    const wind = this.weather.sampleWindAt(s.position);
    s.windAtDrone = wind;
    s.windSpeedAtDrone = Math.hypot(wind.x, wind.z);
    s.windDirectionDeg = this.weather.getConfig().windDirectionDeg;

    // Ground elevation directly below drone
    const groundY = getGroundOrWaterHeight(s.position.x, s.position.z);
    const floorY = groundY + DRONE_GEAR_HEIGHT;
    s.altitudeAGL = Math.max(0, s.position.y - floorY);
    s.altitudeHome = s.position.y - s.homePosition.y;

    // Ground effect factor (extra lift cushion within 0..2.2m AGL)
    s.groundEffectFactor = s.altitudeAGL < 2.2 ? 1 + 0.16 * Math.pow(1 - s.altitudeAGL / 2.2, 2) : 1.0;

    // Check CSC (Combination Stick Command: Left down-right, Right down-left OR both down-inward)
    // Also allow holding throttle up > 0.65 while grounded to auto-arm & lift off naturally!
    if (s.flightPhase === 'GROUNDED') {
      const cscInward =
        rawInput.throttle < -0.7 && rawInput.yaw > 0.7 && rawInput.pitch < -0.7 && rawInput.roll < -0.7;
      if (cscInward || rawInput.throttle > 0.6) {
        this.cscHoldTimer += clampedDt;
        if (this.cscHoldTimer > 0.35 && s.batteryPercent > 2) {
          this.cscHoldTimer = 0;
          s.motorsArmed = true;
          s.flightPhase = rawInput.throttle > 0.6 ? 'FLYING' : 'ARMING';
          this.phaseTimer = 0;
          s.homePosition = { ...s.position };
          this.onEvent?.('takeoff');
        }
      } else {
        this.cscHoldTimer = 0;
      }
    }

    // Cancel RTH if pilot moves sticks significantly
    const stickMagnitude = Math.max(
      Math.abs(rawInput.throttle),
      Math.abs(rawInput.yaw),
      Math.abs(rawInput.pitch),
      Math.abs(rawInput.roll)
    );
    if (s.flightPhase.startsWith('RTH_') && (stickMagnitude > 0.45 || rawInput.brake)) {
      s.flightPhase = 'FLYING';
    }
    if (s.flightPhase === 'LANDING' && rawInput.throttle > 0.45) {
      s.flightPhase = 'FLYING';
    }

    // Compute obstacle distances around drone
    s.obstacles = this.computeObstacleSensors(s.position, s.yaw, s.altitudeAGL);

    // Effective control inputs (may be overridden by Auto-Takeoff, Auto-Land, RTH, or Brake)
    const cmd: RCInput = { ...rawInput };
    if (rawInput.brake) {
      cmd.pitch = 0;
      cmd.roll = 0;
      cmd.throttle = 0;
    }

    // Force auto-land on critical depleted battery
    if (s.batteryPercent <= 1 && s.flightPhase === 'FLYING') {
      s.flightPhase = 'LANDING';
    }

    // State machine flight controller
    this.phaseTimer += clampedDt;

    if (s.flightPhase === 'GROUNDED') {
      s.motorsArmed = false;
      s.position.y = floorY;
      s.velocity = { x: 0, y: 0, z: 0 };
      s.pitch = lerp(s.pitch, 0, clampedDt * 8);
      s.roll = lerp(s.roll, 0, clampedDt * 8);
      s.motorThrottle = [0, 0, 0, 0];
      s.motorRPM = s.motorRPM.map((rpm) => Math.max(0, rpm - clampedDt * 14000)) as [
        number,
        number,
        number,
        number,
      ];
    } else if (s.flightPhase === 'ARMING') {
      s.position.y = floorY;
      s.velocity = { x: 0, y: 0, z: 0 };
      for (let i = 0; i < 4; i++) {
        s.motorThrottle[i] = 0.18;
        s.motorRPM[i] = lerp(s.motorRPM[i], IDLE_MOTOR_RPM, clampedDt * 7);
      }
      if (rawInput.throttle > 0.15) {
        s.flightPhase = 'FLYING';
      } else if (this.phaseTimer > 5.0) {
        s.flightPhase = 'GROUNDED';
        s.motorsArmed = false;
      }
    } else {
      // Airborne or active takeoff/landing/RTH
      s.flightTimeSec += clampedDt;
      let didTouchdown = false;

      // Determine target horizontal velocity (world space) & vertical velocity
      let desiredVx = 0;
      let desiredVz = 0;
      let desiredVy = 0;
      let yawInput = cmd.yaw;

      // Forward and right unit vectors based on current yaw (yaw = 0 faces -Z North)
      const fwdX = -Math.sin(s.yaw);
      const fwdZ = -Math.cos(s.yaw);
      const rightX = Math.cos(s.yaw);
      const rightZ = -Math.sin(s.yaw);

      if (s.flightPhase === 'TAKING_OFF') {
        const targetAlt = s.homePosition.y + 2.2;
        const altErr = targetAlt - s.position.y;
        desiredVy = clamp(altErr * 1.6, 0.3, 2.4);
        yawInput = 0;
        if (Math.abs(altErr) < 0.15 || this.phaseTimer > 3.2) {
          s.flightPhase = 'FLYING';
        }
      } else if (s.flightPhase === 'LANDING') {
        desiredVy = s.altitudeAGL > 2.5 ? -2.2 : -clamp(0.45 + s.altitudeAGL * 0.45, 0.45, 1.3);
        desiredVx = (fwdX * cmd.pitch + rightX * cmd.roll) * 2.0;
        desiredVz = (fwdZ * cmd.pitch + rightZ * cmd.roll) * 2.0;
        if (s.altitudeAGL <= 0.04) {
          didTouchdown = this.touchdown(floorY);
        }
      } else if (s.flightPhase === 'RTH_ASCEND') {
        const targetY = Math.max(s.homePosition.y + s.rthAltitude, s.position.y);
        const distHome = Math.hypot(s.homePosition.x - s.position.x, s.homePosition.z - s.position.z);
        if (distHome < 3.0) {
          s.flightPhase = 'RTH_LAND';
        } else {
          const errY = targetY - s.position.y;
          desiredVy = clamp(errY * 1.4, 0, 5.0);
          yawInput = 0;
          if (errY < 0.8) {
            s.flightPhase = 'RTH_RETURN';
          }
        }
      } else if (s.flightPhase === 'RTH_RETURN') {
        const dx = s.homePosition.x - s.position.x;
        const dz = s.homePosition.z - s.position.z;
        const dist = Math.hypot(dx, dz);
        if (dist < 0.65) {
          s.flightPhase = 'RTH_LAND';
        } else {
          const rthSpeed = clamp(dist * 0.85, 1.2, 11.5);
          desiredVx = (dx / dist) * rthSpeed;
          desiredVz = (dz / dist) * rthSpeed;
          // Smoothly point nose toward home
          const targetYaw = Math.atan2(-dx, -dz);
          const yawErr = normalizeAngle(targetYaw - s.yaw);
          yawInput = clamp(-yawErr * 1.5, -0.7, 0.7);
          const errY = s.homePosition.y + s.rthAltitude - s.position.y;
          desiredVy = clamp(errY * 1.2, -2.5, 3.5);
        }
      } else if (s.flightPhase === 'RTH_LAND') {
        const dx = s.homePosition.x - s.position.x;
        const dz = s.homePosition.z - s.position.z;
        desiredVx = clamp(dx * 1.2, -2, 2);
        desiredVz = clamp(dz * 1.2, -2, 2);
        desiredVy = s.altitudeAGL > 3.0 ? -2.8 : -clamp(0.45 + s.altitudeAGL * 0.45, 0.45, 1.4);
        yawInput = 0;
        if (s.altitudeAGL <= 0.04) {
          didTouchdown = this.touchdown(floorY);
        }
      } else {
        // Normal manual/assisted FLYING phase
        // Exponential stick curve (DJI Expo) for micro precision near center
        const expo = (v: number) => Math.sign(v) * (0.45 * Math.abs(v) + 0.55 * Math.pow(Math.abs(v), 2.1));
        const pCmd = expo(cmd.pitch);
        const rCmd = expo(cmd.roll);
        const tCmd = expo(cmd.throttle);

        // Apply omnidirectional obstacle braking in Cine & Normal modes
        let adjPitch = pCmd;
        let adjRoll = rCmd;
        if (modeCfg.obstacleAvoidance) {
          const stopDist = 3.2;
          const slowDist = 8.5;
          if (adjPitch > 0 && s.obstacles.front < slowDist) {
            const factor = clamp((s.obstacles.front - stopDist) / (slowDist - stopDist), 0, 1);
            adjPitch *= factor;
          }
          if (adjPitch < 0 && s.obstacles.back < slowDist) {
            const factor = clamp((s.obstacles.back - stopDist) / (slowDist - stopDist), 0, 1);
            adjPitch *= factor;
          }
          if (adjRoll > 0 && s.obstacles.right < slowDist) {
            const factor = clamp((s.obstacles.right - stopDist) / (slowDist - stopDist), 0, 1);
            adjRoll *= factor;
          }
          if (adjRoll < 0 && s.obstacles.left < slowDist) {
            const factor = clamp((s.obstacles.left - stopDist) / (slowDist - stopDist), 0, 1);
            adjRoll *= factor;
          }
        }

        // Normalize diagonal stick magnitude so diagonal isn't sqrt(2) faster
        const horizMag = Math.hypot(adjPitch, adjRoll);
        const scale = horizMag > 1 ? 1 / horizMag : 1;
        const normP = adjPitch * scale;
        const normR = adjRoll * scale;

        desiredVx = (fwdX * normP + rightX * normR) * modeCfg.maxHorizontalSpeed;
        desiredVz = (fwdZ * normP + rightZ * normR) * modeCfg.maxHorizontalSpeed;

        if (tCmd >= 0) {
          desiredVy = tCmd * modeCfg.maxAscentSpeed;
        } else {
          desiredVy = tCmd * modeCfg.maxDescentSpeed;
        }

        // Holding full throttle down near ground initiates landing
        if (s.altitudeAGL < 0.25 && cmd.throttle < -0.75) {
          didTouchdown = this.touchdown(floorY);
        }
      }

      if (!didTouchdown) {
        this.integrateRigidBody(clampedDt, modeCfg, desiredVx, desiredVy, desiredVz, yawInput, cmd, floorY);
      }
    }

    // Update derived telemetry
    s.distanceFromHome = Math.hypot(
      s.position.x - s.homePosition.x,
      s.position.z - s.homePosition.z
    );
    s.horizontalSpeed = Math.hypot(s.velocity.x, s.velocity.z);
    s.verticalSpeed = s.velocity.y;
    s.airspeed = Math.hypot(
      s.velocity.x - wind.x,
      s.velocity.y - wind.y,
      s.velocity.z - wind.z
    );
    // Compass heading: 0 = North (-Z), 90 = East (+X), 180 = South (+Z), 270 = West (-X)
    s.headingDeg = (((-s.yaw * 180) / Math.PI) % 360 + 360) % 360;

    // Satellites & RC Signal realistic modulation
    const weatherCfg = this.weather.getConfig();
    s.satellites = s.flightMode === 'atti' ? 0 : Math.round(24 - weatherCfg.cloudCoverage * 5);
    const signalDrop = Math.floor(s.distanceFromHome / 110) + (weatherCfg.rainIntensity > 0.7 ? 1 : 0);
    s.rcSignal = clamp(5 - signalDrop, 1, 5);

    // Battery physics
    this.updateBattery(clampedDt, modeCfg);

    // Checkpoints check
    this.updateCheckpoints();

    // Update HUD warnings
    s.warnings = this.computeWarnings(weatherCfg.rainIntensity);
  }

  private integrateRigidBody(
    dt: number,
    modeCfg: (typeof FLIGHT_MODES)[FlightMode],
    desiredVx: number,
    desiredVy: number,
    desiredVz: number,
    yawInput: number,
    rawCmd: RCInput,
    floorY: number
  ): void {
    const s = this.state;
    const wind = s.windAtDrone;

    // 1. Yaw dynamics (smooth angular velocity)
    const targetYawRate = (-yawInput * modeCfg.yawRateDeg * Math.PI) / 180;
    s.angularVelocity.y = lerp(s.angularVelocity.y, targetYawRate, dt * 8.5);
    s.yaw = normalizeAngle(s.yaw + s.angularVelocity.y * dt);

    // 2. Aerodynamic drag force on air-relative velocity (quadratic + linear drag)
    const relVx = s.velocity.x - wind.x;
    const relVy = s.velocity.y - wind.y;
    const relVz = s.velocity.z - wind.z;
    const relSpeed = Math.hypot(relVx, relVy, relVz);

    // Sub-250g quadcopter drag profile: F_drag = -0.5 * rho * Cd * A * |v_rel| * v_rel
    // Mini 5 Pro: rho=1.225, Cd~0.58, frontal A~0.009 m^2 => k_horiz ~ 0.0032 kg/m
    const dragCoeffHoriz = 0.0032;
    const dragCoeffVert = 0.0085;
    const dragAx = (-(dragCoeffHoriz * relSpeed + 0.028) * relVx) / DRONE_MASS;
    const dragAz = (-(dragCoeffHoriz * relSpeed + 0.028) * relVz) / DRONE_MASS;
    const dragAy = (-(dragCoeffVert * Math.abs(relVy) + 0.045) * relVy) / DRONE_MASS;

    // 3. Flight controller acceleration command
    const maxTiltRad = (modeCfg.maxTiltDeg * Math.PI) / 180;
    // Maximum horizontal acceleration from tilt: g * tan(maxTilt)
    const maxHorizAccel = GRAVITY * Math.tan(maxTiltRad);

    let ctrlAx = 0;
    let ctrlAz = 0;

    if (modeCfg.gpsHold || s.flightPhase !== 'FLYING') {
      // Active GPS Velocity Controller + Wind Compensation
      const errVx = desiredVx - s.velocity.x;
      const errVz = desiredVz - s.velocity.z;
      const isBraking = Math.hypot(desiredVx, desiredVz) < 0.2;
      const gain = isBraking ? modeCfg.brakingStrength : modeCfg.horizontalResponsiveness;

      // Controller cancels aerodynamic drag/wind up to Mini 5 Pro wind-resistance authority (~10.7 m/s).
      // When gusts exceed MAX_WIND_RESISTANCE_MS, excess wind force visibly pushes the drone!
      const windMag = Math.hypot(wind.x, wind.z);
      const windExcessRatio =
        windMag > MAX_WIND_RESISTANCE_MS
          ? clamp((windMag - MAX_WIND_RESISTANCE_MS) / windMag, 0, 0.75)
          : 0;
      const windPushX = wind.x * windExcessRatio * 0.45;
      const windPushZ = wind.z * windExcessRatio * 0.45;

      ctrlAx = errVx * gain - dragAx * (1 - windExcessRatio) + windPushX;
      ctrlAz = errVz * gain - dragAz * (1 - windExcessRatio) + windPushZ;

      // Clamp total control acceleration by tilt envelope
      const ctrlMag = Math.hypot(ctrlAx, ctrlAz);
      if (ctrlMag > maxHorizAccel) {
        ctrlAx = (ctrlAx / ctrlMag) * maxHorizAccel;
        ctrlAz = (ctrlAz / ctrlMag) * maxHorizAccel;
      }
    } else {
      // ATTI Mode: Direct tilt control! Stick directly sets pitch/roll tilt -> thrust vector tilts -> wind drifts drone freely
      const fwdX = -Math.sin(s.yaw);
      const fwdZ = -Math.cos(s.yaw);
      const rightX = Math.cos(s.yaw);
      const rightZ = -Math.sin(s.yaw);
      const stickTiltAccel = maxHorizAccel * 0.92;
      // Amplify wind advection feel in ATTI mode (uncompensated crosswind slip)
      ctrlAx = (fwdX * rawCmd.pitch + rightX * rawCmd.roll) * stickTiltAccel + (wind.x - s.velocity.x) * 0.35;
      ctrlAz = (fwdZ * rawCmd.pitch + rightZ * rawCmd.roll) * stickTiltAccel + (wind.z - s.velocity.z) * 0.35;
    }

    // 4. Vertical Thrust Controller (Altitude Hold + Ground Effect + Turbulence)
    const errVy = desiredVy - s.velocity.y;
    const vertGain = 5.4;
    // Total upward thrust acceleration needed = gravity + vertical command - drag
    const thrustAccelY = clamp(
      GRAVITY + errVy * vertGain - dragAy * 0.65,
      1.5,
      GRAVITY * 2.35
    ) * s.groundEffectFactor;

    // 5. Turbulent air buffeting (realistic jitter in high wind / storm)
    const turb = this.weather.getConfig().turbulence;
    const tNow = s.flightTimeSec;
    const buffetAx = turb * Math.sin(tNow * 7.3) * 1.35;
    const buffetAz = turb * Math.cos(tNow * 6.1) * 1.35;
    const buffetAy = turb * Math.sin(tNow * 8.9) * 0.85;

    // 6. Total world acceleration
    const totalAx = ctrlAx + dragAx + buffetAx;
    const totalAz = ctrlAz + dragAz + buffetAz;
    const totalAy = thrustAccelY - GRAVITY + dragAy + buffetAy;

    // Integrate velocity & position
    s.velocity.x += totalAx * dt;
    s.velocity.y += totalAy * dt;
    s.velocity.z += totalAz * dt;

    // Enforce realistic ceiling (500m DJI max altitude limit) & horizontal geofence (320m)
    const maxAltitudeY = s.homePosition.y + 180;
    if (s.position.y > maxAltitudeY && s.velocity.y > 0) {
      s.velocity.y = 0;
    }

    s.position.x += s.velocity.x * dt;
    s.position.y += s.velocity.y * dt;
    s.position.z += s.velocity.z * dt;

    // Geofence soft boundary
    const maxRadius = 310;
    const distCenter = Math.hypot(s.position.x, s.position.z);
    if (distCenter > maxRadius) {
      s.position.x = (s.position.x / distCenter) * maxRadius;
      s.position.z = (s.position.z / distCenter) * maxRadius;
    }

    // 7. Compute realistic visual Pitch & Roll from thrust vector!
    // In a real quadcopter, horizontal acceleration comes from tilting the thrust vector.
    // Transform ctrlA into body frame (forward, right)
    const fwdX = -Math.sin(s.yaw);
    const fwdZ = -Math.cos(s.yaw);
    const rightX = Math.cos(s.yaw);
    const rightZ = -Math.sin(s.yaw);

    const bodyFwdAccel = ctrlAx * fwdX + ctrlAz * fwdZ;
    const bodyRightAccel = ctrlAx * rightX + ctrlAz * rightZ;

    // Nose pitches down (negative X rotation) to accelerate forward
    const targetPitch = clamp(-Math.atan2(bodyFwdAccel, GRAVITY), -maxTiltRad, maxTiltRad);
    // Right side tilts down (negative Z rotation) to accelerate right
    const targetRoll = clamp(-Math.atan2(bodyRightAccel, GRAVITY), -maxTiltRad, maxTiltRad);

    // Subtle turbulence tilt micro-shake
    const shakePitch = turb * Math.sin(tNow * 11.4) * 0.035;
    const shakeRoll = turb * Math.cos(tNow * 9.8) * 0.035;

    const tiltSmooth = modeCfg.id === 'sport' ? 12.5 : modeCfg.id === 'cine' ? 5.5 : 8.5;
    const prevPitch = s.pitch;
    const prevRoll = s.roll;
    s.pitch = lerp(s.pitch, targetPitch + shakePitch, dt * tiltSmooth);
    s.roll = lerp(s.roll, targetRoll + shakeRoll, dt * tiltSmooth);
    s.angularVelocity.x = (s.pitch - prevPitch) / dt;
    s.angularVelocity.z = (s.roll - prevRoll) / dt;

    // 8. Compute individual 4-motor thrust & RPM distribution (FL, FR, RL, RR)
    const totalThrustNorm = clamp(
      Math.hypot(ctrlAx, thrustAccelY, ctrlAz) / (GRAVITY * 2.15),
      0.16,
      1.0
    );
    const pMix = -targetPitch * 0.16;
    const rMix = -targetRoll * 0.16;
    const yMix = s.angularVelocity.y * 0.05;

    const motors: [number, number, number, number] = [
      clamp(totalThrustNorm - pMix + rMix - yMix, 0.14, 1.0), // FL
      clamp(totalThrustNorm - pMix - rMix + yMix, 0.14, 1.0), // FR
      clamp(totalThrustNorm + pMix + rMix + yMix, 0.14, 1.0), // RL
      clamp(totalThrustNorm + pMix - rMix - yMix, 0.14, 1.0), // RR
    ];

    for (let i = 0; i < 4; i++) {
      s.motorThrottle[i] = lerp(s.motorThrottle[i], motors[i], dt * 14);
      const targetRPM = IDLE_MOTOR_RPM + s.motorThrottle[i] * (MAX_MOTOR_RPM - IDLE_MOTOR_RPM);
      s.motorRPM[i] = lerp(s.motorRPM[i], targetRPM, dt * 12);
    }

    // 9. Ground & Obstacle Collisions
    const newFloorY = getGroundOrWaterHeight(s.position.x, s.position.z) + DRONE_GEAR_HEIGHT;
    if (s.position.y <= newFloorY) {
      s.position.y = newFloorY;
      // Prevent sinking into water — keep hovering slightly above water if over lake unless landing on land
      const terrainH = getTerrainHeight(s.position.x, s.position.z);
      if (terrainH < WATER_LEVEL) {
        s.position.y = WATER_LEVEL + 0.35;
        s.velocity.y = Math.max(0.2, s.velocity.y);
      } else {
        if (s.velocity.y < -1.8) {
          // Firm bounce damped
          s.velocity.y = -s.velocity.y * 0.18;
        } else {
          s.velocity.y = 0;
        }
        s.velocity.x *= 0.72;
        s.velocity.z *= 0.72;
      }
    }

    this.resolveObstacleCollisions();
  }

  private touchdown(floorY: number): boolean {
    const s = this.state;
    const terrainH = getTerrainHeight(s.position.x, s.position.z);
    if (terrainH < WATER_LEVEL) {
      // Safety: do not land on water! Switch back to hover
      s.flightPhase = 'FLYING';
      s.position.y = WATER_LEVEL + 0.8;
      s.velocity.y = 0.5;
      return false;
    }
    s.position.y = floorY;
    s.velocity = { x: 0, y: 0, z: 0 };
    s.flightPhase = 'GROUNDED';
    s.motorsArmed = false;
    this.onEvent?.('land');
    return true;
  }

  private resolveObstacleCollisions(): void {
    const s = this.state;
    for (const obs of this.obstacles) {
      if (s.position.y > obs.y + obs.height + DRONE_RADIUS || s.position.y < obs.y - 0.5) {
        continue;
      }
      if (obs.type === 'cylinder') {
        const dx = s.position.x - obs.x;
        const dz = s.position.z - obs.z;
        const dist = Math.hypot(dx, dz);
        const minR = obs.width * 0.5 + DRONE_RADIUS;
        if (dist < minR && dist > 0.001) {
          const nx = dx / dist;
          const nz = dz / dist;
          s.position.x = obs.x + nx * minR;
          s.position.z = obs.z + nz * minR;
          // Bounce velocity outward
          const dot = s.velocity.x * nx + s.velocity.z * nz;
          if (dot < 0) {
            s.velocity.x -= 1.4 * dot * nx;
            s.velocity.z -= 1.4 * dot * nz;
          }
        }
      } else {
        const halfW = obs.width * 0.5 + DRONE_RADIUS;
        const halfD = obs.depth * 0.5 + DRONE_RADIUS;
        const dx = s.position.x - obs.x;
        const dz = s.position.z - obs.z;
        if (Math.abs(dx) < halfW && Math.abs(dz) < halfD) {
          const overlapX = halfW - Math.abs(dx);
          const overlapZ = halfD - Math.abs(dz);
          if (overlapX < overlapZ) {
            s.position.x += dx >= 0 ? overlapX : -overlapX;
            s.velocity.x *= -0.35;
          } else {
            s.position.z += dz >= 0 ? overlapZ : -overlapZ;
            s.velocity.z *= -0.35;
          }
        }
      }
    }
  }

  private computeObstacleSensors(pos: Vec3, yaw: number, agl: number): ObstacleSensorData {
    const maxRange = 18;
    let front = Infinity;
    let back = Infinity;
    let left = Infinity;
    let right = Infinity;

    const fwdX = -Math.sin(yaw);
    const fwdZ = -Math.cos(yaw);
    const rightX = Math.cos(yaw);
    const rightZ = -Math.sin(yaw);

    for (const obs of this.obstacles) {
      if (pos.y > obs.y + obs.height + 1.2 || pos.y < obs.y - 1.0) continue;
      const dx = obs.x - pos.x;
      const dz = obs.z - pos.z;
      const approxRadius = Math.max(obs.width, obs.depth) * 0.5;
      const centerDist = Math.hypot(dx, dz);
      const surfaceDist = Math.max(0.2, centerDist - approxRadius - DRONE_RADIUS);
      if (surfaceDist > maxRange) continue;

      const localFwd = dx * fwdX + dz * fwdZ;
      const localRight = dx * rightX + dz * rightZ;

      if (Math.abs(localFwd) >= Math.abs(localRight)) {
        if (localFwd > 0) front = Math.min(front, surfaceDist);
        else back = Math.min(back, surfaceDist);
      } else {
        if (localRight > 0) right = Math.min(right, surfaceDist);
        else left = Math.min(left, surfaceDist);
      }
    }

    const closest = Math.min(front, back, left, right);
    return {
      front,
      back,
      left,
      right,
      down: agl,
      closest,
      warningActive: closest < 9.0,
    };
  }

  private updateBattery(dt: number, modeCfg: (typeof FLIGHT_MODES)[FlightMode]): void {
    const s = this.state;
    const avgThrottle =
      (s.motorThrottle[0] + s.motorThrottle[1] + s.motorThrottle[2] + s.motorThrottle[3]) * 0.25;

    // Power draw in Watts: idle electronics ~3W, hover ~32W, Sport full climb ~78W
    const powerW = s.motorsArmed
      ? (4.0 + Math.pow(avgThrottle * 1.45, 2.3) * 48.0) * modeCfg.powerMultiplier
      : 2.8;

    // Slight time-scale acceleration (2.2x) so battery behavior is tangible during a 5–10 min session
    const whConsumed = (powerW * dt * 2.2) / 3600;
    const pctDrop = (whConsumed / BATTERY_CAPACITY_WH) * 100;
    s.batteryPercent = clamp(s.batteryPercent - pctDrop, 0, 100);

    // 2S LiPo discharge curve + load voltage sag
    const restingVoltage = 6.6 + (s.batteryPercent / 100) * 1.78;
    const currentA = powerW / Math.max(6.4, restingVoltage);
    const voltageSag = currentA * 0.032; // internal resistance ~32 mOhm
    s.batteryCurrentA = currentA;
    s.batteryVoltage = clamp(restingVoltage - voltageSag, 6.2, 8.4);

    // Estimated remaining minutes
    const remainingWh = (s.batteryPercent / 100) * BATTERY_CAPACITY_WH;
    s.estimatedFlightMin = Math.max(0, Math.round((remainingWh / Math.max(18, powerW)) * 60));
  }

  private updateCheckpoints(): void {
    const s = this.state;
    if (s.flightPhase === 'GROUNDED') return;
    for (const cp of this.checkpoints) {
      if (cp.cleared) continue;
      const dist = Math.hypot(s.position.x - cp.x, s.position.y - cp.y, s.position.z - cp.z);
      if (dist < cp.radius + 0.8) {
        cp.cleared = true;
        s.checkpointsCleared = this.checkpoints.filter((c) => c.cleared).length;
        this.onEvent?.('checkpoint');
      }
    }
  }

  private computeWarnings(rainIntensity: number): DroneWarning[] {
    const s = this.state;
    const warnings: DroneWarning[] = [];

    if (s.flightMode === 'sport') {
      warnings.push({
        id: 'sport-obs',
        level: 'caution',
        message: 'SPORT MODE — Engel Algılama Devre Dışı',
      });
    } else if (s.flightMode === 'atti') {
      warnings.push({
        id: 'atti-gps',
        level: 'danger',
        message: 'ATTI MODE — GPS Sabitleme Yok, Manuel Uçuş',
      });
    }

    if (s.windSpeedAtDrone > MAX_WIND_RESISTANCE_MS) {
      warnings.push({
        id: 'high-wind',
        level: 'danger',
        message: `YÜKSEK RÜZGAR UYARISI (${s.windSpeedAtDrone.toFixed(1)} m/s) — Dikkatli Uçun`,
      });
    } else if (s.windSpeedAtDrone > 8.0) {
      warnings.push({
        id: 'med-wind',
        level: 'caution',
        message: `Şiddetli Rüzgar (${s.windSpeedAtDrone.toFixed(1)} m/s)`,
      });
    }

    if (rainIntensity > 0.45 && s.flightPhase !== 'GROUNDED') {
      warnings.push({
        id: 'rain',
        level: 'caution',
        message: 'Yağış Algılandı — Gimbal & Sensör Görüşü Azaldı',
      });
    }

    if (s.obstacles.warningActive && s.flightPhase === 'FLYING') {
      warnings.push({
        id: 'obs-close',
        level: s.obstacles.closest < 4.5 ? 'danger' : 'caution',
        message: `Engel Yakın (${s.obstacles.closest.toFixed(1)}m)`,
      });
    }

    if (s.batteryPercent <= 12) {
      warnings.push({
        id: 'crit-batt',
        level: 'danger',
        message: 'KRİTİK BATARYA — Acil İniş Gerekli!',
      });
    } else if (s.batteryPercent <= 25) {
      warnings.push({
        id: 'low-batt',
        level: 'caution',
        message: 'Düşük Batarya — Eve Dönüş (RTH) Önerilir',
      });
    }

    if (s.flightPhase.startsWith('RTH_')) {
      warnings.push({
        id: 'rth-active',
        level: 'info',
        message: 'Eve Dönüş (RTH) Aktif — İptal için kumandaya dokunun',
      });
    }

    return warnings;
  }
}

export { BASE_HOVER_RPM, MAX_MOTOR_RPM, MAX_WIND_RESISTANCE_MS };
