# 홈페이지 CMS 연결

이 CMS는 **블로그 글과 사진만 관리**합니다. 구성원은 홈페이지 `/admin/`에서 공용 `member` 아이디와 비밀번호로 로그인하여 연구실 이야기·활동 기록과 사진을 제출합니다. 본인은 별도 `admin` 아이디로 로그인하여 승인하거나 수정을 요청합니다. 개인별 가입과 초대 메일 없이 시작할 수 있습니다. 초안·제출 자료는 Supabase에 보관하며, **관리자의 승인 시에만** 서버가 GitHub `jhw980212/GnA`의 `main`에 글과 사진을 하나의 커밋으로 반영합니다. 기존 GitHub Actions가 이후 사이트를 배포합니다.

CMS 화면과 API, DB 마이그레이션, 계정 생성 도구는 GitHub에 커밋하고 푸시했습니다. GitHub Pages에 관리자 화면이 배포되어 `/admin/`에서 체험할 수 있습니다. 실제 Supabase 프로젝트의 DB·계정·API는 아직 연결하거나 배포하지 않았으며, 서버의 비밀 키도 설정하지 않았습니다. 아래 최초 설정을 완료해야 실제 계정과 승인 게시가 동작합니다. 공용 계정의 비밀번호는 코드에 저장하지 않습니다.

## 1. Supabase 프로젝트와 DB

CMS 전용 Supabase 프로젝트를 만들고 SQL Editor에서 `migrations/`의 SQL 파일을 파일명 순서대로 실행합니다. 각 마이그레이션은 한 번만 적용합니다. 기존 CMS DB에는 아직 적용하지 않은 새 파일만 실행합니다. 이전 콘텐츠 형식의 데이터는 보존하면서 최신 마이그레이션이 구성원의 조회 권한을 블로그로 제한합니다. Supabase CLI를 사용하는 경우 저장소 루트에서 `supabase link --project-ref YOUR_PROJECT_REF` 후 `supabase db push`로 적용할 수 있습니다.

생성되는 데이터는 다음과 같습니다.

- `cms_profiles`: 사용자 이름·역할·활성 여부. 새 Auth 계정은 기본적으로 **비활성 편집자**이며, 계정 생성 도구나 관리자 초대로 활성화해야 합니다.
- `cms_entries`: 블로그 초안·제출·수정 요청·게시 기록과 파일 버전. 구성원은 본인의 블로그 자료만 조회하며 모든 쓰기는 API에서 검사합니다. 이전 범위의 초안과 호환 컬럼은 남겨 두지만 CMS에서는 사용하거나 게시하지 않습니다.
- 비공개 `cms-assets` 버킷: JPG·PNG·WebP, 한 장 최대 5MB, 글당 최대 10장. 브라우저의 직접 업로드·수정 정책을 만들지 마세요.

전용 프로젝트를 사용하세요. 다른 애플리케이션에서 `storage.objects`에 적용한 광범위한 정책이 있으면 `cms-assets`에도 영향을 줄 수 있습니다. 이 CMS 마이그레이션은 다른 앱의 정책을 변경하지 않습니다.

## 2. 공용 아이디와 관리자 계정 만들기

Supabase Dashboard의 Authentication 설정에서 다음을 적용합니다. `config.toml`은 로컬 설정이므로 이미 만들어진 hosted 프로젝트의 Dashboard 설정도 직접 확인합니다.

1. 공개 회원가입을 끄고 이메일/비밀번호 로그인을 켭니다. 계정은 아래 서버용 도구나 관리자 초대로 만듭니다. 서버의 `active` 검사도 등록되지 않은 계정을 차단합니다.
2. Site URL을 `https://galab.khu.ac.kr/admin/`로, 허용 Redirect URL을 동일한 주소로 설정합니다. 도메인이 다르면 실제 `/admin/` 주소로 바꾸세요.
3. 관리자 본인이 사용할 이메일과 공용 계정에 사용할 별도 이메일, 서로 다른 비밀번호를 준비합니다. 구성원 각자의 이메일은 필요하지 않습니다. 비밀번호는 12자 이상으로 정합니다.
4. Git에서 무시되는 `.preview/cms.accounts.env` 파일에 다음 값을 입력합니다. 실제 키와 비밀번호는 채팅·명령줄·저장소에 넣지 않습니다.

```dotenv
SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVER_SERVICE_ROLE_KEY
CMS_OWNER_EMAIL=owner@example.com
CMS_OWNER_PASSWORD="YOUR_PRIVATE_OWNER_PASSWORD"
CMS_MEMBER_EMAIL=members@example.com
CMS_MEMBER_PASSWORD="YOUR_PRIVATE_SHARED_PASSWORD"
```

