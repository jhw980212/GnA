# 연구실 Google CMS 연결

## 현재 준비 상태

논문(Publications), 블로그(Blog), 공지사항(Notice)만 작성하고 바로 게시하는 Google 관리자입니다. 기존 멤버·시설 자료와 기존 게시물은 원래 파일에서 관리합니다. CMS로 새로 만든 자료는 이 관리 화면에서 수정·게시 중단할 수 있습니다.

2026-10-29 사용자가 Google 초기 설정과 배포 과정을 진행하고 웹 앱 주소를 제공했습니다. `admin/config.js`에 해당 주소를 연결했습니다. 계정 로그인 이후 실제 게시·공개 반영은 아직 도구로 검증하지 않았습니다.

관리 화면: https://galab.khu.ac.kr/admin/

Google 웹 앱: https://script.google.com/macros/s/AKfycbzDGe-xryGmby3Oxmke3rFw2cTr7EtvEfa9fa4noSf3p5xGXbqtfg91UE9qKxu783_k/exec

최초 설치 계정은 **plie0312@gmail.com**입니다. 함께 사용할 관리자는 **jhw980212@gmail.com**, **jhw980212@khu.ac.kr**입니다. 학교 주소는 Google에 로그인할 수 있는 계정이어야 합니다. 구성원 제출과 별도 승인 절차는 없습니다.

## 1. 연구실용 Google 프로젝트 만들기

1. https://script.google.com/home 에 **plie0312@gmail.com**으로 접속합니다.
2. **새 프로젝트**를 누르고 이름을 `성장노화연구실 게시물 관리`로 정합니다. 기존 플리에 프로젝트는 그대로 둡니다.
3. 기본 `Code.gs` 내용을 지우고, 이 폴더의 **Install.gs 전체 내용**을 붙여 넣고 저장합니다. 별도 HTML 파일은 필요 없습니다.
4. 왼쪽 **프로젝트 설정(톱니바퀴)** → **편집기에 appsscript.json 매니페스트 파일 표시**를 켭니다.
5. 편집기로 돌아가 `appsscript.json`에 이 폴더의 **appsscript.json 전체 내용**을 붙여 넣고 저장합니다. Google Drive API v3, 필요한 권한과 한국 시간 설정이 포함됩니다.

## 2. 비공개 저장소 초기 설정

상단 함수 목록에서 **setupLabCms**를 선택하고 **실행**합니다. Google 권한 검토는 본인이 계정과 요청 권한을 확인하고 진행합니다. 이 과정에서 연구실 전용 Drive 폴더를 만들고 지정한 세 계정에만 공유합니다. 공유 알림 메일은 발송하지 않습니다.

Google Drive API가 활성화되지 않았다는 오류가 나오면 편집기 왼쪽 **서비스 + → Drive API → v3 → 추가**를 확인합니다. 기본 Google Cloud 프로젝트는 연결된 서비스가 API를 활성화합니다. 직접 지정한 표준 Google Cloud 프로젝트를 쓰는 경우에는 해당 프로젝트에서 Google Drive API도 활성화해야 합니다.

학교 계정이 Google 계정이 아니거나 학교의 외부 공유 정책으로 거절되면 오류를 알려 주세요. 임의로 공개 공유를 켜거나 계정 제한을 풀지 않습니다. 초기 설정을 다시 실행해도 만들어진 자료는 유지합니다.

## 3. 연구실 GitHub 게시 키 등록

1. 연구실 저장소 소유자 **jhw980212**의 GitHub 계정으로 로그인하고 https://github.com/settings/personal-access-tokens/new 를 엽니다.
2. 이름은 `GnA Google CMS`, Resource owner는 **jhw980212**로 정합니다.
3. Repository access는 **Only select repositories → GnA**를 선택합니다.
4. Repository permissions에서 **Contents: Read and write**만 추가합니다. Metadata 읽기는 자동 포함됩니다. 만료일을 정하고 만료 전에 갱신합니다.
5. 만든 값은 Apps Script **프로젝트 설정 → 스크립트 속성 → 속성 추가**에 넣습니다. 속성 이름은 **CMS_GITHUB_TOKEN**, 값은 생성한 키입니다. 저장합니다.

키를 채팅, 소스 코드, 공개 admin/config.js에 넣지 않습니다. 플리에 전용 키는 연구실 GnA 저장소 권한이 없으므로 연구실용으로 따로 만듭니다. Google 관리자 계정과 GitHub 저장소 소유자는 서로 달라도 됩니다.

## 4. 웹 앱 배포

**배포 → 새 배포 → 유형 선택(톱니바퀴) → 웹 앱**에서:

- 실행 사용자: **웹 앱에 액세스하는 사용자**
- 액세스 권한: **Google 계정이 있는 모든 사용자**

로 정하고 배포합니다. 위 설정이 Google 로그인 진입을 허용하며 실제 자료 접근은 서버에서 세 이메일을 매번 확인해 제한합니다. `나`로 실행하거나 `익명 사용자 포함`으로 바꾸지 않습니다. 나머지 관리자 계정은 웹 앱 주소에서 처음 한 번 본인의 Google 권한 승인이 필요합니다. Apps Script 프로젝트의 편집자 권한은 추가하지 않아도 됩니다.

## 5. 홈페이지 관리자 주소 연결

배포 결과의 **웹 앱 URL(`/exec`로 끝나는 주소)**을 알려 주세요. URL은 공개해도 되는 접속 주소이며 키와 다릅니다. 이 주소를 연구실 홈페이지 `/admin/`의 버튼에 연결합니다. `admin/config.js`의 url에 직접 넣고 GitHub에 반영해도 됩니다.

홈페이지에는 논문 목록에서 CMS 논문을 합쳐 읽는 소스 변경도 함께 배포되어야 합니다. Google 배포만으로 이 로컬 소스 변경이 GitHub에 반영되지는 않습니다.

## 사용과 관리

관리 화면에서 논문·블로그·공지 중 선택 → 작성 → 임시저장 또는 홈페이지에 게시를 누릅니다. 논문은 제목·저자·학술지·날짜·국내/국외를 입력하며 DOI/HTTPS 링크와 표지는 선택입니다. 블로그·공지는 글·사진·MP4·YouTube 링크를 사용할 수 있습니다. 사진은 브라우저에서 JPEG로 변환하며 서버 제한은 3MB, MP4는 25MB입니다. 미래 날짜 예약 게시 기능은 없습니다.

게시 후 **홈페이지 반영을 확인했습니다** 표시와 실제 홈페이지를 확인합니다. 전송 오류 시 자료는 Google에 남고 다시 반영할 수 있습니다. 이미 공개한 글이나 사진은 게시 중단 후에도 GitHub 과거 이력에 남을 수 있습니다.

관리 대상은 `_blog/cms-*.md`, `_notice/cms-*.md`, `_data/cms-publications.json`, `images/cms/`와 게시 상태 파일뿐입니다. 기존 파일을 GitHub에서 직접 바꿔 CMS 기록과 달라지면 덮어쓰지 않고 안내합니다. 동일 자료를 관리 화면과 GitHub에서 동시에 편집하지 않는 것이 편합니다.

코드 수정 후에는 `python cms-google/build.py`로 Install.gs를 다시 만들고 같은 Apps Script 프로젝트에 적용한 뒤 **배포 관리 → 수정 → 새 버전**으로 갱신합니다.
