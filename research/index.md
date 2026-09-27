---
title: Publications
reading_width: true
section_sidebar: true
lead: Studies of exercise physiology, cardiovascular function, athletic performance, physical activity, growth, and aging.
robots: index, follow
nav:
  order: 2
---
{% assign international = site.data.citations | where: 'kind', 'paper' | where: 'region', 'international' %}
{% assign domestic = site.data.citations | where: 'kind', 'paper' | where: 'region', 'domestic' %}
{% assign phd = site.data.citations | where: 'kind', 'thesis' | where: 'degree', 'Ph.D.' %}
{% assign ms = site.data.citations | where: 'kind', 'thesis' | where: 'degree', 'M.S.' %}
<div class="publication-layout browse-layout">
<aside class="publication-sidebar browse-sidebar"><p class="publication-nav-label">Browse publications</p><nav class="section-nav publication-nav browse-nav" data-section-nav aria-label="Publication categories"><a href="#international">International <span>{{ international.size }}</span></a><a href="#domestic">Domestic <span>{{ domestic.size }}</span></a>{% if phd.size > 0 %}<a href="#doctoral">Ph.D. theses <span>{{ phd.size }}</span></a>{% endif %}<a href="#masters">M.S. theses <span>{{ ms.size }}</span></a></nav></aside>
<div class="publication-content browse-content">
<div class="publication-tools" hidden data-publication-tools><label for="publication-search">Find a publication</label><div class="publication-search"><svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/></svg><input id="publication-search" type="search" placeholder="Search title, author, or journal…" autocomplete="off"></div><p id="publication-results" role="status" aria-live="polite"></p></div>
<div class="publications-list">
{% include publication-group.html items=international title='International papers' id='international' %}
{% include publication-group.html items=domestic title='Domestic papers' id='domestic' %}
{% if phd.size > 0 %}{% include publication-group.html items=phd title='Doctoral theses' id='doctoral' %}{% endif %}
{% include publication-group.html items=ms title="Master's theses" id='masters' %}
</div>
<p class="empty-state" id="publication-empty" hidden>No publications match your search. Try another title, author, or journal.</p>
</div>
</div>
