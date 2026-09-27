---
title: About
reading_width: true
section_sidebar: true
eyebrow: Exercise physiology
section_number: '01'
lead: Exercise, physical activity, and physiological function from childhood to older adulthood.
robots: index, follow
nav:
  order: 1
  tooltip: Our lab, research areas, and facilities
---
<div class="browse-layout">
<aside class="browse-sidebar"><p class="publication-nav-label">About the lab</p><nav class="about-nav browse-nav" data-section-nav aria-label="About sections"><a href="#introduction">Introduction</a><a href="#research-areas">Research areas</a><a href="#facility">Our equipment</a></nav></aside>
<div class="about-sections browse-content">
<section class="about-intro" id="introduction">
  <figure class="professor-photo"><a class="profile-photo-link" href="{{ '/team/hyun-chul-jung/' | relative_url }}" aria-label="Hyun Chul Jung profile"><img src="{{ '/images/members/Prof/교수님.jpg' | relative_url | uri_escape }}" alt=""><span class="profile-photo-caption" aria-hidden="true">View profile ↗</span></a><figcaption><span>정현철 · Hyun Chul Jung</span><span>Principal investigator</span><a class="pi-profile-link" href="{{ '/team/hyun-chul-jung/' | relative_url }}">View profile <span aria-hidden="true">↗</span></a></figcaption></figure>
  <div class="about-copy"><p class="eyebrow">Growth & Aging Lab</p><h2>Growth, development,<br>and aging.</h2><p>The Growth and Aging Lab studies how exercise and physical activity relate to human growth, development, and aging. Our research examines physiological responses to training, cardiovascular function, muscle performance, and recovery from childhood to older adulthood.</p><p>Building on exercise physiology and applied sports science, we combine intervention studies, laboratory assessments, and population data analysis. Our publications address heart rate variability, vascular function, strength asymmetry, physical literacy, and associations between physical activity and cardiometabolic health.</p><a class="text-link" href="{{ '/research/' | relative_url }}">Explore our publications <span aria-hidden="true">↗</span></a></div>
</section>
<section class="research-areas" id="research-areas">
  <div class="section-heading"><h2>Research areas</h2><span class="eyebrow">Our research focus</span></div>
  <div class="research-area" id="exercise-physiology"><span>01</span><h3>Exercise physiology</h3><p>Physiological responses and adaptations to training, with a focus on exercise intensity, fatigue, and recovery.</p></div>
  <div class="research-area" id="cardiovascular"><span>02</span><h3>Cardiovascular & vascular health</h3><p>Cardiac autonomic regulation, heart rate variability, and vascular responses to exercise across age and sex.</p></div>
  <div class="research-area" id="performance"><span>03</span><h3>Sports science & performance</h3><p>Muscle strength, asymmetry, fatigue resistance, and training responses in athletes.</p></div>
  <div class="research-area" id="metabolic-health"><span>04</span><h3>Physical activity & metabolic health</h3><p>Relationships between physical activity, metabolic health, and cardiometabolic risk, examined using population data.</p></div>
  <div class="research-area" id="lifespan"><span>05</span><h3>Lifespan exercise physiology</h3><p>Physical literacy and activity in childhood, athletic development in adolescence, and exercise and health in older adulthood.</p></div>
</section>
<section class="facility-section" id="facility">
  <div class="section-heading"><h2>Laboratory equipment</h2><p>Equipment for assessing cardiovascular function, muscle strength, physical performance, body composition, and bone health.</p></div>
  <details class="equipment-directory" open><summary>Explore all equipment <span>{{ site.data.facility.size }} instruments & tools</span></summary><div class="facility-grid">{% for equipment in site.data.facility %}<figure class="facility-card"><div class="facility-image"><img src="{{ equipment.image | relative_url | uri_escape }}" alt="{{ equipment.title | strip_html | escape }}" loading="lazy"></div><figcaption><h3>{{ equipment.title }}</h3>{% if equipment.subtitle != '' %}<p>{{ equipment.subtitle }}</p>{% endif %}</figcaption></figure>{% endfor %}</div></details>
</section>
</div>
</div>
