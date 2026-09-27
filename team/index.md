---
title: Team
custom_heading: true
description: Meet the researchers and alumni of the Growth and Aging Lab at Kyung Hee University.
robots: index, follow
nav:
  order: 4
  tooltip: Our team and alumni
---
{% assign phd_candidates = site.members | where_exp: 'm', "m.role == 'phd' and m.coursework == 'completed'" | sort_natural: 'path' %}
{% assign phd_students = site.members | where_exp: 'm', "m.role == 'phd' and m.coursework != 'completed'" | sort_natural: 'path' %}
{% assign ms_students = site.members | where_exp: 'm', "m.role == 'ms' and m.coursework != 'completed'" | sort_natural: 'path' %}
{% assign undergraduates = site.members | where_exp: 'm', "m.role == 'undergraduate' or m.role == 'undergrad'" | sort_natural: 'path' %}
{% assign phd_alumni = site.members | where: 'role', 'alumni' | where: 'degree', 'phd' | sort_natural: 'path' %}
{% assign ms_alumni = site.members | where: 'role', 'alumni' | where: 'degree', 'master' | sort_natural: 'path' %}
{% assign current_count = phd_candidates.size | plus: phd_students.size | plus: ms_students.size | plus: undergraduates.size %}
{% assign alumni_count = phd_alumni.size | plus: ms_alumni.size %}
{% assign collaborators = site.members | where: 'role', 'collaborator' | sort_natural: 'path' %}
{% assign current_view_count = current_count | plus: collaborators.size %}
{% assign total_count = current_count | plus: alumni_count | plus: collaborators.size %}
<div class="people-page">
  <header class="people-heading">
    <div><h1>Team</h1><p class="people-lead">Researchers, collaborators, and alumni of the Growth & Aging Lab.</p></div>
    <dl class="people-totals"><div><dt>Lab researchers</dt><dd>{{ current_count }}</dd></div>{% if collaborators.size > 0 %}<div><dt>Collaborators</dt><dd>{{ collaborators.size }}</dd></div>{% endif %}<div><dt>Alumni</dt><dd>{{ alumni_count }}</dd></div></dl>
  </header>
  <section class="people-pi" id="principal-investigator" aria-labelledby="pi-name">
    <a class="pi-image profile-photo-link" href="{{ '/team/hyun-chul-jung/' | relative_url }}" aria-label="Hyun Chul Jung profile"><img src="{{ '/images/members/Prof/교수님.jpg' | relative_url | uri_escape }}" alt=""><span class="profile-photo-caption" aria-hidden="true">View profile ↗</span></a>
    <div class="people-pi-name"><p class="eyebrow">Principal investigator</p><h2 id="pi-name">정현철</h2><p class="pi-english">Hyun Chul Jung</p><span class="pi-affiliation">Kyung Hee University</span><a class="pi-profile-link" href="{{ '/team/hyun-chul-jung/' | relative_url }}">View profile <span aria-hidden="true">↗</span></a></div>
    <div class="people-pi-contact"><p>Exercise physiology.<br>Growth, development, and aging.</p><a href="mailto:jhc@khu.ac.kr">jhc@khu.ac.kr <span aria-hidden="true">↗</span></a><a href="https://scholar.google.com/citations?user=qm1Ao-oAAAAJ&hl=ko&oi=ao">Google Scholar <span aria-hidden="true">↗</span></a></div>
  </section>
  <section class="people-directory" id="researchers" aria-label="Researcher directory" data-people-directory>
    <aside class="people-sidebar">
      <nav class="people-filters" aria-label="Filter members">
        <a href="#researchers" data-people-filter="current" data-label="Current researchers"><span>Current researchers</span><b>{{ current_view_count }}</b></a>
        <a href="#phd-candidates" data-people-filter="phd-candidates" data-label="Ph.D. candidates"><span>Ph.D. candidates</span><b>{{ phd_candidates.size }}</b></a>
        <a href="#phd-students" data-people-filter="phd-students" data-label="Ph.D. students"><span>Ph.D. students</span><b>{{ phd_students.size }}</b></a>
        <a href="#masters" data-people-filter="masters" data-label="Master's students"><span>Master's students</span><b>{{ ms_students.size }}</b></a>
        <a href="#undergraduate" data-people-filter="undergraduate" data-label="Undergraduates"><span>Undergraduates</span><b>{{ undergraduates.size }}</b></a>
        {% if collaborators.size > 0 %}<a href="#collaborators" data-people-filter="collaborators" data-label="Research collaborators"><span>Collaborators</span><b>{{ collaborators.size }}</b></a>{% endif %}
        <a class="people-filter-alumni" href="#alumni" data-people-filter="alumni" data-label="Alumni"><span>Alumni</span><b>{{ alumni_count }}</b></a>
        <a href="#all-members" data-people-filter="all" data-label="All members"><span>All members</span><b>{{ total_count }}</b></a>
      </nav>
    </aside>
    <div class="people-results" id="all-members">
      <div class="people-search" hidden data-people-search><label for="member-search">Find someone</label><div><input type="search" id="member-search" placeholder="Name or research interest" autocomplete="off"><button type="button" data-clear-search hidden aria-label="Clear member search">Clear</button></div></div>
      <p class="people-result-count" data-people-status role="status" aria-live="polite"></p>
      {% include team-group.html people=phd_candidates title='Ph.D. candidates' id='phd-candidates' bucket='current' label='Ph.D. candidate' %}
      {% include team-group.html people=phd_students title='Ph.D. students' id='phd-students' bucket='current' label='Ph.D. student' %}
      {% include team-group.html people=ms_students title="Master's students" id='masters' bucket='current' label="Master's student" %}
      {% include team-group.html people=undergraduates title='Undergraduate researchers' id='undergraduate' bucket='current' label='Undergraduate' %}
      {% if collaborators.size > 0 %}{% include team-group.html people=collaborators title='Research collaborators' id='collaborators' bucket='current' label='Research collaborator' %}{% endif %}
      <div id="alumni" data-alumni-groups>
        {% include team-group.html people=phd_alumni title='Ph.D. graduates' id='phd-alumni' bucket='alumni' label='Ph.D. graduate' %}
        {% include team-group.html people=ms_alumni title="Master's graduates" id='masters-alumni' bucket='alumni' label="Master's graduate" %}
      </div>
      <div class="people-empty" data-people-empty hidden><h2>No matches in this group.</h2><p>Try another name or research interest, or select All members.</p><button type="button" data-reset-search>Clear search</button></div>
    </div>
  </section>
</div>
