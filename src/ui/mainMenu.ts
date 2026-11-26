import { CameraMode, FlightMode, SceneId, WeatherPreset } from '../types/simulation';
import { FLIGHT_MODE_ORDER, FLIGHT_MODES } from '../simulation/modes';
import { WEATHER_PRESET_ORDER, WEATHER_PRESETS } from '../simulation/weather';

export interface MainMenuCallbacks {
  onStart: () => void;
  onOpenScenes: () => void;
  onSelectWeather: (preset: WeatherPreset) => void;
  onSelectMode: (mode: FlightMode) => void;
  onSelectCamera: (mode: CameraMode) => void;
  onToggleMute: () => void;
  /** Any click/key on the menu (browsers only allow audio after a user gesture). */
  onFirstInteraction: () => void;
  /** True while another popup (scene selection) sits on top of the menu. */
  isCovered: () => boolean;
}

const SCENE_LABELS: Record<SceneId, string> = {
  mountain: '🏔️ Dağlık Arazi',
  city: '🏙️ Şehir İçi',
};

const WEATHER_LABELS: Record<WeatherPreset, string> = {
  clear: '☀️ Güneşli',
  sunset: '🌅 Gün Batımı',
  windy: '💨 Rüzgarlı',
  rainy: '🌧️ Yağmurlu',
  foggy: '🌫️ Sisli',
  stormy: '⛈️ Fırtına',
};

const CAMERA_LABELS: Record<CameraMode, string> = {
  chase: 'Takip',
  gimbal: 'Gimbal (FPV)',
  los: 'Pilot Görüşü',
  orbit: 'Yörünge',
};
const CAMERA_ORDER: CameraMode[] = ['chase', 'gimbal', 'los', 'orbit'];

/** Top-down quadcopter silhouette used as the menu logo. */
const DRONE_ICON_SVG = `
  <svg viewBox="0 0 64 64" class="mm-logo" aria-hidden="true">
    <g stroke="currentColor" stroke-width="3" stroke-linecap="round">
      <line x1="20" y1="20" x2="44" y2="44" />
      <line x1="44" y1="20" x2="20" y2="44" />
    </g>
    <rect x="25" y="24" width="14" height="16" rx="5" fill="currentColor" />
    <g fill="none" stroke="currentColor" stroke-width="2">
      <circle class="mm-prop" cx="14" cy="14" r="9" />
      <circle class="mm-prop" cx="50" cy="14" r="9" />
      <circle class="mm-prop" cx="14" cy="50" r="9" />
      <circle class="mm-prop" cx="50" cy="50" r="9" />
    </g>
    <circle cx="32" cy="27" r="2" fill="#0b0f16" />
  </svg>
`;

/** Decorative gimbal-camera style reticle / compass ring on the right side of the menu. */
function buildReticleSvg(): string {
  const ticks: string[] = [];
  for (let i = 0; i < 72; i++) {
    const major = i % 6 === 0;
    const a = (i / 72) * Math.PI * 2;
    const r1 = major ? 172 : 180;
    const r2 = 188;
    ticks.push(
      `<line x1="${(200 + Math.sin(a) * r1).toFixed(1)}" y1="${(200 - Math.cos(a) * r1).toFixed(1)}" x2="${(200 + Math.sin(a) * r2).toFixed(1)}" y2="${(200 - Math.cos(a) * r2).toFixed(1)}" stroke-width="${major ? 2 : 1}" />`
    );
  }
  const labels = ['N', 'E', 'S', 'W']
    .map((l, i) => {
      const a = (i / 4) * Math.PI * 2;
      return `<text x="${(200 + Math.sin(a) * 154).toFixed(1)}" y="${(205 - Math.cos(a) * 154).toFixed(1)}">${l}</text>`;
    })
    .join('');
  return `
    <svg viewBox="0 0 400 400" class="mm-reticle" aria-hidden="true">
      <g class="mm-reticle-ring">${ticks.join('')}${labels}</g>
      <circle cx="200" cy="200" r="118" class="mm-reticle-dash" />
      <g class="mm-reticle-cross">
        <line x1="200" y1="150" x2="200" y2="180" />
        <line x1="200" y1="220" x2="200" y2="250" />
        <line x1="150" y1="200" x2="180" y2="200" />
        <line x1="220" y1="200" x2="250" y2="200" />
      </g>
      <path d="M 120 200 A 80 80 0 0 1 280 200" class="mm-reticle-arc" />
    </svg>
  `;
}

/**
 * Full-screen start menu shown when the simulator opens.
 * The live 3D world keeps rendering behind it as a cinematic backdrop.
 */
export class MainMenu {
  private root: HTMLElement;
  private cb: MainMenuCallbacks;
  private items: HTMLButtonElement[] = [];
  private elMainView!: HTMLElement;
  private elOptionsView!: HTMLElement;
  private elSceneLabel!: HTMLElement;
  private elStatus: Record<'scene' | 'weather' | 'mode' | 'sound', HTMLElement> = {} as never;
  private elClock!: HTMLElement;
  private elMuteToggle!: HTMLButtonElement;
  private clockTimer = 0;
  public isOpen = false;

