/*
 * welcome.js — the welcome screen: shown the first time the app is opened (and from Help > Welcome):
 * what the app is for, and "What do you want to do?" cards that take you to the right tab.
 */

const WELCOME_KEY = 'bladeCoatDefectLab.welcome.v1';
// (WF-2: a card opens a view by its number, or a tab's page by its key (nav))
const WELCOME_CARDS = [
  { nav: 'line', icon: 'process', t: 'See the whole line', d: 'Every stage from the mixer to the graphene film: where each stands and its answers.' },
  { tab: 0, icon: 'playback', t: 'See the process', d: 'An animation of the slurry metered under the blade, from start-up.' },
  { tab: 1, icon: 'angle', t: 'Will slurry reach the dry edge?', d: 'Where the meniscus leaves the blade, across the whole web.' },
  { tab: 2, icon: 'edge', t: 'Will the web edge scallop?', d: 'How the wet edge grows beads between the blade and the oven.' },
  { tab: 3, icon: 'ripple', t: 'Will streaks level out?', d: 'How ripples on the film surface flatten before the oven.' },
  { tab: 4, icon: 'mesh', t: 'See the flow in detail', d: '2D CFD of the flow under the blade at four places across the web.' },
  { nav: 'dry', icon: 'oven', t: 'Is the film dry at the oven\'s exit?', d: 'Its water and temperature through the room and the oven\'s zones.' },
  { nav: 'peel', icon: 'film', t: 'Will the film crack or curl?', d: 'The dry film on the web to the peel: stress, cracks, peel force and curl.' },
  { nav: 'gfilm', icon: 'density', t: 'What comes out of the furnace?', d: 'The graphene film: its thickness and spread, density and heat conduction.' },
  { tab: 5, icon: 'doe', t: 'Find what matters most', d: 'Vary 1–3 settings together and see which one changes the film most.' },
  { tab: 6, icon: 'data', t: 'Compare with my measurements', d: 'Import a CSV, compare it with the models, and fit the uncertain inputs.', act: () => importMeasured() },
  { tab: null, icon: 'process', t: 'Open a project', d: 'Continue from a saved project file (.bcdl).', act: () => openProject() },
];
function openWelcome() {
  let dlg = document.getElementById('welcomeDlg');
  if (!dlg) { dlg = document.createElement('dialog'); dlg.id = 'welcomeDlg'; dlg.className = 'img-dlg welcome-dlg'; dlg.setAttribute('aria-labelledby', 'welcomeH'); document.body.appendChild(dlg); }
  dlg.innerHTML = `<div class="wel-head">
      <div class="wel-logo"><svg viewBox="0 0 16 16" aria-hidden="true"><rect width="16" height="16" rx="3" fill="currentColor" opacity=".14"/><path d="M2 12.5h12" stroke="currentColor" stroke-width="1.3"/><path d="M3 12.5c2.5-.2 4-1.6 5.2-4.4L10 3.5h3.5l-2.6 9" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg></div>
      <div><h2 id="welcomeH">Welcome to ${PROJ_APP}</h2>
      <p>Predicts where your line goes wrong, stage by stage, from your process settings: the coating under the blade, the drying, the film peeled, wound and cut, the pre heat treatment and the furnace.</p></div>
      <button type="button" class="icon-btn" data-close aria-label="Close">✕</button></div>
    <h3 class="wel-q">What do you want to do?</h3>
    <div class="wel-grid">${WELCOME_CARDS.map((c, i) => `<button type="button" class="wel-card" data-card="${i}"><span class="wel-ic">${picon(c.icon)}</span><b>${c.t}</b><span>${c.d}</span></button>`).join('')}</div>
    <div class="wel-foot"><p><b>How it works:</b> the tabs follow your process from left to right: the <b>Line</b> (a map of every stage and its answers), <b>Materials</b>, then the eight stages, <b>Results</b> and <b>Studies</b>. Each stage's tab has its own inputs on the left (the defaults are a typical case). The <b>Help</b> menu has a guide to every tab.</p>
      <label class="fv-chk"><input type="checkbox" id="welAgain"${welcomeAlways() ? ' checked' : ''}> Show this when the app opens</label>
      <button type="button" class="btn btn-secondary btn-sm" data-close>Just look around</button></div>`;
  dlg.querySelectorAll('[data-close]').forEach(b => { b.onclick = () => dlg.close(); });
  dlg.querySelector('#welAgain').onchange = e => { try { localStorage.setItem(WELCOME_KEY, e.target.checked ? 'show' : 'seen'); } catch (err) { /* not kept */ } };
  dlg.querySelectorAll('[data-card]').forEach(b => {
    b.onclick = () => {
      const c = WELCOME_CARDS[+b.dataset.card];
      dlg.close();
      if (c.nav) navGo(c.nav); else if (c.tab != null) { tab = c.tab; render(); }
      if (c.act) c.act();
    };
  });
  dlg.addEventListener('close', () => { try { if (!localStorage.getItem(WELCOME_KEY)) localStorage.setItem(WELCOME_KEY, 'seen'); } catch (e) { /* not kept */ } }, { once: true });
  if (!dlg.open) dlg.showModal();
  const first = dlg.querySelector('.wel-card'); if (first) first.focus();
}
function welcomeAlways() { try { return localStorage.getItem(WELCOME_KEY) === 'show'; } catch (e) { return false; } }
function welcomeWanted() { try { const v = localStorage.getItem(WELCOME_KEY); return v == null || v === 'show'; } catch (e) { return false; } }
// (on opening: the welcome first, unless there is a session to continue: its bar asks first)
setTimeout(() => {
  if (!welcomeWanted() || window.NO_WELCOME) return;
  if (document.querySelector('.session-bar')) return;
  openWelcome();
}, 700);
