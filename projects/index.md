---
title: Projects
reading_width: true
section_sidebar: true
eyebrow: Questions into action
section_number: '03'
lead: Collaborative work connecting exercise physiology with sport, health, and everyday life.
robots: index, follow
nav:
  order: 3
  tooltip: Ongoing and completed projects
---
{% assign ongoing = site.data.projects | where: 'status', 'ongoing' %}
{% assign completed = site.data.projects | where: 'status', 'completed' %}
<div class="browse-layout">
<aside class="browse-sidebar"><p class="publication-nav-label">Research projects</p><nav class="section-nav browse-nav" data-section-nav aria-label="Project groups"><a href="#ongoing">Ongoing <span>{{ ongoing.size }}</span></a><a href="#completed">Completed <span>{{ completed.size }}</span></a></nav></aside>
<div class="browse-content">
<section class="project-group" id="ongoing"><div class="section-heading"><h2>In progress</h2><span class="item-count">{{ ongoing.size }}</span></div>{% for project in ongoing %}{% include project-row.html project=project %}{% endfor %}</section>
<section class="project-group" id="completed"><div class="section-heading"><h2>Completed work</h2><span class="item-count">{{ completed.size }}</span></div>{% for project in completed %}{% include project-row.html project=project %}{% endfor %}</section>
</div>
</div>
