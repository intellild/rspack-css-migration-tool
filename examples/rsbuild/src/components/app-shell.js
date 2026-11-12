import { renderCard } from './card/card.js';
import { shell, title } from './app-shell.module.css';
import { themeClass } from '../shared/theme.js';
import '../styles/shared.css';

export function renderAppShell(message) {
  return `<main class="${shell} ${themeClass}">
    <h1 class="${title}">CSS migration graph</h1>
    ${renderCard(message)}
  </main>`;
}
