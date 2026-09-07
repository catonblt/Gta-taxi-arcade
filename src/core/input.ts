import { Controls, type SafeArea } from './controls';

export type { InputState, ControlSettings, ControlHint, SchemeId, SafeArea } from './controls';
export { SCHEMES, Controls } from './controls';

/**
 * A thin adapter from DOM pointer events to the control layer. All the behaviour lives in
 * Controls, which has no DOM in it and can therefore be tested directly.
 */
export class TouchInput {
  readonly controls = new Controls();

  constructor(private readonly canvas: HTMLCanvasElement) {
    canvas.addEventListener('pointerdown', this.onDown);
    canvas.addEventListener('pointermove', this.onMove);
    canvas.addEventListener('pointerup', this.onUp);
    canvas.addEventListener('pointercancel', this.onUp);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', () => this.controls.clearPointers());
  }

  get state() {
    return this.controls.state;
  }

  get settings() {
    return this.controls.settings;
  }

  resize(width: number, height: number, safe?: SafeArea): void {
    this.controls.resize(width, height, safe);
  }

  update(dt: number): void {
    this.controls.update(dt);
  }

  hint() {
    return this.controls.hint();
  }

  private readonly onDown = (e: PointerEvent): void => {
    e.preventDefault();
    this.canvas.setPointerCapture?.(e.pointerId);
    this.controls.down(e.pointerId, e.clientX, e.clientY);
  };

  private readonly onMove = (e: PointerEvent): void => {
    this.controls.move(e.pointerId, e.clientX, e.clientY);
  };

  private readonly onUp = (e: PointerEvent): void => {
    this.controls.up(e.pointerId);
  };

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    this.controls.keyDown(e.code);
    if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    this.controls.keyUp(e.code);
  };
}
