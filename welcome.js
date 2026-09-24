/*
 * welcome.js — the welcome screen: shown the first time the app is opened (and from Help > Welcome):
 * what the app is for, and "What do you want to do?" cards that take you to the right tab.
 */

const WELCOME_KEY = 'bladeCoatDefectLab.welcome.v1';
const WELCOME_CARDS = [
  { tab: 0, icon: 'playback', t: 'See the process', d: 'An animation of the slurry metered under the blade, from start-up.' },
  { tab: 1, icon: 'angle', t: 'Will slurry reach the dry edge?', d: 'Where the meniscus leaves the blade, across the whole web.' },
  { tab: 2, icon: 'edge', t: 'Will the web edge scallop?', d: 'How the wet edge grows beads between the blade and the oven.' },
  { tab: 3, icon: 'ripple', t: 'Will streaks level out?', d: 'How ripples on the film surface flatten before the oven.' },
  { tab: 4, icon: 'mesh', t: 'See the flow in detail', d: '2D CFD of the flow under the blade at four places across the web.' },
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
      <p>Predicts where blade coating goes wrong: where the slurry meets the blade, how the web edge and the film surface settle before the oven, and the flow under the blade in detail, from your process settings.</p></div>
      <button type="button" class="icon-btn" data-close aria-label="Close">✕</button></div>
    <h3 class="wel-q">What do you want to do?</h3>
    <div class="wel-grid">${WELCOME_CARDS.map((c, i) => `<button type="button" class="wel-card" data-card="${i}"><span class="wel-ic">${picon(c.icon)}</span><b>${c.t}</b><span>${c.d}</span></button>`).join('')}</div>
    <div class="wel-foot"><p><b>How it works:</b> set your process in the <b>Model bar</b> on the left (the defaults are a typical case); each tab answers one question from those inputs. The <b>Help</b> menu has a guide to every tab.</p>
      <label class="fv-chk"><input type="checkbox" id="welAgain"${welcomeAlways() ? ' checked' : ''}> Show this when the app opens</label>
      <button type="button" class="btn btn-secondary btn-sm" data-close>Just look around</button></div>`;
  dlg.querySelectorAll('[data-close]').forEach(b => { b.onclick = () => dlg.close(); });
  dlg.querySelector('#welAgain').onchange = e => { try { localStorage.setItem(WELCOME_KEY, e.target.checked ? 'show' : 'seen'); } catch (err) { /* not kept */ } };
  dlg.querySelectorAll('[data-card]').forEach(b => {
    b.onclick = () => {
      const c = WELCOME_CARDS[+b.dataset.card];
      dlg.close();
      if (c.tab != null) { tab = c.tab; render(); }
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
