import { FlightMode, RCInput } from '../types/simulation';

export interface RCActionCallbacks {
  onModeSelect: (mode: FlightMode) => void;
  onTakeoffLand: () => void;
  onRTH: () => void;
  onCycleCamera: () => void;
  onPhoto: () => void;
  onToggleRecord: () => void;
  onFirstInteraction: () => void;
}

/**
 * Unifies Keyboard, On-Screen Virtual DJI RC 2 Joysticks, and Physical USB Gamepad/RC Controllers
 * using standard Mode 2 RC Stick Mapping:
 *   Left Stick:  Y = Throttle (Up/Down), X = Yaw (Rotate Left/Right)
 *   Right Stick: Y = Pitch (Forward/Backward), X = Roll (Strafe Left/Right)
 */
export class RCInputManager {
  private keys = new Set<string>();
  private virtualLeft = { x: 0, y: 0 }; // yaw, throttle
  private virtualRight = { x: 0, y: 0 }; // roll, pitch
  private virtualGimbalDelta = 0;
  private virtualBrake = false;
  private callbacks: RCActionCallbacks;

  // Smoothed stick outputs for buttery keyboard feel
  public current: RCInput = {
    throttle: 0,
    yaw: 0,
    pitch: 0,
    roll: 0,
    gimbalPitchDelta: 0,
    brake: false,
  };
  public gamepadConnected = false;
  public gamepadName = '';

  constructor(callbacks: RCActionCallbacks) {
    this.callbacks = callbacks;
    this.bindKeyboard();
  }

  private bindKeyboard(): void {
    window.addEventListener('keydown', (e) => {
      this.callbacks.onFirstInteraction();
      // Ignore shortcuts if user is focused on an input range/slider
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      const code = e.code;
      if (
        code === 'ArrowUp' ||
        code === 'ArrowDown' ||
        code === 'ArrowLeft' ||
        code === 'ArrowRight' ||
        code === 'Space'
      ) {
        e.preventDefault();
      }

      if (!e.repeat) {
        if (code === 'Digit1') this.callbacks.onModeSelect('cine');
        else if (code === 'Digit2') this.callbacks.onModeSelect('normal');
        else if (code === 'Digit3') this.callbacks.onModeSelect('sport');
        else if (code === 'Digit4') this.callbacks.onModeSelect('atti');
        else if (code === 'Space') this.callbacks.onTakeoffLand();
        else if (code === 'KeyH') this.callbacks.onRTH();
        else if (code === 'KeyC') this.callbacks.onCycleCamera();
        else if (code === 'KeyP') this.callbacks.onPhoto();
        else if (code === 'KeyV') this.callbacks.onToggleRecord();
      }

      this.keys.add(code);
    });

    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
    });

    window.addEventListener('blur', () => {
      this.keys.clear();
    });

    window.addEventListener('pointerdown', () => {
      this.callbacks.onFirstInteraction();
    });
  }

  public setVirtualLeftStick(x: number, y: number): void {
    this.virtualLeft.x = Math.max(-1, Math.min(1, x));
    this.virtualLeft.y = Math.max(-1, Math.min(1, y));
  }

  public setVirtualRightStick(x: number, y: number): void {
    this.virtualRight.x = Math.max(-1, Math.min(1, x));
    this.virtualRight.y = Math.max(-1, Math.min(1, y));
  }

  public setVirtualGimbalDelta(delta: number): void {
    this.virtualGimbalDelta = delta;
  }

  public setVirtualBrake(active: boolean): void {
    this.virtualBrake = active;
  }

  public sample(dt: number): RCInput {
    // 1. Keyboard axes
    const kbThrottle = (this.keys.has('KeyW') ? 1 : 0) - (this.keys.has('KeyS') ? 1 : 0);
    const kbYaw = (this.keys.has('KeyD') ? 1 : 0) - (this.keys.has('KeyA') ? 1 : 0);
    const kbPitch = (this.keys.has('ArrowUp') ? 1 : 0) - (this.keys.has('ArrowDown') ? 1 : 0);
    const kbRoll = (this.keys.has('ArrowRight') ? 1 : 0) - (this.keys.has('ArrowLeft') ? 1 : 0);
    const kbGimbal = (this.keys.has('KeyR') ? 1 : 0) - (this.keys.has('KeyF') ? 1 : 0);
    const kbBrake = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || this.keys.has('KeyB');

    // 2. Physical Gamepad / USB RC Controller polling
    let gpThrottle = 0;
    let gpYaw = 0;
    let gpPitch = 0;
    let gpRoll = 0;
    let gpGimbal = 0;
    let foundGp = false;

    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const pad of pads) {
      if (!pad) continue;
      foundGp = true;
      this.gamepadName = pad.id;
      const deadzone = (v: number) => (Math.abs(v) < 0.08 ? 0 : (v - Math.sign(v) * 0.08) / 0.92);
      gpYaw = deadzone(pad.axes[0] ?? 0);
      gpThrottle = -deadzone(pad.axes[1] ?? 0);
      gpRoll = deadzone(pad.axes[2] ?? 0);
      gpPitch = -deadzone(pad.axes[3] ?? 0);
      const l2 = pad.buttons[6]?.value ?? 0;
      const r2 = pad.buttons[7]?.value ?? 0;
      gpGimbal = r2 - l2;
      break;
    }
    this.gamepadConnected = foundGp;

    // Combine sources (strongest magnitude wins smoothly)
    const pick = (a: number, b: number, c: number) => {
      if (Math.abs(b) > 0.02) return b; // Virtual touch/mouse joystick
      if (Math.abs(c) > 0.02) return c; // Physical gamepad
      return a; // Keyboard
    };

    const rawThrottle = pick(kbThrottle, this.virtualLeft.y, gpThrottle);
    const rawYaw = pick(kbYaw, this.virtualLeft.x, gpYaw);
    const rawPitch = pick(kbPitch, this.virtualRight.y, gpPitch);
    const rawRoll = pick(kbRoll, this.virtualRight.x, gpRoll);
    const rawGimbal = pick(kbGimbal, this.virtualGimbalDelta, gpGimbal);

    // Smooth keyboard step response so the sticks feel spring-loaded like a real DJI RC 2
    const lerpRate = Math.min(1, dt * 14);
    this.current.throttle += (rawThrottle - this.current.throttle) * lerpRate;
    this.current.yaw += (rawYaw - this.current.yaw) * lerpRate;
    this.current.pitch += (rawPitch - this.current.pitch) * lerpRate;
    this.current.roll += (rawRoll - this.current.roll) * lerpRate;
    this.current.gimbalPitchDelta = rawGimbal;
    this.current.brake = kbBrake || this.virtualBrake;

    // Clean tiny float residue
    if (Math.abs(this.current.throttle) < 0.004) this.current.throttle = 0;
    if (Math.abs(this.current.yaw) < 0.004) this.current.yaw = 0;
    if (Math.abs(this.current.pitch) < 0.004) this.current.pitch = 0;
    if (Math.abs(this.current.roll) < 0.004) this.current.roll = 0;

    return this.current;
  }
}