5. DB 마이그레이션 적용 후 저장소 루트에서 실행합니다.

```text
node supabase/scripts/setup-shared-users.js --env-file .preview/cms.accounts.env
```

Node가 PATH에 없는 이 작업 환경에서는 다음 명령을 사용합니다.

```powershell
& '.preview\deps\playwright\driver\node.exe' supabase/scripts/setup-shared-users.js --env-file .preview/cms.accounts.env
```

도구는 이메일을 확인한 비밀번호 계정을 직접 생성하고, 보호된 프로필 테이블에 관리자/편집자 역할을 각각 등록합니다. 초대 메일은 발송하지 않습니다. [Supabase 관리자 계정 생성 API](https://supabase.com/docs/reference/javascript/auth-admin-createuser)를 사용합니다. 기존 계정을 다시 실행하면 비밀번호를 변경하지 않으며, 기존 편집자를 관리자로 승격하거나 기존 관리자를 공용 편집자로 변경하지 않습니다. 중단 후 재실행은 기존 계정 역할을 확인한 뒤 처리합니다. 비밀번호 변경이 필요하면 본인이 `--reset-passwords`를 명시해서 실행할 수 있습니다. 이 옵션은 두 계정의 비밀번호를 변경합니다. 완료 후 환경 파일을 삭제합니다.

공용 계정으로 로그인한 구성원은 같은 블로그 초안과 제출 내역을 봅니다. 제출자의 개인 계정 기록은 남지 않으며, 동시에 같은 글을 수정하면 버전 충돌을 표시합니다. 관리자 비밀번호는 본인이 보관하고, 구성원에게는 공용 계정의 아이디와 비밀번호만 전달합니다.

메일 초대와 이메일 비밀번호 재설정을 사용하는 경우에만 SMTP 설정이 필요합니다. Supabase 기본 발송기는 수신자와 빈도 제한이 있으므로 운영용 메일 발송기는 별도로 설정합니다. [Supabase SMTP 안내](https://supabase.com/docs/guides/auth/auth-smtp)

## 3. 서버의 GitHub 연결

GitHub에서 **`jhw980212/GnA` 저장소 하나만 선택한 fine-grained 접근 토큰**을 생성합니다. Repository permissions의 `Contents: Read and write`가 필요합니다. GitHub Actions의 저장소 배포 흐름은 기존처럼 유지합니다. 만료 기간을 지정하고 교체 시 Supabase 서버 비밀 값만 갱신하세요. 저장소 조직 정책이나 main 브랜치 보호 규칙이 직접 업데이트를 제한하면 서버 계정에 허용된 쓰기 경로를 마련해야 합니다. 이 API는 강제 푸시와 보호 규칙 우회를 하지 않습니다. [GitHub 토큰 안내](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)

Supabase Edge Function의 Secrets에 아래 값을 설정합니다.

| 이름 | 값 |
| --- | --- |
| `CMS_ORIGIN` | `https://galab.khu.ac.kr` (경로 없이 홈페이지 origin) |
| `CMS_ADMIN_URL` | 선택 사항. 기본값은 `CMS_ORIGIN` 뒤에 `/admin/` |
| `GITHUB_REPOSITORY` | `jhw980212/GnA` |
| `GITHUB_BRANCH` | `main` |
| `GITHUB_TOKEN` | 위에서 만든 비밀 접근 토큰 |

호스팅된 Supabase 함수에는 `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`가 기본 서버 환경 변수로 제공됩니다. 다른 실행 환경에서는 세 값도 제공해야 합니다. **서비스 역할 키와 GitHub 토큰은 `admin/config.js`, HTML, 저장소, 브라우저 요청에 넣지 않습니다.**

CLI로 설정할 때는 저장소의 무시되는 `.preview/`에 임시 환경 파일을 만들고 `supabase secrets set --env-file .preview/cms.secrets.env`를 사용하세요. 터미널 명령줄·셸 기록에 실제 토큰을 직접 붙여넣지 마세요. 설정 후 임시 파일을 삭제합니다. 코드에 토큰을 하드코딩하지 않습니다.

그다음 저장소 루트에서 함수를 배포합니다.

```text
supabase functions deploy cms-api --no-verify-jwt
```

`verify_jwt = false`는 인증을 생략한다는 뜻이 아닙니다. 함수가 모든 요청의 Bearer 토큰을 Supabase Auth `/user`로 검증하고, DB에서 활성 여부와 역할을 조회합니다. 등록된 계정의 쓰기 권한을 Edge Function 안에서 검사합니다.

## 4. 홈페이지 공개 설정

`admin/config.js`에는 Supabase 프로젝트 URL, **공개 anon/publishable 키**, 짧은 아이디와 등록 이메일의 연결만 설정합니다. 이메일은 공개 설정이므로 이 용도에 사용할 주소를 선택합니다. `supabaseUrl`과 `functionName`으로 API 주소 `https://YOUR_PROJECT_REF.supabase.co/functions/v1/cms-api`를 만듭니다. 이 공개 키와 아이디만으로는 CMS 쓰기 권한이 없으며 실제 비밀번호 로그인과 서버 권한 검사가 필요합니다. `loginAccounts`는 로그인할 이메일을 선택할 뿐 권한을 부여하지 않습니다.

```javascript
window.CMS_CONFIG = Object.freeze({
  supabaseUrl: "https://YOUR_PROJECT_REF.supabase.co",
  publishableKey: "SUPABASE_PUBLIC_ANON_OR_PUBLISHABLE_KEY",
  functionName: "cms-api",
  loginAccounts: {
    admin: "owner@example.com",
    member: "members@example.com",
  },
});
```

홈페이지 파일을 GitHub에 반영하여 기존 Pages 배포가 완료되면 `https://galab.khu.ac.kr/admin/`을 엽니다. `member`와 공용 비밀번호로 로그인하여 글을 제출한 뒤, 로그아웃하고 `admin`과 관리자 비밀번호로 로그인하여 승인합니다. 편집자가 초안을 저장하거나 제출했을 때 GitHub에 커밋이 생기지 않는지, 관리자가 승인했을 때만 새 커밋과 Actions 실행이 생기는지 확인합니다. 승인 결과는 **GitHub 반영 완료·홈페이지 배포 대기**이며 실제 홈페이지 반영은 Actions의 성공 여부로 확인합니다.

## 관리 범위와 권한

CMS에서 입력하는 정보는 블로그의 제목, 게시 날짜, 짧은 소개, Markdown 본문과 사진 모음입니다. 사진 설명·캡션·대표 사진 순서를 관리할 수 있습니다. 관리자는 기존 `_blog/*.md` 글을 불러와 원래 주소와 사진을 보존하면서 수정할 수 있습니다.

멤버는 `_members/`, 시설은 `_data/facility.yaml`, 논문은 `_data/citations.yaml`, 공지사항은 `_notice/`에서 본인이 직접 관리합니다. 두 CMS 역할 모두 이 자료의 저장·불러오기·사진 업로드·검토 요청·게시를 수행할 수 없습니다. API는 요청 본문의 `collection` 변경과 이전 비블로그 초안의 ID를 사용한 우회 요청도 거절합니다. 관리자 CMS 계정은 블로그 검토·승인용이며, GitHub에서 직접 수정하는 본인 권한은 별개입니다.

이전 범위의 CMS 데이터는 삭제하지 않습니다. 목록과 가져오기 메뉴는 블로그만 표시하고 구성원 DB 조회 정책도 본인의 블로그로 제한합니다. 홈페이지의 기존 멤버·시설·논문·공지 파일과 표시 방식은 그대로 사용합니다.

## 작업 흐름과 충돌 복구

- 편집자는 본인의 초안 또는 수정 요청된 글만 수정합니다. 제출된 글·사진은 검토 중 변경할 수 없습니다. 관리자가 수정을 요청하면 다시 편집합니다.
- 관리자는 기존 GitHub 블로그 글을 가져올 수 있습니다. 원래 파일 경로, 대표 사진·갤러리와 다른 머리말 설정을 보존합니다. 새 사진은 첫 장이 대표 사진, 나머지가 갤러리가 됩니다.
- 원본이 GitHub에서 별도로 바뀌면 승인 시 덮어쓰기를 거절합니다. 관리자 화면의 **홈페이지 최신 자료 가져오기**로 최신 내용을 읽고 다시 검토합니다. 가져오기는 미저장/기존 편집을 최신 GitHub 내용으로 바꾸고, CMS에 업로드한 사진은 유지합니다.
- 모든 기존 글 쓰기에는 `version`이 필요합니다. 다른 창에서 편집하거나 동시에 승인하면 오래된 요청을 거절하므로 목록을 새로고침합니다.
- 승인은 글·사진의 blob/tree/commit을 만든 뒤 **non-force** 방식으로 main을 업데이트합니다. 동시에 다른 글이 커밋되면 최신 트리로 다시 시도하여 관련 없는 변경을 보존합니다.
- 네트워크 또는 DB 오류로 결과가 불명확하면 `publishing` 상태를 유지합니다. 목록을 새로고침하여 다시 승인/게시 결과 확인을 누르면 준비한 커밋의 GitHub 이력과 글 내부 `cms_entry_id`, `cms_publish_version`을 확인합니다. 이미 반영됐으면 그 커밋을 기록하고, 미반영이면 **같은 준비 커밋**만 적용하여 중복 커밋을 만들지 않습니다.
- 준비 커밋도 저장하기 전 함수가 중단되면 15분 뒤 재확인 시 잠금을 안전하게 해제합니다. 함수가 토큰을 재확인한 뒤에만 main을 바꾸므로 중단된 옛 요청은 게시할 수 없습니다. 그 후 최신 목록에서 다시 승인합니다.
- GitHub 계정에서 직접 강제 푸시하거나 게시 잠금을 SQL로 임의 해제하지 마세요. 불확실한 게시 기록에 대해 사이트에 반영됐는지 확인하고 문제를 해결하기 전 다시 게시하면 중복 위험이 있습니다.
- 첨부를 제거해도 기존 Storage 객체와 GitHub에 이미 올라간 사진은 자동 삭제하지 않습니다. 보관 정책에 따라 CMS에서 참조하지 않는 사진을 관리자가 별도로 정리합니다. 초안·사진은 프로젝트의 백업과 보관 정책에 따릅니다.

목록은 최근 글 500건, 기존 GitHub 글 가져오기 목록은 최대 200건을 표시합니다. HTML·Liquid·kramdown 속성 코드는 본문에서 허용하지 않으며 일반 Markdown과 HTTP/HTTPS/이메일 링크를 사용합니다. 예약 게시 기능은 없고 날짜는 한국 시간의 오늘까지 입력할 수 있습니다.

## API와 로컬 검증

`POST /functions/v1/cms-api`에 `Authorization: Bearer <Supabase access token>`과 JSON `{ "action": "...", ... }`을 보냅니다. `{ "action": "...", "payload": { ... } }`도 지원합니다. 허용 Origin은 설정한 홈페이지 하나입니다.

| action | 입력/결과 |
| --- | --- |
| `profile`, `list` | `{profile}`, `{entries,profile}` |
| `save` | `{entry:{id?,collection:"blog",title,date,body,description,image_alt,image_caption,assets?},version?}` → `{entry}` |
| `upload` | `{id,version,name,mime,base64}` → `{entry,asset}` |
| `assets` | `{id}` → `{assets}` (10분 유효한 서명 URL) |
| `submit` | `{id,version}` → `{entry}` |
| `reject` | 관리자 `{id,version,feedback}` → `{entry}` |
| `approve` | 관리자 `{id,version}` → `{entry,commitCreated,commitUrl,deployment:"queued"}` |
| `invite` | 관리자 `{email,display_name}` → `{invited:true,email}` |
| `catalog` | 관리자 → `{files:[{path,collection:"blog",title,date,sha}],truncated}` |
| `import` | 관리자 `{path:"_blog/파일.md"}` 또는 충돌 복구 `{path,refresh:true,id,version}` → `{entry}` |

`collection`은 `blog`만 허용합니다. 불러오는 경로는 `_blog/` 바로 아래의 Markdown 파일만 허용하며 다른 폴더와 경로 조작 요청을 거절합니다.

새 `save`는 CMS 계정 권한·작성자·원본 경로·머리말·게시 상태를 클라이언트에서 받지 않습니다. 기존 `assets` 수정은 이미 해당 자료에 업로드한 경로의 순서·설명·캡션·제거만 허용합니다.

```text
node --test supabase/tests/*.test.js tests/cms-client.test.mjs
```

현재 로컬 환경의 Node가 PATH에 없으면 PowerShell에서 아래 저장소의 기존 런타임을 사용할 수 있습니다.

```powershell
& '.preview\deps\playwright\driver\node.exe' --test supabase/tests/*.test.js tests/cms-client.test.mjs
```

테스트는 외부 요청을 모의하여 권한·초대·사진 형식·버전 충돌·동시 승인·기존 원본 충돌·불명확한 게시 결과 복구를 검증합니다. 실제 Supabase SQL 적용·메일 도착·GitHub 권한·Pages 배포는 계정을 연결한 뒤 별도로 확인해야 합니다.
