/*
 * icons.js — the icons of the sub tabs, the results-panel tabs, the number tiles, the chart titles,
 * the Summary cards and the buttons: 16 × 16 line drawings in currentColor, like the inputs' icons
 * (tree.js). A tab or button has the plain icon; a tile, a chart title or a card has it in a tinted
 * badge, like the input groups. An icon is a name here, an input icon's name (PICON) or a view's
 * number (its tab icon, TAB_ICONS); both are read when drawn, after every script has loaded.
 */
const UI_S = 'fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"';
const UI_ICONS = {
  table: `<rect x="2.5" y="3" width="11" height="10" rx="1.5" ${UI_S}/><path d="M2.5 6.5h11M2.5 9.8h11M6.5 6.5v6.5" ${UI_S} opacity=".6"/>`,
  probe: `<path d="M8 1.5v3M8 11.5v3M1.5 8h3M11.5 8h3" ${UI_S}/><circle cx="8" cy="8" r="3.2" ${UI_S}/>`,
  cut: `<path d="M2.5 12.5l11-9" ${UI_S}/><path d="M1.2 10.9l2.6 3.2M12.2 1.9l2.6 3.2" ${UI_S}/>`,
  profile: `<path d="M3.5 2.5v11" ${UI_S} opacity=".6"/><path d="M3.5 4.5h3M3.5 8h7M3.5 11.5h9.5" ${UI_S}/><path d="M9.8 10 11.3 11.5 9.8 13" ${UI_S} opacity=".7"/>`,
  shear: `<path d="M2 13h12" ${UI_S} opacity=".55"/><path d="M2 3.5h8.5M8.5 1.8l2 1.7-2 1.7" ${UI_S}/><path d="M4 13 8 3.5" ${UI_S} opacity=".7"/>`,
  flow: `<path d="M2 4.5h12M2 11.5h12" ${UI_S} opacity=".55"/><path d="M3.5 8h8M9.5 6l2 2-2 2" ${UI_S}/>`,
  conv: `<path d="M2.5 2.5v11h11" ${UI_S} opacity=".55"/><path d="M4 4c1.2 0 1.6 3.5 3 3.5s1.6-1.6 2.6-1.6 1.6 4.6 3.4 5.6" ${UI_S}/>`,
  warn: `<path d="M8 2.5 14 13H2z" ${UI_S}/><path d="M8 6.5v3" ${UI_S}/><circle cx="8" cy="11.2" r=".8" fill="currentColor"/>`,
  msg: `<path d="M2.5 3.5h11v7.5H7l-3 2.5v-2.5H2.5z" ${UI_S}/><path d="M5 6.3h6M5 8.6h4" ${UI_S} opacity=".6"/>`,
  more: `<circle cx="3.8" cy="8" r="1.1" fill="currentColor"/><circle cx="8" cy="8" r="1.1" fill="currentColor"/><circle cx="12.2" cy="8" r="1.1" fill="currentColor"/>`,
  history: `<path d="M3.2 8a4.8 4.8 0 1 0 1.4-3.4" ${UI_S}/><path d="M4.4 2.2v2.6H7" ${UI_S}/><path d="M8 5.5V8l1.8 1.2" ${UI_S} opacity=".7"/>`,
  cases: `<path d="M4.5 2.5h7v11L8 11l-3.5 2.5z" ${UI_S}/>`,
  method: `<path d="M8 4.2c-1.6-1.2-3.6-1.4-5.5-.9v9.2c1.9-.5 3.9-.3 5.5.9 1.6-1.2 3.6-1.4 5.5-.9V3.3C11.6 2.8 9.6 3 8 4.2zM8 4.2v9.2" ${UI_S}/>`,
  runs: `<path d="M5.5 4h8M5.5 8h8M5.5 12h8" ${UI_S}/><circle cx="2.8" cy="4" r=".9" fill="currentColor"/><circle cx="2.8" cy="8" r=".9" fill="currentColor"/><circle cx="2.8" cy="12" r=".9" fill="currentColor"/>`,
  tune: `<path d="M2.5 4.5h1.6M7 4.5h6.5M2.5 8h6.6M12 8h1.5M2.5 11.5h3.1M8.4 11.5h5.1" ${UI_S} opacity=".6"/><circle cx="5.5" cy="4.5" r="1.4" ${UI_S}/><circle cx="10.5" cy="8" r="1.4" ${UI_S}/><circle cx="7" cy="11.5" r="1.4" ${UI_S}/>`,
  range: `<path d="M2.5 8h11M5 5.5 2.5 8 5 10.5M11 5.5l2.5 2.5-2.5 2.5" ${UI_S}/>`,
  ratio: `<path d="M2.5 13.5 13.5 2.5" ${UI_S} opacity=".55"/><path d="M2.5 3.5h5M8.5 12.5h5" ${UI_S}/>`,
  diff: `<path d="M8 2.5v6M5 5.5h6M5 12.5h6" ${UI_S}/>`,
  section: `<path d="M2 12.5h12" ${UI_S} opacity=".55"/><path d="M3 12.5c1-5 3-8 5-8s4 3 5 8" ${UI_S}/>`,
  top: `<rect x="2.5" y="3.5" width="11" height="9" rx="1.5" ${UI_S} opacity=".55"/><path d="M2.5 8.5c2-1.4 3.5-1.4 5.5 0s3.5 1.4 5.5 0" ${UI_S}/>`,
  zoom: `<circle cx="7" cy="7" r="4.3" ${UI_S}/><path d="M10.2 10.2 13.5 13.5M5.2 7h3.6M7 5.2v3.6" ${UI_S}/>`,
  map: `<rect x="2.5" y="2.5" width="11" height="11" rx="1.5" ${UI_S}/><path d="M2.5 8.5c2.5-2 4.5 1 7-1s3-2 4-2M6 2.5c0 3 2 5 7.5 6" ${UI_S} opacity=".6"/>`,
  bars: `<path d="M2.5 13.5h11" ${UI_S} opacity=".55"/><path d="M4.5 13V8M8 13V4M11.5 13V6.5" ${UI_S}/>`,
  play: `<path d="M4.5 3v10l8-5z" fill="currentColor"/>`,
  pause: `<rect x="4" y="3.2" width="2.8" height="9.6" rx=".8" fill="currentColor"/><rect x="9.2" y="3.2" width="2.8" height="9.6" rx=".8" fill="currentColor"/>`,
  stop: `<rect x="4" y="4" width="8" height="8" rx="1" fill="currentColor"/>`,
  restart: `<path d="M3.2 6.2A5 5 0 1 1 3 9.5" ${UI_S}/><path d="M2.6 2.8v3.6h3.6" ${UI_S}/>`,
  plus: `<path d="M8 3v10M3 8h10" ${UI_S}/>`,
  trash: `<path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.7 8.5h5.6l.7-8.5" ${UI_S}/><path d="M7 7v3.5M9 7v3.5" ${UI_S} opacity=".6"/>`,
  upload: `<path d="M8 10.5V3M4.8 6.2 8 3l3.2 3.2M3 12.5h10" ${UI_S}/>`,
  download: `<path d="M8 2.5v7.5M4.8 7l3.2 3.2L11.2 7M3 12.5h10" ${UI_S}/>`,
  goTo: `<path d="M9 3h4v4M13 3 7.5 8.5" ${UI_S}/><path d="M11.5 9.5V13h-9V4.5H6" ${UI_S} opacity=".7"/>`,
};
/** The drawing of an icon: a name here, an input icon's name, or a view's number. */
function uiIconPath(name) {
  if (typeof name === 'number') return typeof TAB_ICONS !== 'undefined' ? TAB_ICONS[name] || '' : '';
  if (UI_ICONS[name]) return UI_ICONS[name];
  return typeof PICON !== 'undefined' && PICON[name] ? PICON[name] : UI_ICONS.table;
}
/** A plain icon (a tab, a menu item, a button): no text, so every label reads as before. */
const uiIco = name => `<svg class="ui-i" viewBox="0 0 16 16" aria-hidden="true">${uiIconPath(name)}</svg>`;
/** An icon in a tinted badge (a tile, a chart title, a card). */
const uiBadge = name => `<i class="ico-b" aria-hidden="true">${uiIco(name)}</i>`;

