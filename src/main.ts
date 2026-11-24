import './styles/hud.css';
import { CameraMode, FlightMode, WeatherPreset } from './types/simulation';
import { WeatherEngine } from './simulation/weather';
import { createCheckpointRings, createWorldObstacles } from './simulation/terrain';
import { DronePhysicsEngine } from './simulation/physics';
import { SimScene } from './scene/simScene';
import { DroneAudioEngine } from './audio/droneAudio';
import { RCInputManager } from './controls/rcInput';
import { DroneHUD } from './ui/hud';

function bootstrap(): void {
  const canvas = document.getElementById('sim-canvas') as HTMLCanvasElement;
  const hudRoot = document.getElementById('hud-root') as HTMLElement;

  // 1. Core Simulation Systems
  const weather = new WeatherEngine('clear');
  const obstacles = createWorldObstacles();
  const checkpoints = createCheckpointRings();
  const audio = new DroneAudioEngine();

  weather.onThunder = () => {
    audio.playTone('thunder');
  };

  const physics = new DronePhysicsEngine(weather, obstacles, checkpoints, (evt) => {
    if (evt === 'takeoff') audio.playTone('takeoff');
    else if (evt === 'land') audio.playTone('land');
    else if (evt === 'mode') audio.playTone('mode');
    else if (evt === 'checkpoint') audio.playTone('checkpoint');
    else if (evt === 'rth') audio.playTone('rth');
  });

  // 2. 3D Scene & Renderer
  const simScene = new SimScene(canvas, obstacles, checkpoints);
  const cameraOrder: CameraMode[] = ['chase', 'gimbal', 'los', 'orbit'];

  let hud!: DroneHUD;

  const setMode = (mode: FlightMode) => {
    physics.setFlightMode(mode);
    hud.syncModeUI(mode);
  };

  const setWeather = (preset: WeatherPreset) => {
    weather.setPreset(preset);
    hud.syncWeatherUI(weather.getConfig());
  };

  const setCamera = (cam: CameraMode) => {
    simScene.setCameraMode(cam);
    hud.syncCameraUI(cam);
  };

  const cycleCamera = () => {
    const idx = cameraOrder.indexOf(simScene.cameraMode);
    setCamera(cameraOrder[(idx + 1) % cameraOrder.length]);
  };

  const capturePhoto = () => {
    audio.unlock();
    audio.playTone('shutter');
    hud.flashShutter();
    const url = simScene.capturePhotoDataUrl();
    const a = document.createElement('a');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    a.href = url;
    a.download = `DJI_Mini5Pro_${stamp}.png`;
    a.click();
  };

  // 3. RC Input Manager (Keyboard + Virtual Sticks + Physical USB Gamepad)
  const rcInput = new RCInputManager({
    onModeSelect: setMode,
    onTakeoffLand: () => physics.toggleTakeoffLand(),
    onRTH: () => physics.toggleRTH(),
    onCycleCamera: cycleCamera,
    onPhoto: capturePhoto,
    onToggleRecord: () => {
      audio.unlock();
      audio.playTone('mode');
      physics.toggleRecording();
    },
    onFirstInteraction: () => audio.unlock(),
  });

  // 4. DJI Fly HUD & RC 2 Interface
  hud = new DroneHUD(hudRoot, {
    onSelectMode: setMode,
    onSelectWeather: setWeather,
    onCustomWindChange: (speed, dirDeg) => {
      weather.setCustomWind(speed, dirDeg);
    },
    onTakeoffLand: () => {
      audio.unlock();
      physics.toggleTakeoffLand();
    },
    onRTH: () => {
      audio.unlock();
      physics.toggleRTH();
    },
    onBrakeChange: (active) => rcInput.setVirtualBrake(active),
    onSelectCamera: setCamera,
    onGimbalPitchChange: (deg) => physics.setGimbalPitch(deg),
    onPhoto: capturePhoto,
    onToggleRecord: () => {
      audio.unlock();
      audio.playTone('mode');
      physics.toggleRecording();
    },
    onToggleMute: () => {
      audio.unlock();
      audio.setMuted(!audio.muted);
      hud.syncMuteUI(audio.muted);
    },
    onResetDrone: () => {
      physics.resetToHome();
      hud.syncModeUI(physics.state.flightMode);
    },
    onRechargeBattery: () => {
      physics.rechargeBattery();
      audio.playTone('mode');
    },
    onLeftStick: (x, y) => rcInput.setVirtualLeftStick(x, y),
    onRightStick: (x, y) => rcInput.setVirtualRightStick(x, y),
  });

  // Sync initial UI state
  hud.syncModeUI(physics.state.flightMode);
  hud.syncWeatherUI(weather.getConfig());
  hud.syncCameraUI(simScene.cameraMode);
  hud.syncMuteUI(audio.muted);

  // 5. Main 60 FPS Simulation Loop
  let lastTime = performance.now();
  let elapsed = 0;

  const tick = (now: number) => {
    requestAnimationFrame(tick);
    const dt = Math.min((now - lastTime) / 1000, 0.05);
    lastTime = now;
    elapsed += dt;

    // Sample inputs
    const rc = rcInput.sample(dt);

    // Step weather & 6-DOF drone physics
    weather.update(dt);
    physics.step(dt, rc);

    const weatherCfg = weather.getConfig();

    // Render 3D scene
    simScene.render(
      physics.state,
      weatherCfg,
      weather.lightningFlash,
      physics.checkpoints,
      dt,
      elapsed
    );

    // Update synthesized audio
    audio.update(physics.state, weatherCfg, simScene.cameraMode);

    // Update HUD telemetry & animated RC sticks
    hud.update(physics.state, rc, weatherCfg, rcInput.gamepadConnected);
  };

  requestAnimationFrame(tick);
}

bootstrap();
