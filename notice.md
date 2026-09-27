---
title: Notice
reading_width: true
permalink: /notice/
eyebrow: The latest from our lab
section_number: '06'
lead: Announcements, opportunities to participate, and news from the Growth and Aging Lab.
description: Growth and Aging Lab 공지사항, 연구 대상자 모집 및 연구실 소식 안내.
nav:
  order: 6
  tooltip: Lab announcements
---
<div class="notice-table"><div class="notice-table-heading"><span>Date</span><span>Announcement</span></div>{% assign notices = site.notice | sort: 'date' | reverse %}{% for notice in notices %}<a class="notice-row" href="{{ notice.url | relative_url }}"><time datetime="{{ notice.date | date: '%Y-%m-%d' }}">{{ notice.date | date: '%Y.%m.%d' }}</time><h2>{{ notice.title }}</h2><span aria-hidden="true">↗</span></a>{% endfor %}</div>
