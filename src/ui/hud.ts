import {
  CameraMode,
  DroneState,
  FlightMode,
  RCInput,
  WeatherConfig,
  WeatherPreset,
} from '../types/simulation';
import { FLIGHT_MODE_ORDER, FLIGHT_MODES } from '../simulation/modes';
import { getBeaufortScale, WEATHER_PRESET_ORDER, WEATHER_PRESETS } from '../simulation/weather';

export interface HUDCallbacks {
  onSelectMode: (mode: FlightMode) => void;
  onSelectWeather: (preset: WeatherPreset) => void;
  onCustomWindChange: (speed: number, dirDeg: number) => void;
  onTakeoffLand: () => void;
  onRTH: () => void;
  onBrakeChange: (active: boolean) => void;
  onSelectCamera: (mode: CameraMode) => void;
  onGimbalPitchChange: (deg: number) => void;
  onPhoto: () => void;
  onToggleRecord: () => void;
  onToggleMute: () => void;
  onResetDrone: () => void;
  onRechargeBattery: () => void;
  onLeftStick: (x: number, y: number) => void;
  onRightStick: (x: number, y: number) => void;
}

const WEATHER_ICONS: Record<WeatherPreset, string> = {
  clear: '☀️',
  sunset: '🌅',
  windy: '💨',
  rainy: '🌧️',
  foggy: '🌫️',
  stormy: '⛈️',
};

const WEATHER_SHORT: Record<WeatherPreset, string> = {
  clear: 'Güneşli',
  sunset: 'Gün Batımı',
  windy: 'Rüzgarlı',
  rainy: 'Yağmurlu',
  foggy: 'Sisli',
  stormy: 'Fırtına',
};

const CAMERA_LABELS: Array<{ id: CameraMode; label: string }> = [
  { id: 'chase', label: 'Takip' },
  { id: 'gimbal', label: '4K Gimbal' },
  { id: 'los', label: 'Pilot' },
  { id: 'orbit', label: 'Yörünge' },
];

export class DroneHUD {
  private root: HTMLElement;
  private cb: HUDCallbacks;

  // Cached DOM refs for ultra-fast 60 FPS telemetry updates
  private elModeBadge!: HTMLElement;
  private elStatusPill!: HTMLElement;
  private elHeadingChip!: HTMLElement;
  private elCheckpointChip!: HTMLElement;
  private elWindChip!: HTMLElement;
  private elSatCount!: HTMLElement;
  private elSignalBars!: NodeListOf<HTMLElement>;
  private elBattPct!: HTMLElement;
  private elBattFill!: HTMLElement;
  private elBattVolt!: HTMLElement;
  private elMuteBtn!: HTMLButtonElement;
  private elWarningStack!: HTMLElement;
  private elTakeoffBtn!: HTMLButtonElement;
  private elTakeoffLabel!: HTMLElement;
  private elRthBtn!: HTMLButtonElement;
  private elBrakeBtn!: HTMLButtonElement;

  private elModeDesc!: HTMLElement;
  private elModeMaxSpd!: HTMLElement;
  private elModeMaxTilt!: HTMLElement;
  private elModeSafety!: HTMLElement;

  private elWindSpeedSlider!: HTMLInputElement;
  private elWindSpeedVal!: HTMLElement;
  private elWindDirSlider!: HTMLInputElement;
  private elWindDirVal!: HTMLElement;
  private elGimbalSlider!: HTMLInputElement;
  private elGimbalVal!: HTMLElement;
  private elRecBtn!: HTMLButtonElement;
  private elRecLabel!: HTMLElement;

  private elValH!: HTMLElement;
  private elValD!: HTMLElement;
  private elValHS!: HTMLElement;
  private elValVS!: HTMLElement;
  private elMotorFills!: NodeListOf<HTMLElement>;

  private elHorizonGroup!: SVGGElement;
  private elHomeDot!: SVGCircleElement;
  private elWindArrow!: SVGGElement;
  private elCompassRing!: SVGGElement;

  private elObsFront!: HTMLElement;
  private elObsBack!: HTMLElement;
  private elObsLeft!: HTMLElement;
  private elObsRight!: HTMLElement;
  private elReticle!: HTMLElement;

  private elLeftKnob!: HTMLElement;
  private elRightKnob!: HTMLElement;
  private elGamepadChip!: HTMLElement;
  private elShutterFlash!: HTMLElement;
  private elHelpOverlay!: HTMLElement;
  private elRechargeBtn!: HTMLButtonElement;

  private modeButtons!: NodeListOf<HTMLButtonElement>;
  private rcSwitchButtons!: NodeListOf<HTMLButtonElement>;
  private weatherButtons!: NodeListOf<HTMLButtonElement>;
  private cameraButtons!: NodeListOf<HTMLButtonElement>;

  private lastWarningSignature = '';
  private leftStickDragging = false;
  private rightStickDragging = false;

  constructor(root: HTMLElement, callbacks: HUDCallbacks) {
    this.root = root;
    this.cb = callbacks;
    this.renderInitialDOM();
    this.cacheElements();
    this.bindInteractions();
  }

