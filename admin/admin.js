(() => {
  'use strict';
  const status = document.getElementById('connection');
  const link = document.getElementById('open-admin');
  const value = window.LAB_ADMIN_CONFIG?.url;
  let url;
  try { url = new URL(value); } catch (_) {}
  if (!url || url.protocol !== 'https:' || url.hostname !== 'script.google.com' ||
      !/^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url.pathname) || url.search || url.hash || url.username || url.password) {
    status.textContent = 'Google 관리 화면의 최초 연결을 준비 중입니다. 연결이 완료되면 이곳에서 접속할 수 있습니다.';
    return;
  }
  link.href = url.href;
  link.hidden = false;
  status.textContent = 'Google 화면에서 계정 권한을 확인합니다.';
})();
