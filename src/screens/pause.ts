import type { Audio } from '../core/audio';
import { SCHEMES, type ControlSettings, type SchemeId } from '../core/input';

export interface PauseHandlers {
  onResume: () => void;
  onAbandon: () => void;
  onWipe: () => void;
  onSettingsChanged: () => void;
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * Pause is not a luxury on a phone — the shift is on a clock and a phone call is not a reason to
 * lose a night's takings. It doubles as the settings screen, because a player who wants to change
 * the controls wants to change them in the middle of the run that made them want to.
 */
export class PauseScreen {
  private readonly panel = document.getElementById('paused');
  private readonly button = document.getElementById('pause-button');

  constructor(
    private readonly settings: ControlSettings,
    private readonly audio: Audio,
    private readonly handlers: PauseHandlers,
  ) {
    this.button?.addEventListener('click', () => handlers.onResume());
    document.getElementById('resume')?.addEventListener('click', () => handlers.onResume());
    document.getElementById('abandon')?.addEventListener('click', () => handlers.onAbandon());

    document.getElementById('wipe')?.addEventListener('click', (event) => {
      const target = event.currentTarget as HTMLButtonElement;
      // Two taps to erase a career: the first turns the button into the warning.
      if (target.dataset.armed !== 'yes') {
        target.dataset.armed = 'yes';
        target.textContent = 'Tap again to erase everything';
        return;
      }
      target.dataset.armed = '';
      target.textContent = 'Erase all progress';
      handlers.onWipe();
    });

    const slider = document.getElementById('set-sensitivity') as HTMLInputElement | null;
    slider?.addEventListener('input', () => {
      this.settings.sensitivity = Number(slider.value);
      this.render();
      handlers.onSettingsChanged();
    });

    document.getElementById('set-hand-left')?.addEventListener('click', () => this.setMirrored(false));
    document.getElementById('set-hand-right')?.addEventListener('click', () => this.setMirrored(true));

    document.getElementById('set-sound')?.addEventListener('click', () => {
      this.audio.setMuted(!this.audio.muted);
      this.render();
      handlers.onSettingsChanged();
    });
  }

  /** Shows the pause button only while there is a shift to pause. */
  setDriving(driving: boolean): void {
    if (driving) this.button?.removeAttribute('hidden');
    else this.button?.setAttribute('hidden', '');
  }

  show(): void {
    this.render();
    this.panel?.removeAttribute('hidden');
    this.button?.setAttribute('hidden', '');
  }

  hide(): void {
    this.panel?.setAttribute('hidden', '');
    const wipe = document.getElementById('wipe');
    if (wipe) {
      wipe.dataset.armed = '';
      wipe.textContent = 'Erase all progress';
    }
  }

  get visible(): boolean {
    return this.panel?.hasAttribute('hidden') === false;
  }

  private setMirrored(mirrored: boolean): void {
    this.settings.mirrored = mirrored;
    this.render();
    this.handlers.onSettingsChanged();
  }

  private select(scheme: SchemeId): void {
    this.settings.scheme = scheme;
    this.render();
    this.handlers.onSettingsChanged();
  }

  private render(): void {
    this.renderSchemes();
    this.renderSensitivity();

    // Two buttons rather than one toggle, so the current layout is the one lit up. A single
    // button labelled with the current state reads as switched off, which is the opposite.
    document
      .getElementById('set-hand-left')
      ?.setAttribute('aria-pressed', String(!this.settings.mirrored));
    document
      .getElementById('set-hand-right')
      ?.setAttribute('aria-pressed', String(this.settings.mirrored));

    const sound = document.getElementById('set-sound');
    if (sound) {
      sound.setAttribute('aria-pressed', String(!this.audio.muted));
      sound.textContent = this.audio.muted ? 'Sound off' : 'Sound on';
    }
  }

  private renderSchemes(): void {
    const host = document.getElementById('set-schemes');
    if (!host) return;
    host.replaceChildren();

    for (const scheme of SCHEMES) {
      const button = element('button', 'toggle', scheme.name);
      button.type = 'button';
      button.setAttribute('aria-pressed', String(this.settings.scheme === scheme.id));
      button.addEventListener('click', () => this.select(scheme.id));
      host.append(button);
    }

    const blurb = document.getElementById('set-scheme-blurb');
    const active = SCHEMES.find((s) => s.id === this.settings.scheme);
    if (blurb && active) blurb.textContent = active.blurb;
  }

  private renderSensitivity(): void {
    const slider = document.getElementById('set-sensitivity') as HTMLInputElement | null;
    if (slider) slider.value = String(this.settings.sensitivity);

    const active = SCHEMES.find((s) => s.id === this.settings.scheme);
    const label = document.getElementById('set-sensitivity-label');
    if (label && active) label.textContent = active.sensitivityLabel;

    const value = document.getElementById('set-sensitivity-value');
    if (value) {
      const s = this.settings.sensitivity;
      value.textContent = s < 5 ? 'Slow and deliberate' : s > 9 ? 'Twitchy' : 'Balanced';
    }
  }
}