  private renderInitialDOM(): void {
    const modeButtonsHtml = FLIGHT_MODE_ORDER.map((id) => {
      const m = FLIGHT_MODES[id];
      return `
        <button class="mode-btn ${id === 'normal' ? 'active' : ''}" data-mode="${id}" title="${m.description}">
          <span class="mode-code">${m.code}</span>
          <span class="mode-name">${m.shortLabel}</span>
        </button>
      `;
    }).join('');

    const rcSwitchHtml = FLIGHT_MODE_ORDER.map((id) => {
      const m = FLIGHT_MODES[id];
      return `<button class="rc-hw-pos ${id === 'normal' ? 'active' : ''}" data-mode="${id}" title="${m.label}">${m.code}</button>`;
    }).join('');

    const weatherButtonsHtml = WEATHER_PRESET_ORDER.map(
      (id) => `
      <button class="weather-btn ${id === 'clear' ? 'active' : ''}" data-weather="${id}" title="${WEATHER_PRESETS[id].description}">
        <span class="w-icon">${WEATHER_ICONS[id]}</span>
        <span>${WEATHER_SHORT[id]}</span>
      </button>
    `
    ).join('');

    const camButtonsHtml = CAMERA_LABELS.map(
      (c) => `<button class="cam-btn ${c.id === 'chase' ? 'active' : ''}" data-cam="${c.id}">${c.label}</button>`
    ).join('');

    this.root.innerHTML = `
      <div class="shutter-flash" id="shutter-flash"></div>

      <!-- TOP BAR -->
      <header class="hud-top-bar">
        <div class="top-left hud-interactive">
          <div class="brand-chip">
            <span class="mode-badge" id="hud-mode-badge">N</span>
            <span class="drone-title">DJI MINI 5 PRO</span>
          </div>
          <div class="status-pill" id="hud-status-pill">UÇUŞA HAZIR</div>
        </div>

        <div class="top-center">
          <div class="hud-pill" id="hud-heading-chip">🧭 000° K</div>
          <div class="hud-pill" id="hud-checkpoint-chip">⭕ 0 / 8</div>
        </div>

        <div class="top-right hud-interactive">
          <div class="hud-pill" id="hud-wind-chip" title="Anlık Rüzgar Hızı">💨 1.8 m/s</div>
          <div class="hud-pill" title="RC Sinyal & GPS Uydu">
            <div class="signal-bars" id="hud-signal-bars">
              <span class="on" style="height:4px"></span>
              <span class="on" style="height:6px"></span>
              <span class="on" style="height:8px"></span>
              <span class="on" style="height:10px"></span>
              <span class="on" style="height:12px"></span>
            </div>
            <span>🛰️ <strong id="hud-sat-count">24</strong></span>
          </div>
          <div class="hud-pill" title="2S LiPo Akıllı Uçuş Bataryası">
            <div class="batt-bar"><div class="batt-fill" id="hud-batt-fill" style="width:100%"></div></div>
            <strong id="hud-batt-pct">100%</strong>
            <span class="muted" id="hud-batt-volt">8.4V</span>
          </div>
          <button class="icon-btn" id="btn-mute" title="Sesi Aç / Kapat">🔊</button>
          <button class="icon-btn" id="btn-reset" title="Drone'u Başlangıç Pistine Sıfırla">↺</button>
          <button class="icon-btn" id="btn-help" title="Kontrol Rehberi">?</button>
        </div>
      </header>

      <!-- WARNING STACK -->
      <div class="warning-stack" id="hud-warning-stack"></div>

      <!-- CENTER RETICLE + OBSTACLE ARCS -->
      <div class="center-reticle" id="center-reticle">
        <div class="crosshair"></div>
        <div class="obs-arc front" id="obs-front"></div>
        <div class="obs-arc back" id="obs-back"></div>
        <div class="obs-arc left" id="obs-left"></div>
        <div class="obs-arc right" id="obs-right"></div>
      </div>

      <!-- MIDDLE AREA -->
      <div class="hud-middle">
        <!-- LEFT FLIGHT ACTIONS -->
        <aside class="left-rail hud-interactive">
          <button class="flight-action-btn primary" id="btn-takeoff-land" title="Otomatik Kalkış / İniş (Space)">
            <span class="act-icon">🛫</span>
            <span class="act-label" id="lbl-takeoff-land">KALKIŞ</span>
          </button>
          <button class="flight-action-btn" id="btn-rth" title="Eve Dönüş — Return to Home (H)">
            <span class="act-icon">🏠</span>
            <span class="act-label">RTH</span>
          </button>
          <button class="flight-action-btn brake" id="btn-brake" title="Acil Havada Fren (Shift / B)">
            <span class="act-icon">⏸</span>
            <span class="act-label">FREN</span>
          </button>
          <div class="cam-switcher" title="Kamera Açısı Değiştir (C)">
            ${camButtonsHtml}
          </div>
        </aside>

        <!-- RIGHT PANEL: MODES & WEATHER -->
        <aside class="right-panel-wrap hud-interactive">
          <button class="panel-toggle-btn" id="btn-toggle-drawer">⚙️ Mod & Hava Paneli ▾</button>
          <div class="control-drawer" id="control-drawer">
            <!-- FLIGHT MODES -->
            <div class="panel-section">
              <div class="section-header">
                <span>Uçuş Modu (C · N · S · A)</span>
                <span style="font-size:10px;opacity:0.7">Tuş: 1-4</span>
              </div>
              <div class="mode-grid">${modeButtonsHtml}</div>
              <div class="mode-details-box">
                <div class="mode-desc" id="mode-desc-text"></div>
                <div class="mode-specs">
                  <div class="spec-chip">
                    <span>Maks. Hız</span>
                    <span id="mode-spec-spd">12 m/s</span>
                  </div>
                  <div class="spec-chip">
                    <span>Yatış Açısı</span>
                    <span id="mode-spec-tilt">25°</span>
                  </div>
                  <div class="spec-chip">
                    <span>Engel Sensörü</span>
                    <span id="mode-spec-safety">Aktif</span>
                  </div>
                </div>
              </div>
            </div>

            <!-- WEATHER CONDITIONS -->
            <div class="panel-section">
              <div class="section-header">
                <span>Hava Koşulları</span>
                <span id="weather-beaufort-lbl" style="font-size:10px;color:#38bdf8">Bft 2</span>
              </div>
              <div class="weather-grid">${weatherButtonsHtml}</div>
              <div class="slider-row">
                <div class="slider-label">
                  <span>Rüzgar Hızı</span>
                  <strong id="lbl-wind-speed">1.8 m/s</strong>
                </div>
                <input type="range" class="sim-slider" id="slider-wind-speed" min="0" max="20" step="0.2" value="1.8" />
              </div>
              <div class="slider-row">
                <div class="slider-label">
                  <span>Rüzgar Yönü</span>
                  <strong id="lbl-wind-dir">045° (KD)</strong>
                </div>
                <input type="range" class="sim-slider" id="slider-wind-dir" min="0" max="355" step="5" value="45" />
              </div>
            </div>

            <!-- CAMERA & GIMBAL -->
            <div class="panel-section">
              <div class="section-header">
                <span>3 Eksenli Gimbal & Kamera</span>
                <span style="font-size:10px;opacity:0.7">R / F</span>
              </div>
              <div class="slider-row">
                <div class="slider-label">
                  <span>Gimbal Eğimi</span>
                  <strong id="lbl-gimbal-pitch">-10°</strong>
                </div>
                <input type="range" class="sim-slider" id="slider-gimbal" min="-90" max="60" step="1" value="-10" />
              </div>
              <div class="camera-actions-row">
                <button class="shutter-btn" id="btn-photo" title="4K Fotoğraf Çek (P)">📸 Fotoğraf</button>
                <button class="shutter-btn rec" id="btn-record" title="Video Kayıt Başlat/Durdur (V)">
                  <span class="rec-dot"></span>
                  <span id="lbl-record">REC</span>
                </button>
              </div>
              <button class="shutter-btn" id="btn-recharge" style="display:none;border-color:#34d399;color:#6ee7b7">
                🔋 Yeni Batarya Tak (%100)
              </button>
            </div>
          </div>
        </aside>
      </div>

      <!-- BOTTOM BAR: RADAR TELEMETRY + INTERACTIVE DJI RC 2 -->
      <footer class="hud-bottom">
        <div class="telemetry-cluster">
          <!-- Attitude & Home Radar SVG -->
          <div class="attitude-card" title="Yapay Ufuk, Pusula ve Ev Noktası Radarı">
            <svg viewBox="0 0 120 120" width="116" height="116">
              <defs>
                <clipPath id="att-clip"><circle cx="60" cy="60" r="54" /></clipPath>
              </defs>
              <g clip-path="url(#att-clip)">
                <!-- Artificial Horizon -->
                <g id="svg-horizon" transform="translate(60,60)">
                  <rect x="-90" y="-90" width="180" height="90" fill="rgba(56,189,248,0.22)" />
                  <rect x="-90" y="0" width="180" height="90" fill="rgba(16,185,129,0.16)" />
                  <line x1="-80" y1="0" x2="80" y2="0" stroke="rgba(255,255,255,0.65)" stroke-width="1.2" />
                </g>
                <!-- Radar rings -->
                <circle cx="60" cy="60" r="24" fill="none" stroke="rgba(255,255,255,0.12)" stroke-width="1" />
                <circle cx="60" cy="60" r="42" fill="none" stroke="rgba(255,255,255,0.12)" stroke-width="1" />
                <!-- Rotating Compass N mark -->
                <g id="svg-compass" transform="rotate(0 60 60)">
                  <text x="60" y="16" text-anchor="middle" fill="#38bdf8" font-size="9" font-weight="700" font-family="JetBrains Mono">N</text>
                  <text x="106" y="63" text-anchor="middle" fill="rgba(255,255,255,0.45)" font-size="8" font-family="JetBrains Mono">E</text>
                  <text x="60" y="110" text-anchor="middle" fill="rgba(255,255,255,0.45)" font-size="8" font-family="JetBrains Mono">S</text>
                  <text x="14" y="63" text-anchor="middle" fill="rgba(255,255,255,0.45)" font-size="8" font-family="JetBrains Mono">W</text>
                </g>
                <!-- Wind Direction Vector -->
                <g id="svg-wind-arrow" transform="rotate(0 60 60)">
                  <line x1="60" y1="22" x2="60" y2="34" stroke="#facc15" stroke-width="2" />
                  <polygon points="60,38 56,31 64,31" fill="#facc15" />
                </g>
                <!-- Home Point Dot -->
                <circle id="svg-home-dot" cx="60" cy="60" r="4.5" fill="#f97316" stroke="#fff" stroke-width="1.2" />
                <!-- Center Drone Triangle -->
                <polygon points="60,51 54,65 60,62 66,65" fill="#38bdf8" stroke="#fff" stroke-width="1" />
              </g>
            </svg>
          </div>

          <!-- Flight Telemetry Numbers -->
          <div class="telemetry-box">
            <div class="telem-grid">
              <div class="telem-item">
                <span class="telem-key">H</span>
                <span class="telem-val" id="val-h">0.0</span>
                <span class="telem-unit">m</span>
              </div>
              <div class="telem-item">
                <span class="telem-key">D</span>
                <span class="telem-val" id="val-d">0.0</span>
                <span class="telem-unit">m</span>
              </div>
              <div class="telem-item">
                <span class="telem-key">H.S</span>
                <span class="telem-val" id="val-hs">0.0</span>
                <span class="telem-unit">m/s</span>
              </div>
              <div class="telem-item">
                <span class="telem-key">V.S</span>
                <span class="telem-val" id="val-vs">0.0</span>
                <span class="telem-unit">m/s</span>
              </div>
            </div>
            <div class="motor-bars">
              <span class="motor-bars-label">MOTOR RPM</span>
              <div class="motor-bar-list">
                <div class="motor-bar-track"><div class="motor-bar-fill" data-motor="0"></div></div>
                <div class="motor-bar-track"><div class="motor-bar-fill" data-motor="1"></div></div>
                <div class="motor-bar-track"><div class="motor-bar-fill" data-motor="2"></div></div>
                <div class="motor-bar-track"><div class="motor-bar-fill" data-motor="3"></div></div>
              </div>
            </div>
          </div>
        </div>

        <!-- INTERACTIVE DJI RC 2 CONTROLLER -->
        <div class="rc-deck-wrap hud-interactive">
          <div class="rc-deck" id="rc-deck">
            <div class="rc-stick-col">
              <div class="rc-stick-pad" id="rc-left-pad" title="Sol Çubuk: Gaz (W/S) & Dönüş (A/D)">
                <div class="rc-stick-axis-h"></div>
                <div class="rc-stick-axis-v"></div>
                <div class="rc-stick-knob" id="rc-left-knob"></div>
              </div>
              <div class="rc-stick-hint">GAZ / DÖNÜŞ · W S A D</div>
            </div>

            <div class="rc-center-console">
              <div class="rc-logo">DJI RC 2 · MODE 2</div>
              <div class="rc-hw-switch" title="RC 2 Fiziksel Uçuş Modu Anahtarı">
                ${rcSwitchHtml}
              </div>
              <div class="rc-mini-btns">
                <button class="rc-hw-btn" id="rc-btn-takeoff">Kalkış / İniş</button>
                <button class="rc-hw-btn" id="rc-btn-rth">RTH</button>
              </div>
            </div>

            <div class="rc-stick-col">
              <div class="rc-stick-pad" id="rc-right-pad" title="Sağ Çubuk: İleri-Geri (↑/↓) & Sağa-Sola (←/→)">
                <div class="rc-stick-axis-h"></div>
                <div class="rc-stick-axis-v"></div>
                <div class="rc-stick-knob" id="rc-right-knob"></div>
              </div>
              <div class="rc-stick-hint">YÖN / YATIŞ · ↑ ↓ ← →</div>
            </div>
          </div>
          <button class="rc-toggle-pill" id="btn-toggle-rc">🎮 RC Kumandayı Gizle</button>
        </div>

        <div class="bottom-right-status hud-interactive">
          <div class="gamepad-chip" id="gamepad-chip">🎮 USB RC / Gamepad: Bekleniyor</div>
        </div>
      </footer>

      <!-- HELP MODAL -->
      <div class="help-overlay hidden" id="help-overlay">
        <div class="help-card hud-interactive">
          <div class="help-title-row">
            <h2>DJI Mini 5 Pro — Uçuş & RC Kumanda Rehberi</h2>
            <button class="icon-btn" id="btn-close-help">✕</button>
          </div>
          <p style="font-size:12.5px;color:#94a3b8;line-height:1.5">
            Gerçekçi 6-DOF aerodinamik fizik, rüzgar türbülansı, yer etkisi ve DJI RC 2 Mode 2 kontrol deneyimi.
            Klavye, ekrandaki analog RC çubukları veya bilgisayara bağlı bir USB Gamepad/RC kumanda ile uçabilirsiniz.
          </p>
          <div class="kbd-grid">
            <div class="kbd-row"><span>Otomatik Kalkış / İniş</span><kbd>SPACE</kbd></div>
            <div class="kbd-row"><span>Eve Dönüş (RTH)</span><kbd>H</kbd></div>
            <div class="kbd-row"><span>Yüksel / Alçal (Gaz)</span><kbd>W / S</kbd></div>
            <div class="kbd-row"><span>Kendi Ekseninde Dön (Yaw)</span><kbd>A / D</kbd></div>
            <div class="kbd-row"><span>İleri / Geri (Pitch)</span><kbd>↑ / ↓</kbd></div>
            <div class="kbd-row"><span>Sola / Sağa Yatış (Roll)</span><kbd>← / →</kbd></div>
            <div class="kbd-row"><span>Modlar: Cine / Normal / Sport / ATTI</span><kbd>1 · 2 · 3 · 4</kbd></div>
            <div class="kbd-row"><span>Kamera Açısı Değiştir</span><kbd>C</kbd></div>
            <div class="kbd-row"><span>3 Eksenli Gimbal Eğimi</span><kbd>R / F</kbd></div>
            <div class="kbd-row"><span>Acil Fren / Fotoğraf / Video</span><kbd>SHIFT · P · V</kbd></div>
          </div>
          <button class="help-footer-btn" id="btn-start-fly">Uçuşa Dön</button>
        </div>
      </div>
    `;
  }

