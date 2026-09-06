import { PARTS, RARITY_COLOR, partById } from '../data/parts';
import { VEHICLES, vehicleById } from '../data/vehicles';
import { AXES, AXIS_BLURB, AXIS_LABEL, MAX_LEVEL, type Garage, type UpgradeAxis } from '../game/garage';

const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;

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
 * The garage is where the work pays off, so it answers three questions in order: what can I
 * afford, what does this car need, and what am I planning tonight. Every price is shown whether
 * or not it is affordable — knowing what you are saving toward is most of the pull.
 */
export class GarageScreen {
  private readonly panel = document.getElementById('garage');

  constructor(
    private readonly garage: Garage,
    private readonly onDrive: () => void,
    private readonly onChange: () => void,
  ) {
    document.getElementById('drive')?.addEventListener('click', () => {
      this.hide();
      this.onDrive();
    });
  }

  show(): void {
    this.render();
    this.panel?.removeAttribute('hidden');
  }

  hide(): void {
    this.panel?.setAttribute('hidden', '');
  }

  get visible(): boolean {
    return this.panel?.hasAttribute('hidden') === false;
  }

  private refresh(): void {
    this.onChange();
    this.render();
  }

  private render(): void {
    const g = this.garage;
    this.text('g-cash', money(g.cash));
    this.text('g-rep', `${g.rep} rep`);
    this.text('g-blurb', g.vehicle.blurb);
    this.text('g-slots', `${g.state.parts.length} of ${g.slots()} slots used`);
    this.renderCars();
    this.renderUpgrades();
    this.renderParts();
  }

  private text(id: string, value: string): void {
    const node = document.getElementById(id);
    if (node) node.textContent = value;
  }

  private renderCars(): void {
    const host = document.getElementById('g-cars');
    if (!host) return;
    host.replaceChildren();

    for (const vehicle of VEHICLES) {
      const owned = Boolean(this.garage.owned[vehicle.id]);
      const button = element('button', 'car');
      button.type = 'button';
      button.setAttribute('aria-pressed', String(owned && this.garage.current === vehicle.id));
      button.append(element('span', 'name', vehicle.name));
      button.append(
        element('span', 'meta', owned ? `${this.built(vehicle.id)} of ${AXES.length * MAX_LEVEL} built` : money(vehicle.price)),
      );
      button.disabled = !owned && this.garage.cash < vehicle.price;
      button.addEventListener('click', () => {
        if (owned) this.garage.select(vehicle.id);
        else this.garage.buyVehicle(vehicle.id);
        this.refresh();
      });
      host.append(button);
    }
  }

  private built(vehicleId: string): number {
    const levels = this.garage.owned[vehicleId]?.levels;
    if (!levels) return 0;
    return AXES.reduce((sum, axis) => sum + levels[axis], 0);
  }

  private renderUpgrades(): void {
    const host = document.getElementById('g-upgrades');
    if (!host) return;
    host.replaceChildren();

    for (const axis of AXES) {
      host.append(this.upgradeRow(axis));
    }
  }

  private upgradeRow(axis: UpgradeAxis): HTMLElement {
    const g = this.garage;
    const level = g.state.levels[axis];
    const cost = g.upgradeCost(axis);

    const row = element('div', 'row');
    const left = element('div');
    left.append(element('div', 'label', AXIS_LABEL[axis]));
    left.append(element('div', 'hint', AXIS_BLURB[axis]));

    const pips = element('div', 'pips');
    for (let i = 0; i < MAX_LEVEL; i++) pips.append(element('span', i < level ? 'pip on' : 'pip'));
    left.append(pips);

    const button = element('button', level >= MAX_LEVEL ? 'buy maxed' : 'buy');
    button.type = 'button';
    button.textContent = level >= MAX_LEVEL ? 'Maxed' : money(cost);
    button.disabled = level >= MAX_LEVEL || !g.canUpgrade(axis);
    button.addEventListener('click', () => {
      if (g.upgrade(axis)) this.refresh();
    });

    row.append(left, button);
    return row;
  }

  private renderParts(): void {
    const host = document.getElementById('g-parts');
    if (!host) return;
    host.replaceChildren();

    const g = this.garage;
    // Owned parts first — what you can act on now, above what you are saving for.
    const visible = PARTS.filter((part) => g.inventory.includes(part.id) || g.rep >= part.rep);
    const ordered = [...visible].sort((a, b) => {
      const owned = Number(g.inventory.includes(b.id)) - Number(g.inventory.includes(a.id));
      return owned !== 0 ? owned : a.price - b.price;
    });

    for (const part of ordered) {
      const owned = g.inventory.includes(part.id);
      const fitted = g.state.parts.includes(part.id);

      const row = element('div', 'row part');
      const left = element('div');
      const label = element('div', 'label');
      const dot = element('span', 'rarity');
      dot.style.background = RARITY_COLOR[part.rarity];
      label.append(dot, element('span', undefined, part.name));
      left.append(label, element('div', 'hint', part.blurb));

      const button = element('button', fitted ? 'buy fitted' : 'buy');
      button.type = 'button';
      if (!owned) {
        button.textContent = money(part.price);
        button.disabled = g.cash < part.price;
        button.addEventListener('click', () => {
          if (g.buyPart(part.id)) this.refresh();
        });
      } else {
        const full = g.state.parts.length >= g.slots();
        button.textContent = fitted ? 'Fitted' : 'Fit';
        button.disabled = !fitted && full;
        button.addEventListener('click', () => {
          if (g.togglePart(part.id)) this.refresh();
        });
      }

      row.append(left, button);
      host.append(row);
    }

    const next = PARTS.find((part) => !g.inventory.includes(part.id) && g.rep < part.rep);
    if (next) {
      const row = element('div', 'row');
      const left = element('div');
      left.append(element('div', 'label', 'More on the shelf'));
      left.append(element('div', 'hint', `${next.name} opens up at ${next.rep} rep.`));
      row.append(left, element('span', 'slotcount', `${g.rep} / ${next.rep}`));
      host.append(row);
    }
  }
}

export function partName(id: string): string {
  return partById(id)?.name ?? id;
}

export function vehicleName(id: string): string {
  return vehicleById(id).name;
}
