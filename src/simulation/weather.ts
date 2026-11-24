import { Vec3, WeatherConfig, WeatherPreset } from '../types/simulation';

export const WEATHER_PRESETS: Record<WeatherPreset, WeatherConfig> = {
  clear: {
    id: 'clear',
    label: 'Açık & Güneşli',
    description: 'Hafif esinti, berrak görüş ve ideal uçuş koşulları.',
    windSpeed: 1.8,
    windDirectionDeg: 45,
    gustStrength: 0.8,
    turbulence: 0.08,
    rainIntensity: 0,
    fogDensity: 0.00085,
    cloudCoverage: 0.25,
    lightning: false,
    skyTopColor: '#1d5fa8',
    skyHorizonColor: '#a8d5f5',
    fogColor: '#a8d5f5',
    sunColor: '#fff6e0',
    sunIntensity: 2.6,
    ambientColor: '#b7d6f5',
    ambientIntensity: 0.85,
    sunElevationDeg: 46,
    sunAzimuthDeg: 135,
  },
  sunset: {
    id: 'sunset',
    label: 'Gün Batımı',
    description: 'Altın saat ışığı, sıcak ufuk ve hafif termal hava akımları.',
    windSpeed: 3.4,
    windDirectionDeg: 255,
    gustStrength: 1.6,
    turbulence: 0.16,
    rainIntensity: 0,
    fogDensity: 0.00145,
    cloudCoverage: 0.4,
    lightning: false,
    skyTopColor: '#252157',
    skyHorizonColor: '#f58b4c',
    fogColor: '#d9896c',
    sunColor: '#ff9248',
    sunIntensity: 2.3,
    ambientColor: '#9c6e8a',
    ambientIntensity: 0.75,
    sunElevationDeg: 11,
    sunAzimuthDeg: 245,
  },
  windy: {
    id: 'windy',
    label: 'Şiddetli Rüzgar',
    description: 'Sert rüzgar hamleleri (9–13 m/s). Mini 5 Pro rüzgar direnci sınırında!',
    windSpeed: 9.2,
    windDirectionDeg: 295,
    gustStrength: 4.2,
    turbulence: 0.58,
    rainIntensity: 0,
    fogDensity: 0.0013,
    cloudCoverage: 0.62,
    lightning: false,
    skyTopColor: '#3b5875',
    skyHorizonColor: '#9fb4c7',
    fogColor: '#9db1c4',
    sunColor: '#eef4fa',
    sunIntensity: 1.75,
    ambientColor: '#8ea5bd',
    ambientIntensity: 0.85,
    sunElevationDeg: 36,
    sunAzimuthDeg: 165,
  },
  rainy: {
    id: 'rainy',
    label: 'Yağmurlu',
    description: 'Orta şiddette yağış, ıslak zemin, azalan görüş ve nemli rüzgar.',
    windSpeed: 6.4,
    windDirectionDeg: 210,
    gustStrength: 3.0,
    turbulence: 0.42,
    rainIntensity: 0.72,
    fogDensity: 0.0036,
    cloudCoverage: 0.88,
    lightning: false,
    skyTopColor: '#293542',
    skyHorizonColor: '#5c6c7a',
    fogColor: '#5a6a78',
    sunColor: '#c2d1de',
    sunIntensity: 0.9,
    ambientColor: '#66798c',
    ambientIntensity: 0.95,
    sunElevationDeg: 32,
    sunAzimuthDeg: 185,
  },
  foggy: {
    id: 'foggy',
    label: 'Yoğun Sis',
    description: 'Düşük görüş mesafesi — HUD telemetri ve radar ile aletli uçuş deneyimi.',
    windSpeed: 2.2,
    windDirectionDeg: 120,
    gustStrength: 0.9,
    turbulence: 0.12,
    rainIntensity: 0.05,
    fogDensity: 0.0115,
    cloudCoverage: 0.95,
    lightning: false,
    skyTopColor: '#7f8f9c',
    skyHorizonColor: '#c6d1d9',
    fogColor: '#c2cdd6',
    sunColor: '#dde6ed',
    sunIntensity: 0.85,
    ambientColor: '#aebcc7',
    ambientIntensity: 1.1,
    sunElevationDeg: 28,
    sunAzimuthDeg: 145,
  },
  stormy: {
    id: 'stormy',
    label: 'Fırtına',
    description: 'Şimşek, sağanak yağmur ve 15+ m/s hamleli tehlikeli rüzgar türbülansı!',
    windSpeed: 12.6,
    windDirectionDeg: 320,
    gustStrength: 5.8,
    turbulence: 0.92,
    rainIntensity: 1.0,
    fogDensity: 0.0052,
    cloudCoverage: 1.0,
    lightning: true,
    skyTopColor: '#111824',
    skyHorizonColor: '#313d4d',
    fogColor: '#2d3847',
    sunColor: '#7e93ad',
    sunIntensity: 0.45,
    ambientColor: '#3b4a5e',
    ambientIntensity: 0.72,
    sunElevationDeg: 24,
    sunAzimuthDeg: 210,
  },
};

