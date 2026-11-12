import { renderCard } from '../components/card/card.js';
import { themeClass } from '../shared/theme.js';
import { dashboard, grid } from './dashboard.module.css';
import './dashboard-shared.js';

export function renderDashboard() {
  return `<section class="${dashboard} ${themeClass}">
    <div class="${grid}">${renderCard('lazy dashboard')}</div>
  </section>`;
}

export function loadDashboardDetails() {
  return import(/* webpackChunkName: "dashboard-details" */ './details.js');
}
