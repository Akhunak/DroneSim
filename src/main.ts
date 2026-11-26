import './styles/hud.css';
import { CameraMode, FlightMode, SceneId, WeatherPreset } from './types/simulation';
import { WeatherEngine } from './simulation/weather';
import {
  createCheckpointRings,
  createWorldObstacles,
  setActiveScene,
} from './simulation/terrain';
import { DronePhysicsEngine } from './simulation/physics';
import { SimScene } from './scene/simScene';
import { DroneAudioEngine } from './audio/droneAudio';
import { RCInputManager } from './controls/rcInput';
import { DroneHUD } from './ui/hud';
import { MainMenu } from './ui/mainMenu';

function bootstrap(): void {
  const canvas = document.getElementById('sim-canvas') as HTMLCanvasElement;
  const hudRoot = document.getElementById('hud-root') as HTMLElement;
  const appRoot = document.getElementById('app') as HTMLElement;

  let currentSceneId: SceneId = 'mountain';
  setActiveScene(currentSceneId);

  // 1. Core Simulation Systems
  const weather = new WeatherEngine('clear');
  const obstacles = createWorldObstacles(currentSceneId);
  const checkpoints = createCheckpointRings(currentSceneId);
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
    else if (evt === 'crash') audio.playTone(physics.state.crashReason === 'water' ? 'splash' : 'crash');
  });

  // 2. 3D Scene & Renderer
  const simScene = new SimScene(canvas, currentSceneId, obstacles, checkpoints);
  const cameraOrder: CameraMode[] = ['chase', 'gimbal', 'los', 'orbit'];

  let hud!: DroneHUD;
  let menu!: MainMenu;
  /** Flight inputs are ignored while the main menu or any popup is on screen. */
  const inputLocked = () => menu.isOpen || hud.isModalOpen;

  const applyScene = (sceneId: SceneId) => {
    if (sceneId === currentSceneId) return;
    currentSceneId = sceneId;
    setActiveScene(sceneId);
    const nextObstacles = createWorldObstacles(sceneId);
    const nextCheckpoints = createCheckpointRings(sceneId);
    physics.loadWorld(sceneId, nextObstacles, nextCheckpoints);
    simScene.switchScene(sceneId, nextObstacles, nextCheckpoints);
    hud.syncSceneUI(sceneId);
    hud.syncModeUI(physics.state.flightMode);
    menu.syncScene(sceneId);
  };

  const setMode = (mode: FlightMode) => {
    physics.setFlightMode(mode);
    hud.syncModeUI(mode);
    menu.syncMode(mode);
  };

  const setWeather = (preset: WeatherPreset) => {
    weather.setPreset(preset);
    hud.syncWeatherUI(weather.getConfig());
    menu.syncWeather(preset);
  };

  const setCamera = (cam: CameraMode) => {
    simScene.setCameraMode(cam);
    hud.syncCameraUI(cam);
    menu.syncCamera(cam);
  };

  const toggleMute = () => {
    audio.unlock();
    audio.setMuted(!audio.muted);
    hud.syncMuteUI(audio.muted);
    menu.syncMute(audio.muted);
  };

  const openMainMenu = () => {
    appRoot.classList.add('menu-active');
    simScene.setShowcase(true);
    menu.open();
  };

  const startSimulation = () => {
    audio.unlock();
    menu.close();
    appRoot.classList.remove('menu-active');
    simScene.setShowcase(false);
    audio.playTone('takeoff');
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
    a.download = `DJI_Mini5Pro_${currentSceneId}_${stamp}.png`;
    a.click();
  };

  // 3. RC Input Manager (Keyboard + Virtual Sticks + Physical USB Gamepad)
  const rcInput = new RCInputManager({
    onModeSelect: (mode) => {
      if (!inputLocked()) setMode(mode);
    },
    onTakeoffLand: () => {
      if (!inputLocked()) physics.toggleTakeoffLand();
    },
    onRTH: () => {
      if (!inputLocked()) physics.toggleRTH();
    },
    onCycleCamera: () => {
      if (!inputLocked()) cycleCamera();
    },
    onPhoto: () => {
      if (!inputLocked()) capturePhoto();
    },
    onToggleRecord: () => {
      if (inputLocked()) return;
      audio.unlock();
      audio.playTone('mode');
      physics.toggleRecording();
    },
    onFirstInteraction: () => audio.unlock(),
  });

  // 4. DJI Fly HUD & RC 2 Interface
  hud = new DroneHUD(hudRoot, {
    onSelectScene: (sceneId) => {
      audio.unlock();
      audio.playTone('mode');
      applyScene(sceneId);
    },
    onStartFlightFromModal: (sceneId) => {
      audio.unlock();
      applyScene(sceneId);
      audio.playTone('takeoff');
    },
    onSceneMenuDone: (sceneId) => {
      applyScene(sceneId);
      menu.focusItem('start');
    },
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
    onToggleMute: toggleMute,
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
    onCrashAcknowledged: () => {
      audio.unlock();
      physics.resetToHome();
      simScene.resetCamera();
      hud.syncModeUI(physics.state.flightMode);
    },
  });

  // 5. Startup Main Menu (Simülasyonu Başlat / Sahneler / Seçenekler)
  menu = new MainMenu(appRoot, {
    onStart: startSimulation,
    onOpenScenes: () => {
      audio.playTone('mode');
      hud.openSceneModal(true);
    },
    onSelectWeather: setWeather,
    onSelectMode: setMode,
    onSelectCamera: setCamera,
    onToggleMute: toggleMute,
    onFirstInteraction: () => audio.unlock(),
    isCovered: () => hud.isModalOpen,
  });

  // Sync initial UI state
  hud.syncSceneUI(currentSceneId);
  hud.syncModeUI(physics.state.flightMode);
  hud.syncWeatherUI(weather.getConfig());
  hud.syncCameraUI(simScene.cameraMode);
  hud.syncMuteUI(audio.muted);
  menu.syncScene(currentSceneId);
  menu.syncWeather(weather.getConfig().id);
  menu.syncMode(physics.state.flightMode);
  menu.syncCamera(simScene.cameraMode);
  menu.syncMute(audio.muted);
  openMainMenu();

  const neutralInput = {
    throttle: 0,
    yaw: 0,
    pitch: 0,
    roll: 0,
    gimbalPitchDelta: 0,
    brake: false,
  };

  // 6. Main 60 FPS Simulation Loop
  let lastTime = performance.now();
  let elapsed = 0;

  const tick = (now: number) => {
    requestAnimationFrame(tick);
    const dt = Math.min((now - lastTime) / 1000, 0.05);
    lastTime = now;
    elapsed += dt;

    // Sample inputs (lock sticks to neutral while the main menu or a popup is open)
    const rc = inputLocked() ? neutralInput : rcInput.sample(dt);

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