export const WEATHER_PRESET_ORDER: WeatherPreset[] = [
  'clear',
  'sunset',
  'windy',
  'rainy',
  'foggy',
  'stormy',
];

export class WeatherEngine {
  private current: WeatherConfig;
  private time = 0;
  public lightningFlash = 0; // 0..1 intensity
  private nextLightningTime = 4;
  public onThunder?: (intensity: number) => void;

  // Optional user overrides
  public customWindSpeed: number | null = null;
  public customWindDirDeg: number | null = null;

  constructor(initial: WeatherPreset = 'clear') {
    this.current = { ...WEATHER_PRESETS[initial] };
  }

  public setPreset(preset: WeatherPreset): void {
    this.current = { ...WEATHER_PRESETS[preset] };
    this.customWindSpeed = null;
    this.customWindDirDeg = null;
    this.nextLightningTime = this.time + 2.5 + Math.random() * 5;
  }

  public setCustomWind(speed: number, dirDeg: number): void {
    this.customWindSpeed = Math.max(0, Math.min(20, speed));
    this.customWindDirDeg = ((dirDeg % 360) + 360) % 360;
  }

  public getConfig(): WeatherConfig {
    return {
      ...this.current,
      windSpeed: this.customWindSpeed ?? this.current.windSpeed,
      windDirectionDeg: this.customWindDirDeg ?? this.current.windDirectionDeg,
    };
  }

  public update(dt: number): void {
    this.time += dt;

    if (this.current.lightning) {
      if (this.time >= this.nextLightningTime) {
        this.lightningFlash = 0.85 + Math.random() * 0.15;
        this.nextLightningTime = this.time + 5 + Math.random() * 10;
        if (this.onThunder) {
          this.onThunder(this.lightningFlash);
        }
      }
    }

    if (this.lightningFlash > 0) {
      this.lightningFlash = Math.max(0, this.lightningFlash - dt * 3.8);
    }
  }

  /**
   * Computes realistic 3D wind vector (m/s) at a given world position.
   * Incorporates:
   * - Logarithmic altitude wind shear (stronger wind higher up)
   * - Multi-octave sinusoidal spatial/temporal gusts
   * - Vertical updrafts / downdrafts during turbulence
   */
  public sampleWindAt(pos: Vec3): Vec3 {
    const cfg = this.getConfig();
    const baseSpeed = cfg.windSpeed;
    // Meteorological wind direction: 0 deg = blowing from North (+Z/-Z -> in our world -Z is North)
    // Blowing FROM North (-Z) means air moves toward South (+Z).
    const rad = (cfg.windDirectionDeg * Math.PI) / 180;
    const dirX = -Math.sin(rad);
    const dirZ = Math.cos(rad);

    // Wind shear: calmer near ground (0..2m), increases smoothly with altitude
    const alt = Math.max(0, pos.y);
    const shearFactor = 0.55 + 0.45 * Math.min(1.45, Math.log1p(alt * 0.18 + 0.6));

    // Multi-frequency gust waves
    const t = this.time;
    const spatial = pos.x * 0.025 + pos.z * 0.025;
    const gustWave =
      Math.sin(t * 0.72 + spatial) * 0.52 +
      Math.sin(t * 1.63 - spatial * 1.7 + alt * 0.05) * 0.31 +
      Math.sin(t * 3.17 + pos.x * 0.06) * 0.17;

    const gustMag = Math.max(0, (gustWave + 0.35) * 0.75) * cfg.gustStrength;
    const totalHorizSpeed = Math.max(0, baseSpeed * shearFactor + gustMag);

    // Crosswind swirl
    const swirl =
      Math.sin(t * 1.25 + pos.z * 0.04) * cfg.turbulence * 2.4 +
      Math.cos(t * 2.4 + pos.x * 0.05) * cfg.turbulence * 1.1;

    // Vertical thermal / turbulent downdrafts
    const vertical =
      (Math.sin(t * 1.9 + pos.x * 0.03 + pos.z * 0.03) * 0.65 +
        Math.cos(t * 3.4 - pos.y * 0.08) * 0.35) *
      cfg.turbulence *
      2.6 *
      Math.min(1, alt / 5);

    return {
      x: dirX * totalHorizSpeed + -dirZ * swirl,
      y: vertical,
      z: dirZ * totalHorizSpeed + dirX * swirl,
    };
  }
}

export function getBeaufortScale(windMs: number): { level: number; label: string } {
  if (windMs < 0.5) return { level: 0, label: 'Sakin' };
  if (windMs < 1.6) return { level: 1, label: 'Çok Hafif' };
  if (windMs < 3.4) return { level: 2, label: 'Hafif Esinti' };
  if (windMs < 5.5) return { level: 3, label: 'Tatlı Rüzgar' };
  if (windMs < 8.0) return { level: 4, label: 'Orta Rüzgar' };
  if (windMs < 10.8) return { level: 5, label: 'Sert Rüzgar' };
  if (windMs < 13.9) return { level: 6, label: 'Kuvvetli' };
  return { level: 7, label: 'Fırtına' };
}
