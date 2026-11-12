import { renderAppShell } from './components/app-shell.js';
import { cycleA } from './cycle/a.js';
import { sharedLabel } from './shared/labels.js';
import './styles/main.css';
import './styles/shared.css';

document.body.innerHTML = renderAppShell(`${sharedLabel} / ${cycleA()}`);

export function loadDashboard() {
  return import(/* webpackChunkName: "dashboard" */ './lazy/dashboard.js');
}

export function loadSettings() {
  return import(/* webpackChunkName: "settings" */ './lazy/settings.js');
}

// The same lazy node is requested twice. Rspack should keep one async chunk,
// while the output graph still has enough module evidence to match it.
Promise.all([loadDashboard(), loadDashboard()]);

if (window.location.hash === '#settings') {
  loadSettings();
}
