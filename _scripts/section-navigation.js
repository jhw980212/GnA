/* Shared scroll position indicator; ordinary anchor links also work without JS. */
(() => {
  const menus = [...document.querySelectorAll('[data-section-nav]')].map(nav => ({
    nav,
    entries: [...nav.querySelectorAll('a[href^="#"]')].map(link => ({ link, section: document.getElementById(link.hash.slice(1)) })).filter(entry => entry.section),
  }));
  if (!menus.length) return;
  const header = document.querySelector('.site-header');
  function update() {
    const offset = header.getBoundingClientRect().height + 100;
    for (const { entries } of menus) {
      const visible = entries.filter(({ section }) => section.getClientRects().length && !section.hidden);
      let current = visible.filter(({ section }) => section.getBoundingClientRect().top <= offset).pop() || visible[0];
      // A short final section may never reach the top of the viewport.
      if (visible.length && innerHeight + scrollY >= document.documentElement.scrollHeight - 2) current = visible[visible.length - 1];
      entries.forEach(({ link }) => {
        if (link === current?.link) link.setAttribute('aria-current', 'location');
        else link.removeAttribute('aria-current');
      });
    }
  }
  let pending = false;
  function schedule() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; update(); });
  }
  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', schedule);
  window.addEventListener('hashchange', schedule);
  window.addEventListener('load', schedule);
  document.addEventListener('section-navigation:update', update);
  document.addEventListener('toggle', schedule, true);
  new ResizeObserver(schedule).observe(document.querySelector('main'));
  update();
})();