  private cacheElements(): void {
    const q = <T extends HTMLElement>(sel: string) => this.root.querySelector<T>(sel)!;
    this.elModeBadge = q('#hud-mode-badge');
    this.elStatusPill = q('#hud-status-pill');
    this.elHeadingChip = q('#hud-heading-chip');
    this.elCheckpointChip = q('#hud-checkpoint-chip');
    this.elWindChip = q('#hud-wind-chip');
    this.elSatCount = q('#hud-sat-count');
    this.elSignalBars = this.root.querySelectorAll('#hud-signal-bars span');
    this.elBattPct = q('#hud-batt-pct');
    this.elBattFill = q('#hud-batt-fill');
    this.elBattVolt = q('#hud-batt-volt');
    this.elMuteBtn = q('#btn-mute');
    this.elWarningStack = q('#hud-warning-stack');
    this.elTakeoffBtn = q('#btn-takeoff-land');
    this.elTakeoffLabel = q('#lbl-takeoff-land');
    this.elRthBtn = q('#btn-rth');
    this.elBrakeBtn = q('#btn-brake');

    this.elModeDesc = q('#mode-desc-text');
    this.elModeMaxSpd = q('#mode-spec-spd');
    this.elModeMaxTilt = q('#mode-spec-tilt');
    this.elModeSafety = q('#mode-spec-safety');

    this.elWindSpeedSlider = q('#slider-wind-speed');
    this.elWindSpeedVal = q('#lbl-wind-speed');
    this.elWindDirSlider = q('#slider-wind-dir');
    this.elWindDirVal = q('#lbl-wind-dir');
    this.elGimbalSlider = q('#slider-gimbal');
    this.elGimbalVal = q('#lbl-gimbal-pitch');
    this.elRecBtn = q('#btn-record');
    this.elRecLabel = q('#lbl-record');

    this.elValH = q('#val-h');
    this.elValD = q('#val-d');
    this.elValHS = q('#val-hs');
    this.elValVS = q('#val-vs');
    this.elMotorFills = this.root.querySelectorAll('.motor-bar-fill');

    this.elHorizonGroup = this.root.querySelector('#svg-horizon') as unknown as SVGGElement;
    this.elHomeDot = this.root.querySelector('#svg-home-dot') as unknown as SVGCircleElement;
    this.elWindArrow = this.root.querySelector('#svg-wind-arrow') as unknown as SVGGElement;
    this.elCompassRing = this.root.querySelector('#svg-compass') as unknown as SVGGElement;

    this.elObsFront = q('#obs-front');
    this.elObsBack = q('#obs-back');
    this.elObsLeft = q('#obs-left');
    this.elObsRight = q('#obs-right');
    this.elReticle = q('#center-reticle');

    this.elLeftKnob = q('#rc-left-knob');
    this.elRightKnob = q('#rc-right-knob');
    this.elGamepadChip = q('#gamepad-chip');
    this.elShutterFlash = q('#shutter-flash');
    this.elHelpOverlay = q('#help-overlay');
    this.elRechargeBtn = q('#btn-recharge');

    this.modeButtons = this.root.querySelectorAll('.mode-btn');
    this.rcSwitchButtons = this.root.querySelectorAll('.rc-hw-pos');
    this.weatherButtons = this.root.querySelectorAll('.weather-btn');
    this.cameraButtons = this.root.querySelectorAll('.cam-btn');
  }

