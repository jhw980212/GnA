/* Shared mobile navigation; links remain available if JavaScript is unavailable. */
(() => {
  const header = document.querySelector('.site-header');
  const toggle = header?.querySelector('.nav-toggle');
  const nav = header?.querySelector('#site-navigation');
  if (!toggle || !nav) return;
  const mobile = matchMedia('(max-width: 760px)');
  const icon = toggle.querySelector('path');
  const setOpen = open => {
    toggle.setAttribute('aria-expanded', String(open));
    icon.setAttribute('d', open ? 'M3 3l14 14M17 3L3 17' : 'M2 6h16M2 14h16');
  };
  header.classList.add('navigation-ready');
  toggle.addEventListener('click', () => setOpen(toggle.getAttribute('aria-expanded') !== 'true'));
  nav.addEventListener('click', event => {
    if (event.target.closest('a')) setOpen(false);
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && toggle.getAttribute('aria-expanded') === 'true') {
      setOpen(false);
      toggle.focus();
    }
  });
  document.addEventListener('click', event => {
    if (!header.contains(event.target)) setOpen(false);
  });
  header.addEventListener('focusout', event => {
    if (!header.contains(event.relatedTarget)) setOpen(false);
  });
  mobile.addEventListener('change', () => setOpen(false));
  window.addEventListener('pageshow', () => setOpen(false));
})();
