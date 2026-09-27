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
{% assign entries = site.blog | where_exp: 'entry', 'entry.published != false' | where_exp: 'entry', 'entry.date <= site.time' | sort: 'date' | reverse %}
{% assign years = entries | group_by_exp: 'entry', "entry.date | date: '%Y'" %}
<div class="browse-layout">
<aside class="browse-sidebar"><p class="publication-nav-label">Lab journal</p><nav class="section-nav browse-nav" data-section-nav aria-label="Journal years">{% for year in years %}<a href="#year-{{ year.name }}">{{ year.name }}<span>{{ year.items.size }}</span></a>{% endfor %}</nav></aside>
<div class="browse-content">
{% for year in years %}
<section class="journal-year" id="year-{{ year.name }}">
  <div class="section-heading"><h2>{{ year.name }}</h2><span class="item-count">{{ year.items.size }} moments</span></div>
  <div class="journal-grid">
    {% for entry in year.items %}
    <figure class="journal-entry{% unless entry.image %} journal-entry--text{% endunless %}">
      <a href="{{ entry.url | relative_url }}">
        {% if entry.image %}<div class="journal-image"><img src="{{ entry.image | relative_url | uri_escape }}" alt="{{ entry.image_alt | default: entry.title | escape }}" loading="lazy"></div>{% endif %}
        <figcaption><span>{{ entry.title | escape }}</span><span aria-hidden="true">↗</span></figcaption>
      </a>
    </figure>
    {% endfor %}
  </div>
</section>
{% endfor %}
{% if entries.size == 0 %}<p>등록된 활동 기록이 없습니다.</p>{% endif %}
</div>
</div>
