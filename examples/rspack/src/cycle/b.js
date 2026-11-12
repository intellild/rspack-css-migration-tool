import { cycleAName } from './a.js';

export const cycleBName = 'cycle-b';

export function cycleB() {
  return `${cycleBName}:${cycleAName}`;
}
