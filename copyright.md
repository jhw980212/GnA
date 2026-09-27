---
title: Website credits and reuse
description: 웹사이트 제작자와 디자인·코드 재사용 조건 안내.
permalink: /copyright/
reading_width: true
---

<article class="article-page">
  <header class="article-heading">
    <p class="eyebrow">Website credits</p>
    <h1>Design &amp; development</h1>
  </header>
  <div class="article-body" lang="ko">
    <p><strong>정형웅 · Jeong Hyeong Ung</strong><br>Growth &amp; Aging Lab, Kyung Hee University</p>
    {% capture reuse_terms %}{% include_relative LICENSE.md %}{% endcapture %}
    {{ reuse_terms | replace: '# 웹사이트 디자인·코드 이용 조건', '## 웹사이트 디자인·코드 이용 조건' | markdownify }}
  </div>
</article>
