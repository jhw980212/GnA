---
layout: home
description: Exercise physiology research on growth, aging, cardiovascular function, and athletic performance at Kyung Hee University.
---

{% include home-hero.html %}

<section class="home-intro" id="our-science" aria-labelledby="science-heading">
  <div class="home-intro-heading">
    <p class="home-eyebrow">Growth & Aging Lab</p>
    <h2 id="science-heading">Exercise physiology.<br>Across the lifespan.</h2>
  </div>
  <div class="home-intro-body">
    <p>We study how exercise and physical activity relate to human growth, development, and aging.</p>
    <p>At Kyung Hee University, our research combines exercise interventions, physiological measurements, and population data to examine cardiovascular function, muscle performance, and health from childhood to older adulthood.</p>
    <a class="text-link" href="{{ '/about/' | relative_url }}">Get to know our lab <span aria-hidden="true">↗</span></a>
  </div>
  <div class="home-topics">
    <a href="{{ '/about/#cardiovascular' | relative_url }}"><span class="home-topic-number">01</span><h3>Cardiovascular function</h3><p>Heart rate variability, arterial stiffness, and responses to exercise.</p><span aria-hidden="true">↗</span></a>
    <a href="{{ '/about/#performance' | relative_url }}"><span class="home-topic-number">02</span><h3>Training & performance</h3><p>Interval training, muscle strength, fatigue, and recovery in athletes.</p><span aria-hidden="true">↗</span></a>
    <a href="{{ '/about/#lifespan' | relative_url }}"><span class="home-topic-number">03</span><h3>Growth & aging</h3><p>Physical literacy in children and physical activity and health in older adults.</p><span aria-hidden="true">↗</span></a>
  </div>
</section>

{% assign latest_notices = site.notice | sort: 'date' | reverse %}
{% if latest_notices.size > 0 %}
<section class="home-updates" aria-labelledby="updates-heading">
  <div class="home-updates-heading"><h2 id="updates-heading">From the lab</h2><a class="text-link" href="{{ '/notice/' | relative_url }}">All notices <span aria-hidden="true">↗</span></a></div>
  {% for item in latest_notices limit: 2 %}
  <a class="home-update" href="{{ item.url | relative_url }}"><time datetime="{{ item.date | date: '%Y-%m-%d' }}">{{ item.date | date: '%Y.%m.%d' }}</time><span>{{ item.title | escape }}</span><span aria-hidden="true">↗</span></a>
  {% endfor %}
</section>
{% endif %}