  constructor(parent: HTMLElement, callbacks: MainMenuCallbacks) {
    this.cb = callbacks;
    this.root = document.createElement('div');
    this.root.className = 'main-menu hidden';
    this.root.id = 'main-menu';
    this.root.innerHTML = this.buildMarkup();
    parent.appendChild(this.root);
    this.cacheElements();
    this.bind();
  }

  private buildMarkup(): string {
    const chipRow = <T extends string>(group: string, ids: readonly T[], label: (id: T) => string) =>
      ids.map((id) => `<button type="button" class="mm-chip" data-group="${group}" data-value="${id}">${label(id)}</button>`).join('');

    return `
      <div class="mm-backdrop"></div>
      <div class="mm-scanlines"></div>
      <span class="mm-corner tl"></span><span class="mm-corner tr"></span>
      <span class="mm-corner bl"></span><span class="mm-corner br"></span>

      <div class="mm-topbar">
        <span class="mm-rec-dot"></span>
        <span>SİSTEM HAZIR</span>
        <span class="mm-sep">|</span>
        <span>GPS 24 SAT</span>
        <span class="mm-sep">|</span>
        <span>RC ▮▮▮▮▮</span>
        <span class="mm-sep">|</span>
        <span>🔋 100%</span>
        <span class="mm-clock" id="mm-clock">--:--:--</span>
      </div>

      <div class="mm-reticle-wrap">${buildReticleSvg()}</div>

      <div class="mm-panel">
        <div class="mm-brand">
          ${DRONE_ICON_SVG}
          <div>
            <div class="mm-eyebrow">DJI MINI 5 PRO</div>
            <h1 class="mm-title">UÇUŞ <span>SİMÜLATÖRÜ</span></h1>
          </div>
        </div>
        <p class="mm-tagline">Gerçekçi 6 eksenli fizik · Dinamik hava · İki uçuş sahnesi</p>

        <nav class="mm-view" id="mm-main-view" aria-label="Ana menü">
          <button type="button" class="mm-item primary" data-action="start">
            <span class="mm-idx">01</span>
            <span class="mm-text">
              <span class="mm-label" lang="en">Start Simulation</span>
              <small>Sahne: <b id="mm-scene-label">${SCENE_LABELS.mountain}</b></small>
            </span>
            <span class="mm-arrow">▸</span>
          </button>
          <button type="button" class="mm-item" data-action="scenes">
            <span class="mm-idx">02</span>
            <span class="mm-text">
              <span class="mm-label" lang="en">Scenes</span>
              <small>Uçuş yapılacak ortamı seç</small>
            </span>
            <span class="mm-arrow">▸</span>
          </button>
          <button type="button" class="mm-item" data-action="options">
            <span class="mm-idx">03</span>
            <span class="mm-text">
              <span class="mm-label" lang="en">Options</span>
              <small>Hava durumu, uçuş modu, kamera ve ses</small>
            </span>
            <span class="mm-arrow">▸</span>
          </button>
        </nav>

        <section class="mm-view mm-options hidden" id="mm-options-view" aria-label="Seçenekler">
          <button type="button" class="mm-back" data-action="back">‹ Geri</button>
          <div class="mm-opt-group">
            <div class="mm-opt-title">Hava Durumu</div>
            <div class="mm-chip-row">${chipRow('weather', WEATHER_PRESET_ORDER, (id) => WEATHER_LABELS[id])}</div>
          </div>
          <div class="mm-opt-group">
            <div class="mm-opt-title">Uçuş Modu</div>
            <div class="mm-chip-row">${chipRow('mode', FLIGHT_MODE_ORDER, (id) => `${FLIGHT_MODES[id].code} · ${FLIGHT_MODES[id].shortLabel}`)}</div>
          </div>
          <div class="mm-opt-group">
            <div class="mm-opt-title">Kamera Görünümü</div>
            <div class="mm-chip-row">${chipRow('camera', CAMERA_ORDER, (id) => CAMERA_LABELS[id])}</div>
          </div>
          <div class="mm-opt-group">
            <div class="mm-opt-title">Ses</div>
            <div class="mm-chip-row">
              <button type="button" class="mm-chip mm-toggle" id="mm-mute-toggle">🔊 Açık</button>
            </div>
          </div>
        </section>

        <div class="mm-hint"><kbd>↑</kbd><kbd>↓</kbd> seç · <kbd>Enter</kbd> onayla · <kbd>Esc</kbd> geri</div>
      </div>

      <div class="mm-statusbar">
        <span>SAHNE <b data-status="scene">—</b></span>
        <span>HAVA <b data-status="weather">—</b></span>
        <span>MOD <b data-status="mode">—</b></span>
        <span>SES <b data-status="sound">—</b></span>
      </div>
    `;
  }

