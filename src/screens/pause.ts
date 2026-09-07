import type { Audio } from '../core/audio';
import type { InputSettings } from '../core/input';

export interface PauseHandlers {
  onResume: () => void;
  onAbandon: () => void;
  onWipe: () => void;
  onSettingsChanged: () => void;
}

/**
 * Pause is not a luxury on a phone — the shift is on a clock and a phone call is not a reason to
 * lose a night's takings. It doubles as the settings screen, because a player who wants to change
 * the steering wants to change it in the middle of the run that made them want to.
 */
export class PauseScreen {
  private readonly panel = document.getElementById('paused');
  private readonly button = document.getElementById('pause-button');

  constructor(
    private readonly settings: InputSettings,
    private readonly audio: Audio,
    handlers: PauseHandlers,
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
      this.renderValues();
      handlers.onSettingsChanged();
    });

    document.getElementById('set-hand')?.addEventListener('click', () => {
      this.settings.leftHanded = !this.settings.leftHanded;
      this.renderValues();
      handlers.onSettingsChanged();
    });

    document.getElementById('set-sound')?.addEventListener('click', () => {
      this.audio.setMuted(!this.audio.muted);
      this.renderValues();
      handlers.onSettingsChanged();
    });
  }

  /** Shows the pause button only while there is a shift to pause. */
  setDriving(driving: boolean): void {
    if (driving) this.button?.removeAttribute('hidden');
    else this.button?.setAttribute('hidden', '');
  }

  show(): void {
    this.renderValues();
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

  private renderValues(): void {
    const slider = document.getElementById('set-sensitivity') as HTMLInputElement | null;
    if (slider) slider.value = String(this.settings.sensitivity);

    const value = document.getElementById('set-sensitivity-value');
    if (value) {
      const s = this.settings.sensitivity;
      const feel = s < 5 ? 'Slow and deliberate' : s > 9 ? 'Twitchy' : 'Balanced';
      value.textContent = `${feel} — full lock in ${(1 / s).toFixed(2)}s`;
    }

    const hand = document.getElementById('set-hand');
    if (hand) {
      hand.setAttribute('aria-pressed', String(this.settings.leftHanded));
      hand.textContent = this.settings.leftHanded ? 'Drift on the left' : 'Drift on the right';
    }

    const sound = document.getElementById('set-sound');
    if (sound) {
      sound.setAttribute('aria-pressed', String(!this.audio.muted));
      sound.textContent = this.audio.muted ? 'Sound off' : 'Sound on';
    }
  }
}
