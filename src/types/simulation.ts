export type SceneId = 'mountain' | 'city';

export type FlightMode = 'cine' | 'normal' | 'sport' | 'atti';

export type WeatherPreset = 'clear' | 'windy' | 'rainy' | 'foggy' | 'stormy' | 'sunset';

export type CameraMode = 'chase' | 'gimbal' | 'los' | 'orbit';

export type FlightPhase =
  | 'GROUNDED'
  | 'ARMING'
  | 'TAKING_OFF'
  | 'FLYING'
  | 'LANDING'
  | 'RTH_ASCEND'
  | 'RTH_RETURN'
  | 'RTH_LAND';

export interface FlightModeConfig {
  id: FlightMode;
  code: string;
  label: string;
  shortLabel: string;
  description: string;
  accentColor: string;
  maxHorizontalSpeed: number; // m/s
  maxAscentSpeed: number; // m/s
  maxDescentSpeed: number; // m/s
  maxTiltDeg: number; // degrees
  yawRateDeg: number; // deg/s
  horizontalResponsiveness: number; // PID velocity tracking gain
  brakingStrength: number; // aerodynamic + active GPS braking
  gimbalSmoothness: number;
  gpsHold: boolean;
  obstacleAvoidance: boolean;
  powerMultiplier: number;
}

export interface WeatherConfig {
  id: WeatherPreset;
  label: string;
  description: string;
  windSpeed: number; // base m/s
  windDirectionDeg: number; // degrees from North (where wind blows FROM)
  gustStrength: number; // additional gust amplitude m/s
  turbulence: number; // 0..1 vertical/rotational turbulence
  rainIntensity: number; // 0..1
  fogDensity: number; // Three.js FogExp2 density
  cloudCoverage: number; // 0..1
  lightning: boolean;
  skyTopColor: string;
  skyHorizonColor: string;
  fogColor: string;
  sunColor: string;
  sunIntensity: number;
  ambientColor: string;
  ambientIntensity: number;
  sunElevationDeg: number;
  sunAzimuthDeg: number;
}

export interface RCInput {
  throttle: number; // -1..1 (Left stick Y)
  yaw: number; // -1..1 (Left stick X)
  pitch: number; // -1..1 (Right stick Y, +1 forward)
  roll: number; // -1..1 (Right stick X, +1 right)
  gimbalPitchDelta: number; // -1..1
  brake: boolean;
}

export interface ObstacleSensorData {
  front: number; // meters (Infinity if clear)
  back: number;
  left: number;
  right: number;
  down: number;
  closest: number;
  warningActive: boolean;
}

export interface DroneWarning {
  id: string;
  level: 'info' | 'caution' | 'danger';
  message: string;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface DroneState {
  position: Vec3;
  velocity: Vec3;
  // Euler orientation (radians): yaw (Y), pitch (X, nose down negative/positive), roll (Z)
  yaw: number;
  pitch: number;
  roll: number;
  angularVelocity: Vec3;
  gimbalPitchDeg: number; // -90 (straight down) to +60 (up)
  gimbalYawOffsetDeg: number;
  motorRPM: [number, number, number, number]; // FL, FR, RL, RR
  motorThrottle: [number, number, number, number]; // 0..1
  motorsArmed: boolean;
  flightPhase: FlightPhase;
  flightMode: FlightMode;
  homePosition: Vec3;
  rthAltitude: number;
  altitudeAGL: number;
  altitudeHome: number;
  distanceFromHome: number;
  horizontalSpeed: number;
  verticalSpeed: number;
  airspeed: number;
  headingDeg: number;
  batteryPercent: number; // 0..100
  batteryVoltage: number; // Volts (2S LiPo ~6.6V - 8.4V)
  batteryCurrentA: number;
  estimatedFlightMin: number;
  satellites: number;
  rcSignal: number; // 0..5
  windAtDrone: Vec3;
  windSpeedAtDrone: number;
  windDirectionDeg: number;
  groundEffectFactor: number;
  obstacles: ObstacleSensorData;
  warnings: DroneWarning[];
  checkpointsCleared: number;
  totalCheckpoints: number;
  flightTimeSec: number;
  isRecording: boolean;
  recordingSec: number;
}

export interface WorldObstacle {
  id: string;
  type: 'box' | 'cylinder';
  x: number;
  y: number; // base Y
  z: number;
  width: number; // diameter for cylinder
  height: number;
  depth: number;
}

export interface CheckpointRing {
  id: number;
  x: number;
  y: number;
  z: number;
  radius: number;
  rotationY: number;
  cleared: boolean;
}
