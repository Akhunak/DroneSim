import { CameraMode, DroneState, WeatherConfig } from '../types/simulation';

/**
 * Procedural Web Audio synthesizer for DJI Mini 5 Pro motors, airflow, wind, rain, thunder, and DJI RC chimes.
 */
export class DroneAudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private motorOscs: OscillatorNode[] = [];
  private motorGain: GainNode | null = null;
  private motorFilter: BiquadFilterNode | null = null;

  private windGain: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;

  private rainGain: GainNode | null = null;
  private isInitialized = false;
  public muted = false;

  public unlock(): void {
    if (this.isInitialized) {
      if (this.ctx && this.ctx.state === 'suspended') {
        void this.ctx.resume();
      }
      return;
    }

    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;

    this.ctx = new AudioCtx();
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = this.muted ? 0 : 0.48;
    this.masterGain.connect(this.ctx.destination);

    // 1. Quadcopter 4-Rotor Harmonic Synth
    this.motorFilter = this.ctx.createBiquadFilter();
    this.motorFilter.type = 'bandpass';
    this.motorFilter.frequency.value = 420;
    this.motorFilter.Q.value = 1.6;

    const motorLowpass = this.ctx.createBiquadFilter();
    motorLowpass.type = 'lowpass';
    motorLowpass.frequency.value = 1850;

    this.motorGain = this.ctx.createGain();
    this.motorGain.gain.value = 0;

    this.motorFilter.connect(motorLowpass);
    motorLowpass.connect(this.motorGain);
    this.motorGain.connect(this.masterGain);

    // Slightly detuned oscillators simulate 4 independent brushless rotors beating together
    const detunes = [0.985, 1.0, 1.018, 2.005];
    const types: OscillatorType[] = ['sawtooth', 'triangle', 'sawtooth', 'triangle'];
    for (let i = 0; i < 4; i++) {
      const osc = this.ctx.createOscillator();
      osc.type = types[i];
      osc.frequency.value = 140 * detunes[i];
      const g = this.ctx.createGain();
      g.gain.value = i === 3 ? 0.14 : 0.22;
      osc.connect(g);
      g.connect(this.motorFilter);
      osc.start();
      this.motorOscs.push(osc);
    }

    // 2. Shared Filtered White Noise Buffer for Wind + Rain
    const bufferSize = this.ctx.sampleRate * 2;
    const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    // Wind rush noise
    const windSrc = this.ctx.createBufferSource();
    windSrc.buffer = noiseBuffer;
    windSrc.loop = true;

    this.windFilter = this.ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 320;
    this.windFilter.Q.value = 0.9;

    this.windGain = this.ctx.createGain();
    this.windGain.gain.value = 0;

    windSrc.connect(this.windFilter);
    this.windFilter.connect(this.windGain);
    this.windGain.connect(this.masterGain);
    windSrc.start();

    // Rain noise
    const rainSrc = this.ctx.createBufferSource();
    rainSrc.buffer = noiseBuffer;
    rainSrc.loop = true;

    const rainFilter = this.ctx.createBiquadFilter();
    rainFilter.type = 'highpass';
    rainFilter.frequency.value = 1900;

    this.rainGain = this.ctx.createGain();
    this.rainGain.gain.value = 0;

    rainSrc.connect(rainFilter);
    rainFilter.connect(this.rainGain);
    this.rainGain.connect(this.masterGain);
    rainSrc.start();

    this.isInitialized = true;
  }

  public setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(muted ? 0 : 0.48, this.ctx.currentTime, 0.05);
    }
  }

  public update(state: DroneState, weather: WeatherConfig, cameraMode: CameraMode): void {
    if (!this.isInitialized || !this.ctx || !this.motorGain || !this.motorFilter || !this.windGain || !this.windFilter || !this.rainGain) {
      return;
    }

    const now = this.ctx.currentTime;
    const avgRPM = (state.motorRPM[0] + state.motorRPM[1] + state.motorRPM[2] + state.motorRPM[3]) * 0.25;

    // Distance attenuation in Line-of-Sight ground camera mode
    let distAtten = 1.0;
    if (cameraMode === 'los') {
      distAtten = 1 / (1 + state.distanceFromHome * 0.045);
    } else if (cameraMode === 'gimbal') {
      distAtten = 0.55; // quieter muffled hum from onboard perspective
    }

    if (avgRPM > 200) {
      // Blade pass fundamental ~155Hz idle to ~370Hz full Sport throttle
      const baseFreq = 115 + (avgRPM / 13800) * 265;
      const ratios = [0.985, 1.0, 1.016, 2.008];
      for (let i = 0; i < this.motorOscs.length; i++) {
        this.motorOscs[i].frequency.setTargetAtTime(baseFreq * ratios[i], now, 0.05);
      }
      this.motorFilter.frequency.setTargetAtTime(baseFreq * 2.4, now, 0.05);
      const targetMotorVol = Math.min(0.42, (0.07 + (avgRPM / 13800) * 0.28) * distAtten);
      this.motorGain.gain.setTargetAtTime(targetMotorVol, now, 0.06);
    } else {
      this.motorGain.gain.setTargetAtTime(0, now, 0.08);
    }

    // Wind + airspeed sound
    const windMix = Math.min(1, (state.windSpeedAtDrone * 0.75 + state.airspeed * 0.45) / 18);
    this.windFilter.frequency.setTargetAtTime(220 + windMix * 680, now, 0.08);
    this.windGain.gain.setTargetAtTime(windMix * 0.22, now, 0.1);

    // Rain sound
    this.rainGain.gain.setTargetAtTime(weather.rainIntensity * 0.14, now, 0.15);
  }

  public playTone(
    type: 'takeoff' | 'land' | 'mode' | 'checkpoint' | 'rth' | 'shutter' | 'thunder' | 'crash' | 'splash'
  ): void {
    if (!this.isInitialized || !this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;

    if (type === 'crash' || type === 'splash') {
      this.playImpact(type === 'splash');
      return;
    }

    if (type === 'thunder') {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(68, now);
      osc.frequency.exponentialRampToValueAtTime(28, now + 1.4);
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 130;
      gain.gain.setValueAtTime(0.01, now);
      gain.gain.linearRampToValueAtTime(0.42, now + 0.12);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 1.6);
      osc.connect(lp);
      lp.connect(gain);
      gain.connect(this.masterGain);
      osc.start(now);
      osc.stop(now + 1.65);
      return;
    }

    const playBeep = (freq: number, startOffset: number, dur: number, vol = 0.14) => {
      if (!this.ctx || !this.masterGain) return;
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      g.gain.setValueAtTime(0.001, now + startOffset);
      g.gain.linearRampToValueAtTime(vol, now + startOffset + 0.015);
      g.gain.exponentialRampToValueAtTime(0.001, now + startOffset + dur);
      osc.connect(g);
      g.connect(this.masterGain);
      osc.start(now + startOffset);
      osc.stop(now + startOffset + dur + 0.02);
    };

    if (type === 'takeoff') {
      playBeep(880, 0, 0.09);
      playBeep(1174, 0.1, 0.09);
      playBeep(1568, 0.2, 0.16);
    } else if (type === 'land') {
      playBeep(1174, 0, 0.1);
      playBeep(784, 0.12, 0.16);
    } else if (type === 'mode') {
      playBeep(1320, 0, 0.06, 0.12);
      playBeep(1760, 0.07, 0.07, 0.12);
    } else if (type === 'checkpoint') {
      playBeep(1046, 0, 0.08, 0.16);
      playBeep(1318, 0.08, 0.08, 0.16);
      playBeep(2093, 0.16, 0.2, 0.18);
    } else if (type === 'rth') {
      playBeep(1000, 0, 0.12, 0.15);
      playBeep(1000, 0.18, 0.12, 0.15);
    } else if (type === 'shutter') {
      playBeep(2200, 0, 0.035, 0.15);
      playBeep(1400, 0.04, 0.045, 0.1);
    }
  }

  /**
   * Crash sound: a filtered noise burst (plastic impact or water splash) layered with a
   * low thud, followed by the DJI-style descending alarm beeps.
   */
  private playImpact(isWater: boolean): void {
    if (!this.ctx || !this.masterGain) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const dur = isWater ? 0.9 : 0.45;

    const noiseBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuf;

    const filter = ctx.createBiquadFilter();
    filter.type = isWater ? 'lowpass' : 'bandpass';
    filter.frequency.setValueAtTime(isWater ? 2400 : 1800, now);
    filter.frequency.exponentialRampToValueAtTime(isWater ? 300 : 500, now + dur);
    filter.Q.value = isWater ? 0.7 : 1.2;

    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.001, now);
    noiseGain.gain.linearRampToValueAtTime(isWater ? 0.32 : 0.45, now + 0.01);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + dur);
    noise.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(this.masterGain);
    noise.start(now);
    noise.stop(now + dur);

    const thud = ctx.createOscillator();
    const thudGain = ctx.createGain();
    thud.type = 'sine';
    thud.frequency.setValueAtTime(isWater ? 90 : 140, now);
    thud.frequency.exponentialRampToValueAtTime(40, now + 0.3);
    thudGain.gain.setValueAtTime(0.001, now);
    thudGain.gain.linearRampToValueAtTime(0.4, now + 0.01);
    thudGain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
    thud.connect(thudGain);
    thudGain.connect(this.masterGain);
    thud.start(now);
    thud.stop(now + 0.4);

    // Controller alarm: three descending beeps
    [880, 660, 440].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      const t = now + 0.5 + i * 0.22;
      osc.type = 'square';
      osc.frequency.value = freq;
      g.gain.setValueAtTime(0.001, t);
      g.gain.linearRampToValueAtTime(0.07, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
      osc.connect(g);
      g.connect(this.masterGain!);
      osc.start(t);
      osc.stop(t + 0.2);
    });
  }
}
