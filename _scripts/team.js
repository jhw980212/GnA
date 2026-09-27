/* Progressive member filtering. Content and counts originate in _members. */
(() => {
  const directory = document.querySelector('[data-people-directory]');
  if (!directory) return;
  const links = [...directory.querySelectorAll('[data-people-filter]')];
  const groups = [...directory.querySelectorAll('[data-roster-group]')];
  const input = directory.querySelector('#member-search');
  const clear = directory.querySelector('[data-clear-search]');
  const status = directory.querySelector('[data-people-status]');
  const empty = directory.querySelector('[data-people-empty]');
  const normalize = value => value.normalize('NFKC').toLocaleLowerCase().replace(/[,·]/g, ' ').replace(/\s+/g, ' ').trim();
  const cards = new Map(groups.map(group => [group, [...group.querySelectorAll('[data-member]')].map(element => ({ element, text: normalize(element.dataset.search) }))]));
  let selected = 'current';

  // Track the section in view without changing the user's selected filter.
  function updateLocation() {
    const offset = document.querySelector('.site-header').getBoundingClientRect().height + 100;
    const visible = groups.filter(group => !group.hidden && group.getClientRects().length);
    let current = visible.filter(group => group.getBoundingClientRect().top <= offset).pop();
    if (visible.length && innerHeight + scrollY >= document.documentElement.scrollHeight - 2) current = visible[visible.length - 1];
    const key = current ? (current.dataset.bucket === 'alumni' ? 'alumni' : current.id) : selected;
    const viewed = visible.length ? links.find(link => link.dataset.peopleFilter === key) : null;
    directory.querySelector('.people-filters').classList.toggle('has-viewing', Boolean(viewed));
    links.forEach(link => {
      link.classList.toggle('is-viewing', link === viewed);
      if (link === viewed) link.setAttribute('aria-label', `${link.dataset.label}, currently in view`);
      else link.removeAttribute('aria-label');
    });
  }
  let pending = false;
  function scheduleLocation() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; updateLocation(); });
  }

  function apply() {
    const terms = normalize(input.value).split(' ').filter(Boolean);
    let count = 0;
    for (const group of groups) {
      const included = selected === 'all' || selected === group.id || selected === group.dataset.bucket;
      let groupCount = 0;
      for (const card of cards.get(group)) {
        card.element.hidden = !included || !terms.every(term => card.text.includes(term));
        if (!card.element.hidden) groupCount++;
      }
      group.hidden = !included || (terms.length > 0 && groupCount === 0);
      group.querySelector('[data-group-count]').textContent = included && terms.length ? groupCount : cards.get(group).length;
      count += groupCount;
    }
    directory.querySelector('[data-alumni-groups]').hidden = groups.filter(group => group.dataset.bucket === 'alumni').every(group => group.hidden);
    links.forEach(link => {
      if (link.dataset.peopleFilter === selected) link.setAttribute('aria-current', 'true');
      else link.removeAttribute('aria-current');
    });
    const label = links.find(link => link.dataset.peopleFilter === selected).dataset.label;
    status.textContent = `${count} ${count === 1 ? 'person' : 'people'} · ${label}${terms.length ? ' · Search results' : ''}`;
    clear.hidden = !input.value;
    empty.hidden = count !== 0 || !terms.length;
    scheduleLocation();
  }
  function fromHash() {
    const match = links.find(link => link.getAttribute('href') === location.hash);
    selected = match ? match.dataset.peopleFilter : 'current';
    apply();
  }
  links.forEach(link => link.addEventListener('click', event => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    selected = link.dataset.peopleFilter;
    history.replaceState(null, '', link.getAttribute('href'));
    apply();
    const headerHeight = document.querySelector('.site-header').getBoundingClientRect().height;
    const top = directory.getBoundingClientRect().top;
    if (top < headerHeight + 16) window.scrollTo({ top: scrollY + top - headerHeight - 16, behavior: 'auto' });
  }));
  input.addEventListener('input', apply);
  function resetSearch() { input.value = ''; apply(); input.focus(); }
  clear.addEventListener('click', resetSearch);
  directory.querySelector('[data-reset-search]').addEventListener('click', resetSearch);
  window.addEventListener('hashchange', fromHash);
  window.addEventListener('scroll', scheduleLocation, { passive: true });
  window.addEventListener('resize', scheduleLocation);
  new ResizeObserver(scheduleLocation).observe(directory);
  directory.querySelector('[data-people-search]').hidden = false;
  fromHash();
})();
