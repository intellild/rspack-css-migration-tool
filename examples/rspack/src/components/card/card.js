import { renderBadge } from './badge.js';
import { card, heading } from './card.module.css';
import { sharedLabel } from '../../shared/labels.js';

export function renderCard(message) {
  return `<section class="${card}">
    <h2 class="${heading}">${sharedLabel}</h2>
    <p>${message}</p>
    ${renderBadge()}
  </section>`;
}
