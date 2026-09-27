---
title: Blog
reading_width: true
section_sidebar: true
eyebrow: Life beyond the measurements
section_number: '05'
lead: Fieldwork, milestones, and the everyday moments that make us grow together.
robots: index, follow
nav:
  order: 5
  tooltip: Lab journal
---
{% assign years = site.data.blog | sort: 'year' | reverse %}
<div class="browse-layout">
<aside class="browse-sidebar"><p class="publication-nav-label">Lab journal</p><nav class="section-nav browse-nav" data-section-nav aria-label="Journal years">{% for year in years %}<a href="#year-{{ year.year }}">{{ year.year }}<span>{{ year.gallery.size }}</span></a>{% endfor %}</nav></aside>
<div class="browse-content">
{% for year in years %}<section class="journal-year" id="year-{{ year.year }}"><div class="section-heading"><h2>{{ year.year }}</h2><span class="item-count">{{ year.gallery.size }} moments</span></div><div class="journal-grid">{% for entry in year.gallery %}<figure class="journal-entry">{% if entry.link %}<a href="{{ entry.link | relative_url }}">{% endif %}<div class="journal-image"><img src="{{ entry.image | relative_url | uri_escape }}" alt="{{ entry.caption | escape }}" loading="lazy"></div><figcaption><span>{{ entry.caption }}</span>{% if entry.link %}<span aria-hidden="true">↗</span>{% endif %}</figcaption>{% if entry.link %}</a>{% endif %}</figure>{% endfor %}</div></section>{% endfor %}
</div>
</div>
