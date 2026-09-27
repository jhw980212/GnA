/* Progressive enhancement: every publication remains visible without JavaScript. */
(() => {
  const tools = document.querySelector('[data-publication-tools]');
  if (!tools) return;
  const input = tools.querySelector('input');
  const groups = [...document.querySelectorAll('.publication-group')];
  const rows = [...document.querySelectorAll('[data-publication]')];
  const categoryLinks = [...document.querySelectorAll('.publication-nav a')];
  const normalized = rows.map(row => row.textContent.toLocaleLowerCase().normalize('NFKC'));
  const update = () => {
    const terms = input.value.trim().toLocaleLowerCase().normalize('NFKC').split(/\s+/).filter(Boolean);
    let count = 0;
    rows.forEach((row, i) => { row.hidden = !terms.every(term => normalized[i].includes(term)); if (!row.hidden) count++; });
    groups.forEach(group => {
      group.hidden = ![...group.querySelectorAll('[data-publication]')].some(row => !row.hidden);
      [...group.querySelectorAll('.publication-year')].forEach(year => {
        let next = year.nextElementSibling, visible = false;
        while (next && !next.classList.contains('publication-year')) { if (next.matches('[data-publication]') && !next.hidden) visible = true; next = next.nextElementSibling; }
        year.hidden = !visible;
      });
    });
    document.getElementById('publication-results').textContent = `${count} of ${rows.length} publications`;
    document.getElementById('publication-empty').hidden = count !== 0;
    document.dispatchEvent(new Event('section-navigation:update'));
  };
  tools.hidden = false;
  const query = new URLSearchParams(location.search).get('search');
  if (query) input.value = query.replaceAll('"', '');
  input.addEventListener('input', update);
  categoryLinks.forEach(link => link.addEventListener('click', () => {
    if (input.value) { input.value = ''; update(); }
  }));
  update();
})();
