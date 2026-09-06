import type { Garage, GarageSave } from './garage';

const KEY = 'getaway.save.v1';

/**
 * The garage is the only thing that survives a shift, so it is the only thing worth writing
 * down. Every access is guarded: private windows, cleared site data and browsers that refuse
 * storage outright all have to leave the game playable rather than blank.
 */
export function saveGarage(garage: Garage): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(garage.save()));
  } catch {
    // Storage refused. The night still counts; it just will not be there tomorrow.
  }
}

export function loadGarage(garage: Garage): boolean {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return false;
    const data = JSON.parse(raw) as GarageSave;
    if (data.version !== 1) return false;
    garage.load(data);
    return true;
  } catch {
    return false;
  }
}

export function clearSave(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing to do.
  }
}
