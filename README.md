# Growth & Aging Lab

경희대학교 성장노화연구실 홈페이지입니다.

웹사이트 디자인 및 개발: **정형웅 (Jeong Hyeong Ung)**

[연구실 홈페이지](https://galab.khu.ac.kr/)

## 콘텐츠 관리

Team과 마찬가지로 Markdown 파일 하나가 항목 하나입니다. 별도 DB나 관리자 페이지 없이 파일을 추가·수정한 뒤 GitHub에 반영하면 배포됩니다.

| 콘텐츠 | 관리 위치 | 자동 반영 |
| --- | --- | --- |
| Team | `_members/` | 기존 구성원 분류와 프로필 |
| Blog | `_blog/` | 연도별 목록, 개수, 상세 페이지, 이전·다음 글 |
| Notice | `_notice/` | 최신순 공지 목록, 상세 페이지, 이전·다음 글 |

Blog는 기존 `_data/blog.yaml` 목록을 `_blog/` 글 파일로 옮겼습니다. 앞으로 목록 데이터를 따로 작성할 필요가 없습니다. 기존 사진 9개와 본문, 기존 글 주소는 유지했습니다. 사진 파일명에 있던 날짜를 각 활동 날짜로 사용했습니다.

### 글 추가하기

1. `content-templates/blog.md` 또는 `content-templates/notice.md`를 해당 폴더에 복사합니다.
2. 파일명을 `2026-09-27-activity-name.md`처럼 정합니다. 공개 후 파일명을 바꾸면 주소도 달라지므로 유지합니다.
3. 맨 위 `title`, `date`를 수정하고 `---` 아래에 본문을 씁니다. 목록은 `date`의 최신순입니다.
4. 사진을 `images/blog/연도/` 또는 `images/notice/`에 넣고 `image`에 경로를 적습니다. 대표사진은 목록(Blog), 상세 페이지, 공유 미리보기에 사용됩니다. 사진이 없으면 `image` 줄을 생략합니다.
5. 공개할 준비가 되면 `published: true`로 바꿉니다. `published: false`인 글은 배포에서 제외됩니다. 템플릿 안내 문구는 실제 본문으로 바꿔 주세요.

미래 날짜의 글도 해당 날짜 전에는 배포에서 제외됩니다. 날짜가 지난 뒤 GitHub Actions를 다시 실행하거나 변경 사항을 푸시해야 반영되며, 자동 예약 발행은 설정되어 있지 않습니다.

제목·날짜·사진만 있어도 Blog 항목을 만들 수 있고, 나중에 같은 파일에 본문을 추가하면 됩니다. `description`은 검색·공유 설명, `image_alt`는 대표사진 대체 텍스트, `image_caption`은 대표사진 아래 설명이며 모두 선택 사항입니다.

여러 사진을 추가할 때는 글 상단의 `---` 사이에 아래처럼 `gallery`를 넣습니다. Blog·Notice 모두 지원하며 사진은 본문 아래에 원본 비율로 표시됩니다.

```yaml
gallery:
  - image: images/blog/2026/photo-01.jpg
    caption: "첫 번째 사진 설명"
  - image: images/blog/2026/photo-02.jpg
    caption: "두 번째 사진 설명"
```

본문 중간에 사진을 넣으려면 `![사진 설명](/images/blog/2026/photo-01.jpg)`를 사용합니다.

### 논문 이미지

`_data/citations.yaml`의 `image`에 경로를 넣으면 가로형 로고와 세로형 표지 모두 같은 틀 안에 원본 비율을 유지하며 중앙 정렬됩니다. 새 이미지마다 CSS를 수정할 필요가 없습니다. 이미지 파일 자체에 포함된 여백은 보존됩니다.