  private cacheElements(): void {
    const q = <T extends HTMLElement>(sel: string) => this.root.querySelector<T>(sel)!;
    this.elMainView = q('#mm-main-view');
    this.elOptionsView = q('#mm-options-view');
    this.elSceneLabel = q('#mm-scene-label');
    this.elClock = q('#mm-clock');
    this.elMuteToggle = q<HTMLButtonElement>('#mm-mute-toggle');
    this.items = Array.from(this.elMainView.querySelectorAll<HTMLButtonElement>('.mm-item'));
    for (const key of ['scene', 'weather', 'mode', 'sound'] as const) {
      this.elStatus[key] = q(`[data-status="${key}"]`);
    }
  }

  private bind(): void {
    this.root.addEventListener('pointerdown', () => this.cb.onFirstInteraction());

    this.items.forEach((btn) => {
      btn.addEventListener('mouseenter', () => btn.focus({ preventScroll: true }));
      btn.addEventListener('click', () => this.runAction(btn.dataset.action));
    });
    this.root.querySelector('[data-action="back"]')!.addEventListener('click', () => this.showMain());

    this.root.querySelectorAll<HTMLButtonElement>('.mm-chip[data-group]').forEach((chip) => {
      chip.addEventListener('click', () => {
        const value = chip.dataset.value!;
        switch (chip.dataset.group) {
          case 'weather':
            this.cb.onSelectWeather(value as WeatherPreset);
            break;
          case 'mode':
            this.cb.onSelectMode(value as FlightMode);
            break;
          case 'camera':
            this.cb.onSelectCamera(value as CameraMode);
            break;
        }
      });
    });
    this.elMuteToggle.addEventListener('click', () => this.cb.onToggleMute());

    window.addEventListener('keydown', (e) => {
      if (!this.isOpen || this.cb.isCovered()) return;
      this.cb.onFirstInteraction();
      const optionsOpen = !this.elOptionsView.classList.contains('hidden');
      if (e.code === 'Escape' && optionsOpen) {
        e.preventDefault();
        this.showMain();
        return;
      }
      if (optionsOpen) return;
      if (e.code === 'ArrowDown' || e.code === 'ArrowUp') {
        e.preventDefault();
        const idx = this.items.indexOf(document.activeElement as HTMLButtonElement);
        const step = e.code === 'ArrowDown' ? 1 : -1;
        const next = idx < 0 ? 0 : (idx + step + this.items.length) % this.items.length;
        this.items[next].focus({ preventScroll: true });
      }
    });
  }

  private runAction(action: string | undefined): void {
    this.cb.onFirstInteraction();
    if (action === 'start') this.cb.onStart();
    else if (action === 'scenes') this.cb.onOpenScenes();
    else if (action === 'options') this.showOptions();
  }

  private showOptions(): void {
    this.elMainView.classList.add('hidden');
    this.elOptionsView.classList.remove('hidden');
    this.elOptionsView.querySelector<HTMLButtonElement>('.mm-chip.active')?.focus({ preventScroll: true });
  }

  private showMain(): void {
    this.elOptionsView.classList.add('hidden');
    this.elMainView.classList.remove('hidden');
    this.items[2].focus({ preventScroll: true });
  }

  /** Return keyboard focus to the menu (e.g. after the scene popup closes). */
  public focusItem(action: 'start' | 'scenes' | 'options'): void {
    this.items.find((b) => b.dataset.action === action)?.focus({ preventScroll: true });
  }

  public open(): void {
    this.isOpen = true;
    this.root.classList.remove('hidden');
    this.showMain();
    this.focusItem('start');
    const tickClock = () => {
      this.elClock.textContent = new Date().toLocaleTimeString('tr-TR');
    };
    tickClock();
    window.clearInterval(this.clockTimer);
    this.clockTimer = window.setInterval(tickClock, 1000);
  }

  public close(): void {
    this.isOpen = false;
    this.root.classList.add('hidden');
    window.clearInterval(this.clockTimer);
    (document.activeElement as HTMLElement | null)?.blur();
  }

  private syncChips(group: string, value: string): void {
    this.root
      .querySelectorAll<HTMLButtonElement>(`.mm-chip[data-group="${group}"]`)
      .forEach((c) => c.classList.toggle('active', c.dataset.value === value));
  }

  public syncScene(sceneId: SceneId): void {
    this.elSceneLabel.textContent = SCENE_LABELS[sceneId];
    this.elStatus.scene.textContent = SCENE_LABELS[sceneId].replace(/^\S+\s/, '');
  }

  public syncWeather(preset: WeatherPreset): void {
    this.syncChips('weather', preset);
    this.elStatus.weather.textContent = WEATHER_PRESETS[preset].label;
  }

  public syncMode(mode: FlightMode): void {
    this.syncChips('mode', mode);
    this.elStatus.mode.textContent = FLIGHT_MODES[mode].shortLabel;
  }

  public syncCamera(mode: CameraMode): void {
    this.syncChips('camera', mode);
  }

  public syncMute(muted: boolean): void {
    this.elMuteToggle.textContent = muted ? '🔇 Kapalı' : '🔊 Açık';
    this.elMuteToggle.classList.toggle('active', !muted);
    this.elStatus.sound.textContent = muted ? 'Kapalı' : 'Açık';
  }
}