/** Each view's sub tab icon is its tab icon; the Flow stages 1D, 2D, 3D have their pages' icons. */
const GROUP_ICON = { '1d': 8, '2d': 4, '3d': 9 };
/** The results panels' tabs (2D, DOE, Measured data, the modules' history). */
const DOCK_ICON = {
  metrics: 'table', probes: 'probe', cut: 'cut', cuts: 'cut', across: 11, profiles: 'profile', fibre: 'fibre', conv: 'conv', problems: 'warn', msgs: 'msg',
  mesh: 'grading', cases: 'cases', history: 'history', method: 'method', design: 'doe', runs: 'runs', compare: 6, fit: 'tune',
};
/** A number tile's icon, from its label (first match). */
const TILE_ICON = [
  [/contact line/i, 1], [/flow across/i, 11], [/film range|range across/i, 'range'], [/variation/i, 'wave'], [/3D vs 2D/i, 'diff'],
  [/ripple|amplitude/i, 'ripple'], [/radius/i, 'radius'], [/time|levelling/i, 'period'], [/yield/i, 'yield'], [/share of film/i, 'oven'],
  [/flow rate/i, 'flow'], [/pressure/i, 'pressure'], [/shear/i, 'shear'], [/film \/ gap|gap at edge \/ film/i, 'ratio'], [/^film at/i, 'film'], [/gap/i, 'height'],
  [/strip at|full width/i, 'position'], [/blade \+ film|underside/i, 'shape'], [/hexahedra|nodes|unknowns/i, 'mesh'], [/numerical/i, 'tolerance'],
  [/within 1 %/i, 'length'], [/lubrication|filmThickness/i, 'model'], [/film|q \/ u/i, 'film'],
];
const tileIcon = label => { const t = String(label); for (const [re, ic] of TILE_ICON) if (re.test(t)) return ic; return 'table'; };
/** A tile's label with its badge. */
const tileLabel = label => `${uiBadge(tileIcon(label))}${label}`;
/** A DOE chart's icon: its plot (the response against a factor, the map of two, the main effects). */
const DOE_PLOT_ICON = { response: 7, map: 'map', effects: 'bars' };
