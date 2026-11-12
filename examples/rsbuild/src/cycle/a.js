import { cycleBName } from './b.js';

export const cycleAName = 'cycle-a';

export function cycleA() {
  return `${cycleAName}:${cycleBName}`;
}