  private bindInteractions(): void {
    // Flight Mode selectors (both drawer & physical RC 2 switch)
    const bindModeClick = (btn: HTMLButtonElement) => {
      btn.addEventListener('click', () => {
        const mode = btn.dataset.mode as FlightMode;
        if (mode) this.cb.onSelectMode(mode);
      });
    };
    this.modeButtons.forEach(bindModeClick);
    this.rcSwitchButtons.forEach(bindModeClick);

    // Weather presets
    this.weatherButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const preset = btn.dataset.weather as WeatherPreset;
        if (preset) this.cb.onSelectWeather(preset);
      });
    });

    // Custom wind sliders
    const handleWindInput = () => {
      const spd = parseFloat(this.elWindSpeedSlider.value);
      const dir = parseFloat(this.elWindDirSlider.value);
      this.cb.onCustomWindChange(spd, dir);
    };
    this.elWindSpeedSlider.addEventListener('input', handleWindInput);
    this.elWindDirSlider.addEventListener('input', handleWindInput);

    // Gimbal pitch slider
    this.elGimbalSlider.addEventListener('input', () => {
      this.cb.onGimbalPitchChange(parseFloat(this.elGimbalSlider.value));
    });

    // Action buttons
    this.elTakeoffBtn.addEventListener('click', () => this.cb.onTakeoffLand());
    this.root.querySelector('#rc-btn-takeoff')!.addEventListener('click', () => this.cb.onTakeoffLand());
    this.elRthBtn.addEventListener('click', () => this.cb.onRTH());
    this.root.querySelector('#rc-btn-rth')!.addEventListener('click', () => this.cb.onRTH());

    this.elBrakeBtn.addEventListener('pointerdown', () => {
      this.elBrakeBtn.classList.add('active');
      this.cb.onBrakeChange(true);
    });
    const releaseBrake = () => {
      this.elBrakeBtn.classList.remove('active');
      this.cb.onBrakeChange(false);
    };
    window.addEventListener('pointerup', releaseBrake);

    // Camera mode switcher
    this.cameraButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const cam = btn.dataset.cam as CameraMode;
        if (cam) this.cb.onSelectCamera(cam);
      });
    });

    // Photo & Record
    this.root.querySelector('#btn-photo')!.addEventListener('click', () => this.cb.onPhoto());
    this.elRecBtn.addEventListener('click', () => this.cb.onToggleRecord());

    // Top-right utilities
    this.elMuteBtn.addEventListener('click', () => this.cb.onToggleMute());
    this.root.querySelector('#btn-reset')!.addEventListener('click', () => this.cb.onResetDrone());
    this.elRechargeBtn.addEventListener('click', () => this.cb.onRechargeBattery());

    // Help modal
    this.root.querySelector('#btn-help')!.addEventListener('click', () => {
      this.elHelpOverlay.classList.remove('hidden');
    });
    const closeHelp = () => this.elHelpOverlay.classList.add('hidden');
    this.root.querySelector('#btn-close-help')!.addEventListener('click', closeHelp);
    this.root.querySelector('#btn-start-fly')!.addEventListener('click', closeHelp);
    this.elHelpOverlay.addEventListener('click', (e) => {
      if (e.target === this.elHelpOverlay) closeHelp();
    });

    // Collapsible right drawer
    const drawer = this.root.querySelector('#control-drawer')!;
    const toggleDrawerBtn = this.root.querySelector('#btn-toggle-drawer')!;
    toggleDrawerBtn.addEventListener('click', () => {
      const collapsed = drawer.classList.toggle('collapsed');
      toggleDrawerBtn.textContent = collapsed ? '⚙️ Mod & Hava Paneli ▸' : '⚙️ Mod & Hava Paneli ▾';
    });

    // Collapsible RC deck
    const rcDeck = this.root.querySelector('#rc-deck')!;
    const toggleRcBtn = this.root.querySelector('#btn-toggle-rc')!;
    toggleRcBtn.addEventListener('click', () => {
      const minimized = rcDeck.classList.toggle('minimized');
      toggleRcBtn.textContent = minimized ? '🎮 RC Kumandayı Göster' : '🎮 RC Kumandayı Gizle';
    });

    // Interactive Drag Joysticks (Mouse + Touch with spring-return)
    this.bindVirtualStick(
      this.root.querySelector('#rc-left-pad')!,
      (x, y) => this.cb.onLeftStick(x, y),
      (dragging) => {
        this.leftStickDragging = dragging;
      }
    );
    this.bindVirtualStick(
      this.root.querySelector('#rc-right-pad')!,
      (x, y) => this.cb.onRightStick(x, y),
      (dragging) => {
        this.rightStickDragging = dragging;
      }
    );
  }

  private bindVirtualStick(
    pad: HTMLElement,
    onChange: (x: number, y: number) => void,
    onDragState: (dragging: boolean) => void
  ): void {
    let activePointerId: number | null = null;

    const updateFromPointer = (clientX: number, clientY: number) => {
      const rect = pad.getBoundingClientRect();
      const cx = rect.left + rect.width * 0.5;
      const cy = rect.top + rect.height * 0.5;
      const maxR = rect.width * 0.36;
      let dx = (clientX - cx) / maxR;
      let dy = -(clientY - cy) / maxR; // up is positive
      const mag = Math.hypot(dx, dy);
      if (mag > 1) {
        dx /= mag;
        dy /= mag;
      }
      onChange(dx, dy);
    };

    pad.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      activePointerId = e.pointerId;
      pad.setPointerCapture(e.pointerId);
      onDragState(true);
      updateFromPointer(e.clientX, e.clientY);
    });

    pad.addEventListener('pointermove', (e) => {
      if (e.pointerId !== activePointerId) return;
      updateFromPointer(e.clientX, e.clientY);
    });

    const release = (e: PointerEvent) => {
      if (e.pointerId !== activePointerId) return;
      activePointerId = null;
      onDragState(false);
      onChange(0, 0);
    };
    pad.addEventListener('pointerup', release);
    pad.addEventListener('pointercancel', release);
  }

  public flashShutter(): void {
    this.elShutterFlash.classList.add('active');
    requestAnimationFrame(() => {
      setTimeout(() => this.elShutterFlash.classList.remove('active'), 45);
    });
  }

  public syncModeUI(mode: FlightMode): void {
    const cfg = FLIGHT_MODES[mode];
    this.elModeBadge.textContent = cfg.code;
    this.elModeBadge.style.background = cfg.accentColor;

    this.elModeDesc.textContent = cfg.description;
    this.elModeMaxSpd.textContent = `${cfg.maxHorizontalSpeed} m/s`;
    this.elModeMaxTilt.textContent = `${cfg.maxTiltDeg}°`;
    this.elModeSafety.textContent = cfg.obstacleAvoidance ? 'Aktif' : 'Kapalı';
    this.elModeSafety.style.color = cfg.obstacleAvoidance ? '#6ee7b7' : '#fb7185';

    this.modeButtons.forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
    this.rcSwitchButtons.forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
  }

  public syncWeatherUI(weather: WeatherConfig): void {
    this.weatherButtons.forEach((b) => b.classList.toggle('active', b.dataset.weather === weather.id));
    this.elWindSpeedSlider.value = weather.windSpeed.toFixed(1);
    this.elWindDirSlider.value = Math.round(weather.windDirectionDeg).toString();
    this.updateWindLabels(weather.windSpeed, weather.windDirectionDeg);
  }

  public syncCameraUI(mode: CameraMode): void {
    this.cameraButtons.forEach((b) => b.classList.toggle('active', b.dataset.cam === mode));
    this.elReticle.style.opacity = mode === 'gimbal' ? '1' : '0.45';
  }

  public syncMuteUI(muted: boolean): void {
    this.elMuteBtn.textContent = muted ? '🔇' : '🔊';
  }

  private updateWindLabels(speed: number, dirDeg: number): void {
    const bft = getBeaufortScale(speed);
    this.elWindSpeedVal.textContent = `${speed.toFixed(1)} m/s`;
    this.elWindDirVal.textContent = `${Math.round(dirDeg).toString().padStart(3, '0')}° (${cardinalTR(dirDeg)})`;
    const bftEl = this.root.querySelector('#weather-beaufort-lbl');
    if (bftEl) bftEl.textContent = `Bft ${bft.level} · ${bft.label}`;
  }

  public update(
    state: DroneState,
    rc: RCInput,
    weather: WeatherConfig,
    gamepadConnected: boolean
  ): void {
    // 1. Flight Phase Status Pill
    let statusText = 'UÇUŞA HAZIR';
    let pillClass = 'status-pill';
    if (state.flightPhase === 'ARMING') {
      statusText = 'MOTORLAR HAZIR';
    } else if (state.flightPhase === 'TAKING_OFF') {
      statusText = 'OTOMATİK KALKIŞ';
    } else if (state.flightPhase === 'LANDING') {
      statusText = 'OTOMATİK İNİŞ';
      pillClass = 'status-pill warning';
    } else if (state.flightPhase.startsWith('RTH_')) {
      statusText = 'EVE DÖNÜYOR (RTH)';
      pillClass = 'status-pill rth';
    } else if (state.flightPhase === 'FLYING') {
      statusText = state.flightMode === 'atti' ? 'UÇUŞTA (ATTI)' : 'UÇUŞTA (GPS)';
      if (state.flightMode === 'sport' || state.flightMode === 'atti') {
        pillClass = 'status-pill warning';
      }
    }
    this.elStatusPill.textContent = statusText;
    this.elStatusPill.className = pillClass;

    // 2. Top Center Compass & Checkpoints
    const hdg = Math.round(state.headingDeg).toString().padStart(3, '0');
    this.elHeadingChip.textContent = `🧭 ${hdg}° ${cardinalTR(state.headingDeg)}`;
    this.elCheckpointChip.textContent = `⭕ ${state.checkpointsCleared} / ${state.totalCheckpoints}`;

    // 3. Top Right Wind, GPS, Signal, Battery
    this.elWindChip.textContent = `💨 ${state.windSpeedAtDrone.toFixed(1)} m/s`;
    this.elWindChip.style.color = state.windSpeedAtDrone > 10.7 ? '#fda4af' : '#f8fafc';
    this.elSatCount.textContent = String(state.satellites);
    this.elSignalBars.forEach((bar, idx) => {
      bar.classList.toggle('on', idx < state.rcSignal);
    });

    const pct = Math.round(state.batteryPercent);
    this.elBattPct.textContent = `${pct}%`;
    this.elBattVolt.textContent = `${state.batteryVoltage.toFixed(1)}V · ${state.estimatedFlightMin}dk`;
    this.elBattFill.style.width = `${pct}%`;
    this.elBattFill.style.background = pct <= 15 ? '#f43f5e' : pct <= 30 ? '#facc15' : '#34d399';
    this.elRechargeBtn.style.display = state.flightPhase === 'GROUNDED' && pct < 95 ? 'flex' : 'none';

    // 4. Takeoff/Land & RTH buttons
    const airborne = state.flightPhase !== 'GROUNDED';
    this.elTakeoffBtn.classList.toggle('airborne', airborne);
    this.elTakeoffLabel.textContent = airborne ? 'İNİŞ' : 'KALKIŞ';
    this.elRthBtn.classList.toggle('active', state.flightPhase.startsWith('RTH_'));

    // 5. Gimbal & Recording readout
    this.elGimbalSlider.value = Math.round(state.gimbalPitchDeg).toString();
    this.elGimbalVal.textContent = `${Math.round(state.gimbalPitchDeg)}°`;
    this.elRecBtn.classList.toggle('recording', state.isRecording);
    if (state.isRecording) {
      const m = Math.floor(state.recordingSec / 60).toString().padStart(2, '0');
      const s = Math.floor(state.recordingSec % 60).toString().padStart(2, '0');
      this.elRecLabel.textContent = `${m}:${s}`;
    } else {
      this.elRecLabel.textContent = 'REC';
    }

    // Wind slider live readout sync
    this.updateWindLabels(weather.windSpeed, weather.windDirectionDeg);

    // 6. Core Telemetry Block
    this.elValH.textContent = state.altitudeHome.toFixed(1);
    this.elValD.textContent = state.distanceFromHome.toFixed(1);
    this.elValHS.textContent = state.horizontalSpeed.toFixed(1);
    const vsSign = state.verticalSpeed >= 0.05 ? '+' : '';
    this.elValVS.textContent = `${vsSign}${state.verticalSpeed.toFixed(1)}`;

    // 4 Motor RPM bars
    this.elMotorFills.forEach((fill, idx) => {
      const pctMotor = Math.min(100, (state.motorRPM[idx] / 13800) * 100);
      fill.style.width = `${pctMotor.toFixed(0)}%`;
    });

    // 7. Attitude Artificial Horizon & Home Radar
    const pitchPx = (state.pitch * 180) / Math.PI * 1.1;
    const rollDeg = (-state.roll * 180) / Math.PI;
    this.elHorizonGroup.setAttribute(
      'transform',
      `translate(60, ${60 + pitchPx}) rotate(${rollDeg.toFixed(1)})`
    );

    // Compass rotates opposite to heading
    this.elCompassRing.setAttribute('transform', `rotate(${(-state.headingDeg).toFixed(1)} 60 60)`);

    // Wind vector arrow relative to drone heading
    const relWindDeg = state.windDirectionDeg - state.headingDeg;
    this.elWindArrow.setAttribute('transform', `rotate(${relWindDeg.toFixed(1)} 60 60)`);
    this.elWindArrow.style.opacity = state.windSpeedAtDrone > 0.6 ? '0.9' : '0.2';

    // Home point dot on radar (relative to drone position & heading)
    const dx = state.homePosition.x - state.position.x;
    const dz = state.homePosition.z - state.position.z;
    const cosY = Math.cos(state.yaw);
    const sinY = Math.sin(state.yaw);
    const relRight = dx * cosY - dz * sinY;
    const relFwd = -dx * sinY - dz * cosY;
    const scale = 0.42; // 100m -> 42px
    let dotX = relRight * scale;
    let dotY = -relFwd * scale;
    const dotMag = Math.hypot(dotX, dotY);
    if (dotMag > 44) {
      dotX = (dotX / dotMag) * 44;
      dotY = (dotY / dotMag) * 44;
    }
    this.elHomeDot.setAttribute('cx', (60 + dotX).toFixed(1));
    this.elHomeDot.setAttribute('cy', (60 + dotY).toFixed(1));

    // 8. Obstacle Proximity Arcs
    const updateArc = (el: HTMLElement, dist: number) => {
      if (dist < 11 && state.flightPhase === 'FLYING') {
        el.style.opacity = '1';
        el.textContent = `${dist.toFixed(1)}m`;
        el.classList.toggle('danger', dist < 4.5);
      } else {
        el.style.opacity = '0';
      }
    };
    updateArc(this.elObsFront, state.obstacles.front);
    updateArc(this.elObsBack, state.obstacles.back);
    updateArc(this.elObsLeft, state.obstacles.left);
    updateArc(this.elObsRight, state.obstacles.right);

    // 9. Animate Virtual DJI RC 2 Joysticks (mirrors keyboard, gamepad, or touch!)
    const maxOffset = 28;
    const lx = rc.yaw * maxOffset;
    const ly = -rc.throttle * maxOffset;
    const rx = rc.roll * maxOffset;
    const ry = -rc.pitch * maxOffset;
    this.elLeftKnob.style.transform = `translate(calc(-50% + ${lx.toFixed(1)}px), calc(-50% + ${ly.toFixed(1)}px))`;
    this.elRightKnob.style.transform = `translate(calc(-50% + ${rx.toFixed(1)}px), calc(-50% + ${ry.toFixed(1)}px))`;

    // Prevent unused field warning
    if (this.leftStickDragging || this.rightStickDragging) {
      this.elLeftKnob.style.borderColor = this.leftStickDragging ? '#38bdf8' : 'rgba(255,255,255,0.45)';
      this.elRightKnob.style.borderColor = this.rightStickDragging ? '#38bdf8' : 'rgba(255,255,255,0.45)';
    }

    // 10. Gamepad status
    this.elGamepadChip.classList.toggle('connected', gamepadConnected);
    this.elGamepadChip.textContent = gamepadConnected
      ? '🎮 USB RC / Gamepad: Bağlı (Mode 2)'
      : '🎮 Klavye & Sanal RC Aktif';

    // 11. Warnings (only update DOM when warnings change)
    const sig = state.warnings.map((w) => `${w.id}:${w.message}`).join('|');
    if (sig !== this.lastWarningSignature) {
      this.lastWarningSignature = sig;
      this.elWarningStack.innerHTML = state.warnings
        .slice(0, 3)
        .map((w) => `<div class="warning-banner ${w.level}">${w.message}</div>`)
        .join('');
    }
  }
}

function cardinalTR(deg: number): string {
  const dirs = ['K', 'KD', 'D', 'GD', 'G', 'GB', 'B', 'KB'];
  const idx = Math.round((((deg % 360) + 360) % 360) / 45) % 8;
  return dirs[idx];
}
