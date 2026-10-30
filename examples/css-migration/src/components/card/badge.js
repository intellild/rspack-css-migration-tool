// Repeating the same CSS Module import through a nested module exercises
// module de-duplication without relying on the emitted class hash.
import { badge } from './card.module.css';

export function renderBadge() {
  return `<span class="${badge}">shared CSS Module</span>`;
}
