// Theme bootstrap (SPEC §4.5). Loaded as an external file before the app so the first
// paint already has the right theme under the strict CSP (script-src 'self').
(function () {
  var theme = 'dark';
  try {
    var pref = window.localStorage.getItem('vel.theme');
    if (pref === 'light' || pref === 'dark') theme = pref;
    else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) theme = 'light';
  } catch {
    /* storage blocked: keep the dark default */
  }
  document.documentElement.setAttribute('data-theme', theme);
})();
