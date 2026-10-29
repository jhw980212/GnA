/* Standalone lab project. Keep the Plie Apps Script project and its data separate. */
const CMS_PRIMARY = 'plie0312@gmail.com';
const CMS_ADMINS = ['plie0312@gmail.com','jhw980212@gmail.com','jhw980212@khu.ac.kr'];
const CMS_SITE = 'https://galab.khu.ac.kr';
const CMS_REPO = 'https://api.github.com/repos/jhw980212/GnA';
const CMS_MANIFEST = 'content/cms-manifest.json';
const CMS_RELEASE = 'content/cms-release.json';
const CMS_MAX_VIDEO = 25 * 1024 * 1024;
const CMS_MAX_IMAGE = 3 * 1024 * 1024;
const CMS_COLLECTIONS = ['blog','notice','publication'];
let CMS_PERMISSION_CACHE_ = {};

function cmsFail_(message) { const error = new Error(message); error.cmsSafe = true; throw error; }
function cmsProps_() { return PropertiesService.getScriptProperties(); }
function cmsIdentity_() {
  const active = String(Session.getActiveUser().getEmail() || '').trim().toLowerCase();
  const effective = String(Session.getEffectiveUser().getEmail() || '').trim().toLowerCase();
  if (!active || active !== effective || !CMS_ADMINS.includes(active)) cmsFail_('허용된 Google 관리자 계정으로 접속해 주세요.');
  return active;
}
function cmsOwner_() {
  const email = cmsIdentity_();
  if (cmsProps_().getProperty('CMS_OWNER_EMAIL') !== CMS_PRIMARY) cmsFail_('기본 관리자 계정에서 setupLabCms를 먼저 실행해 주세요.');
  return email;
}
function cmsId_(value) { if (typeof value !== 'string' || !/^[a-f0-9]{32}$/.test(value)) cmsFail_('항목을 찾을 수 없습니다.'); return value; }
function cmsText_(value,max,required) {
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value) || required && !value.trim()) cmsFail_('입력 내용과 글자 수를 확인해 주세요.');
  return value.trim();
}
function cmsUuid_() { return Utilities.getUuid().replace(/-/g,''); }
// Jekyll runs Liquid before Markdown, including inside HTML and YAML strings.
function cmsEscape_(value) { return String(value == null ? '' : value).replace(/[&<>"'{}]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;','{':'&#123;','}':'&#125;'}[c])); }
function cmsToday_() { return Utilities.formatDate(new Date(),'Asia/Seoul','yyyy-MM-dd'); }
function cmsDate_(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || isNaN(Date.parse(value)) || new Date(value).toISOString().slice(0,10) !== value || value > cmsToday_()) cmsFail_('게시 날짜는 한국 시간의 오늘까지 YYYY-MM-DD로 입력해 주세요.');
  return value;
}
function cmsDrive_(path,method,body) {
  const options={method:method||'get',headers:{Authorization:'Bearer '+ScriptApp.getOAuthToken()},muteHttpExceptions:true,followRedirects:false};
  if(body!==undefined) { options.contentType='application/json'; options.payload=JSON.stringify(body); }
  const response=UrlFetchApp.fetch('https://www.googleapis.com/drive/v3'+path,options);
  if(response.getResponseCode()<200 || response.getResponseCode()>=300) cmsFail_('Google Drive의 비공개 저장소 권한을 확인해 주세요.');
  return JSON.parse(response.getContentText()||'{}');
}
function cmsPermissions_(file) {
  const result=cmsDrive_('/files/'+encodeURIComponent(file.getId())+'/permissions?pageSize=100&fields=permissions(id,type,emailAddress,role),nextPageToken');
  if(result.nextPageToken || !Array.isArray(result.permissions) || result.permissions.some(p=>p.type!=='user' || !CMS_ADMINS.includes(String(p.emailAddress||'').toLowerCase()) || !['owner','writer','reader','commenter'].includes(p.role))) cmsFail_('CMS 저장소는 지정된 Google 관리자에게만 공유할 수 있습니다. 링크·학교 전체·다른 계정 공유를 해제해 주세요.');
  return result.permissions;
}
function cmsPrivate_(file) {
  if(CMS_PERMISSION_CACHE_[file.getId()])return file;
  const owner=file.getOwner();
  if(!owner || !CMS_ADMINS.includes(String(owner.getEmail()).toLowerCase()) || file.getSharingAccess()!==DriveApp.Access.PRIVATE) cmsFail_('CMS 저장소는 지정된 관리자의 비공개 파일이어야 합니다.');
  cmsPermissions_(file);
  CMS_PERMISSION_CACHE_[file.getId()]=true;
  return file;
}
function cmsFolder_() {
  const id=cmsProps_().getProperty('CMS_FOLDER_ID');
  if(!id) cmsFail_('기본 관리자 계정에서 setupLabCms를 먼저 실행해 주세요.');
  return cmsPrivate_(DriveApp.getFolderById(id));
}
function cmsFile_(id) {
  if(!id) cmsFail_('CMS 저장소 파일을 찾지 못했습니다.');
  const file=cmsPrivate_(DriveApp.getFileById(id)), parents=file.getParents();
  if(!parents.hasNext() || parents.next().getId()!==cmsFolder_().getId() || parents.hasNext()) cmsFail_('연구실 CMS 전용 파일이 아닙니다.');
  return file;
}
function cmsState_() {
  const state=JSON.parse(cmsFile_(cmsProps_().getProperty('CMS_STATE_ID')).getBlob().getDataAsString('UTF-8'));
  if(!state || state.version!==1 || !state.posts || Array.isArray(state.posts) || !state.media || Array.isArray(state.media)) cmsFail_('CMS 저장소 형식이 올바르지 않습니다. 백업을 확인해 주세요.');
  return state;
}
function cmsWrite_(state) { cmsFile_(cmsProps_().getProperty('CMS_STATE_ID')).setContent(JSON.stringify(state)); }

function setupLabCms() {
  CMS_PERMISSION_CACHE_={};
  if(cmsIdentity_()!==CMS_PRIMARY) cmsFail_('최초 설정은 기본 관리자 Google 계정에서 실행해 주세요.');
  const lock=LockService.getScriptLock(); lock.waitLock(5000);
  try {
    const props=cmsProps_(), previous=props.getProperty('CMS_OWNER_EMAIL');
    if(previous && previous!==CMS_PRIMARY) cmsFail_('다른 CMS 계정의 설정입니다. 별도 Apps Script 프로젝트를 사용해 주세요.');
    if(!previous && ['CMS_FOLDER_ID','CMS_STATE_ID','CMS_INSTANCE_ID'].some(key=>props.getProperty(key)))cmsFail_('다른 CMS의 저장소 설정이 있습니다. 플리에 프로젝트를 변경하지 말고 새 연구실 Apps Script 프로젝트를 만들어 주세요.');
    props.setProperty('CMS_OWNER_EMAIL',CMS_PRIMARY);
    let folder;
    if(props.getProperty('CMS_FOLDER_ID')) folder=cmsFolder_();
    else {
      folder=DriveApp.createFolder('GnA 연구실 홈페이지 CMS · 비공개');
      props.setProperties({CMS_FOLDER_ID:folder.getId(),CMS_INSTANCE_ID:cmsUuid_()});
    }
    const permissions=cmsPermissions_(folder);
    CMS_ADMINS.filter(email=>email!==CMS_PRIMARY).forEach(email=>{
      if(!permissions.some(p=>String(p.emailAddress||'').toLowerCase()===email && p.role==='writer')) {
        const old=permissions.find(p=>String(p.emailAddress||'').toLowerCase()===email);
        if(old) cmsDrive_('/files/'+encodeURIComponent(folder.getId())+'/permissions/'+encodeURIComponent(old.id),'patch',{role:'writer'});
        else cmsDrive_('/files/'+encodeURIComponent(folder.getId())+'/permissions?sendNotificationEmail=false','post',{type:'user',role:'writer',emailAddress:email});
      }
    });
    if(props.getProperty('CMS_STATE_ID')) { cmsState_(); return '기존 연구실 CMS 저장소와 관리자 공유를 확인했습니다. 내용은 유지했습니다.'; }
    if(!props.getProperty('CMS_INSTANCE_ID')) cmsFail_('기존 저장소 식별자가 없습니다. 설정을 확인해 주세요.');
    const state=folder.createFile('lab-cms-state.json',JSON.stringify({version:1,posts:{},media:{},publication:{phase:'ready',message:'게시할 글을 작성해 주세요.'}}),MimeType.PLAIN_TEXT);
    props.setProperty('CMS_STATE_ID',state.getId()); cmsPrivate_(state);
    return '연구실 전용 비공개 저장소를 만들고 지정 관리자에게 공유했습니다. GitHub 연결과 웹 앱 배포를 완료해 주세요.';
  } finally { lock.releaseLock(); }
}

function doGet() {
  CMS_PERMISSION_CACHE_={};
  try {
    cmsOwner_();
    return HtmlService.createHtmlOutput(HtmlService.createHtmlOutputFromFile('Admin').getContent()).setTitle('GnA · 연구실 게시물 관리').addMetaTag('viewport','width=device-width,initial-scale=1');
  } catch(error) {
    return HtmlService.createHtmlOutput('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><main style="max-width:560px;margin:80px auto;font-family:sans-serif;padding:24px"><h1>연구실 관리자 전용</h1><p>'+cmsEscape_(error.cmsSafe?error.message:'Google 배포와 관리자 계정 설정을 확인해 주세요.')+'</p><a href="'+CMS_SITE+'" target="_top">홈페이지로 돌아가기</a></main>');
  }
}

function cmsRequest(action,payload) {
  CMS_PERMISSION_CACHE_={};
  let lock;
  try {
    const email=cmsOwner_(), allowed=['session','posts','post','media','upload','save','publish','unpublish','delete','site-status','site-sync','import-existing','refresh-existing','logout'];
    if(!allowed.includes(action)) cmsFail_('지원하지 않는 요청입니다.');
    if(payload!=null && (typeof payload!=='object' || Array.isArray(payload))) cmsFail_('요청 형식을 확인해 주세요.');
    payload=payload||{};
    const cache=CacheService.getUserCache();
    if(action==='session') {
      let csrf=cache.get('lab-cms-csrf'); if(!csrf) { csrf=cmsUuid_()+cmsUuid_(); cache.put('lab-cms-csrf',csrf,21600); }
      return {ok:true,value:{app:'lab-google-cms',configured:true,authenticated:true,username:email,csrf,local:false,publishing:true,google:true}};
    }
    const reads=['posts','post','media','site-status'];
    if(!reads.includes(action) && (!cache.get('lab-cms-csrf') || payload.csrf!==cache.get('lab-cms-csrf'))) cmsFail_('관리 화면을 새로고침한 뒤 다시 시도해 주세요.');
    if(action==='logout') { cache.remove('lab-cms-csrf'); return {ok:true,value:{ok:true}}; }
    if(!reads.includes(action)) { lock=LockService.getScriptLock(); if(!lock.tryLock(5000)) cmsFail_('다른 저장 작업이 진행 중입니다. 잠시 뒤 다시 시도해 주세요.'); }
    const state=cmsState_(); let value;
    if(action==='posts') value={posts:cmsPosts_(state)};
    if(action==='post') value=cmsPost_(state,cmsId_(payload.id),true);
    if(action==='media') value=cmsMedia_(state,cmsId_(payload.id),true);
    if(action==='site-status') value=cmsStatus_(state);
    if(['save','publish','unpublish','delete','site-sync','import-existing','refresh-existing'].includes(action) && state.publication && state.publication.pending) {
      cmsRecover_(state); cmsWrite_(state);
    }
    if(action==='upload') { value=cmsUpload_(state,payload); cmsWrite_(state); }
    if(action==='import-existing') { value=cmsImport_(state);cmsWrite_(state); }
    if(action==='refresh-existing') {
      const row=state.posts[cmsId_(payload.id)];
      if(!row||!row.source||row.deleted||row.revision!==payload.revision)cmsFail_('기존 자료의 최신 버전을 목록에서 다시 열어 주세요.');
      const entries=cmsCatalog_(),entry=entries.find(item=>cmsSourceKey_(item)===cmsSourceKey_(row.source));
      if(!entry)cmsFail_('현재 홈페이지에서 원본을 찾지 못했습니다.');
      const head=cmsHead_();cmsCheckSource_(entry,head);
      const fresh=cmsImportedRow_(entry,row.id);fresh.revision=row.revision+1;fresh.override=!!row.override;fresh.published=row.published;fresh.publishedSource=row.publishedSource||row.source;
      state.posts[row.id]=fresh;cmsWrite_(state);value=cmsPost_(state,row.id,true);
    }
    if(action==='save' || action==='publish') {
      const id=cmsId_(payload.id), current=state.posts[id];
      if(current && current.revision!==payload.revision || !current && payload.revision!==0) cmsFail_('다른 창에서 수정됐습니다. 목록을 다시 열어 주세요.');
      if(!current && Object.keys(state.posts).length>=500) cmsFail_('게시물은 500개까지 관리할 수 있습니다.');
      if(current&&current.deleted)cmsFail_('삭제된 자료는 다시 게시할 수 없습니다.');
      const post=cmsValidate_(state,payload.post,action==='publish',current&&current.source), now=new Date().toISOString();
      if(current && current.draft.collection!==post.collection)cmsFail_('기존 자료의 분류는 변경할 수 없습니다. 새 자료로 작성해 주세요.');
      state.posts[id]={id,draft:post,published:current&&current.published||null,revision:(current?current.revision:0)+1,updated:now};
      if(current&&current.source){state.posts[id].source=current.source;state.posts[id].publishedSource=current.publishedSource||current.source;state.posts[id].override=!!current.override;}
      if(action==='publish') state.posts[id].published=Object.assign({},post,{publishedAt:current&&current.published?current.published.publishedAt:now,updatedAt:now});
      if(action==='publish'&&current&&current.source){state.posts[id].override=true;state.posts[id].publishedSource=current.source;}
      cmsWrite_(state); if(action==='publish') cmsSyncSafely_(state); value=cmsPost_(state,id,true);
    }
    if(action==='unpublish' || action==='delete') {
      const id=cmsId_(payload.id), row=state.posts[id];
      if(!row || row.deleted || row.revision!==payload.revision) cmsFail_('다른 창에서 수정됐습니다. 목록을 다시 열어 주세요.');
      if(row.source){row.published=null;row.override=true;row.deleted=action==='delete';row.revision++;row.updated=new Date().toISOString();}
      else if(action==='delete') delete state.posts[id];
      else { row.published=null; row.revision++; row.updated=new Date().toISOString(); }
      cmsWrite_(state); cmsSyncSafely_(state); value={ok:true};
    }
    if(action==='site-sync') { cmsSyncSafely_(state); value=cmsStatus_(state); }
    return {ok:true,value};
  } catch(error) { return {ok:false,error:error.cmsSafe?error.message:'요청을 처리하지 못했습니다. 저장소와 연결 설정을 확인해 주세요.'}; }
  finally { if(lock) lock.releaseLock(); }
}

function cmsYoutube_(value) {
  const match=/^https:\/\/(?:www\.|m\.)?(?:youtu\.be\/([\w-]{11})(?:[?#].*)?|youtube\.com\/(?:watch\?(?:[^#]*&)?v=([\w-]{11})(?:[&#].*)?|(?:shorts|live|embed)\/([\w-]{11})(?:[?/#].*)?))$/.exec(value);
  return match&&(match[1]||match[2]||match[3]);
}
function cmsImage_(value) {
  const path=cmsText_(value||'',1000,false).replace(/^\//,'');
  if(!path)return '';
  if(!/^images\//.test(path)||/[\\\x00-\x1f?#<>]/.test(path)||path.split('/').some(part=>!part||part==='.'||part==='..')||/%(?:2e|2f|5c)/i.test(path))cmsFail_('기존 사진은 홈페이지 images 폴더의 안전한 경로만 사용할 수 있습니다.');
  return path;
}
function cmsSourceKey_(source) { return source.collection+':'+(source.collection==='publication'?source.sourceId:source.path); }
function cmsSource_(entry) {
  if(!entry||!CMS_COLLECTIONS.includes(entry.collection)||!cmsSha_(entry.sha))cmsFail_('홈페이지 가져오기 목록 형식이 올바르지 않습니다.');
  const source=JSON.parse(JSON.stringify(entry));
  if(entry.collection==='publication') {
    if(entry.path!=='_data/citations.yaml'||typeof entry.sourceId!=='string'||!entry.sourceId||entry.sourceId.length>1000||!entry.record||Array.isArray(entry.record)||typeof entry.record!=='object')cmsFail_('현재 논문 자료의 원본 정보를 확인해 주세요.');
    if(entry.record.image)cmsImage_(entry.record.image);
    source.url='/research/';
  } else {
    if(typeof entry.path!=='string'||entry.path.length>500||/[\\\x00-\x1f]/.test(entry.path)||entry.path.split('/').length!==2||!entry.path.startsWith('_'+entry.collection+'/')||!entry.path.endsWith('.md')||/^_(?:blog|notice)\/cms-[a-f0-9]{32}\.md$/.test(entry.path))cmsFail_('기존 블로그·공지의 원본 경로를 확인해 주세요.');
    if(typeof entry.url!=='string'||!entry.url.startsWith('/'+entry.collection+'/')||entry.url.includes('..')||/[\\\x00-\x1f?#<>"']/.test(entry.url))cmsFail_('기존 글 주소를 확인해 주세요.');
    if(typeof entry.body!=='string'||entry.body.length>200000||!entry.frontMatter||typeof entry.frontMatter!=='object'||Array.isArray(entry.frontMatter)||Object.keys(entry.frontMatter).some(key=>['__proto__','constructor','prototype'].includes(key)))cmsFail_('기존 글의 원문 형식을 확인해 주세요.');
    if(entry.image)cmsImage_(entry.image);
  }
  return source;
}
function cmsCheckSource_(source,head) {
  if(!head.files[source.path]||head.files[source.path].sha!==source.sha)cmsFail_('홈페이지 원본이 GitHub에서 변경됐습니다. 배포가 끝난 뒤 최신 원본을 다시 가져와 주세요.');
}
function cmsCatalog_() {
  const response=UrlFetchApp.fetch(CMS_SITE+'/content/cms-source-catalog.json?t='+Date.now(),{muteHttpExceptions:true,followRedirects:false});
  if(response.getResponseCode()!==200)cmsFail_('현재 홈페이지 자료 목록을 가져오지 못했습니다. 홈페이지 배포가 끝난 뒤 다시 시도해 주세요.');
  const text=response.getContentText();if(text.length>3000000)cmsFail_('홈페이지 가져오기 목록이 너무 큽니다.');
  let catalog;try{catalog=JSON.parse(text);}catch(error){cmsFail_('홈페이지 가져오기 목록을 읽지 못했습니다.');}
  if(!catalog||catalog.version!==1||!Array.isArray(catalog.entries)||catalog.entries.length>500)cmsFail_('홈페이지 가져오기 목록 형식이 올바르지 않습니다.');
  const seen=new Set();
  return catalog.entries.map(entry=>{const source=cmsSource_(entry),key=cmsSourceKey_(source);if(seen.has(key))cmsFail_('홈페이지 원본 목록이 중복되어 있습니다.');seen.add(key);return source;});
}
function cmsRecordDate_(record) {
  const value=String(record.date||record.year+'-01-01');
  return /^\d{4}-\d{2}$/.test(value)?value+'-01':/^\d{4}$/.test(value)?value+'-01-01':value.slice(0,10);
}
function cmsImportedRow_(source,id) {
  const record=source.record||{}, input=source.collection==='publication'?{collection:'publication',title:record.title,excerpt:record.description||record.summary||'',date:cmsRecordDate_(record),authors:record.authors,publisher:record.publisher||'',link:record.link||'',region:record.region||'international',publicationStatus:record.status||'published',kind:record.kind||'paper',degree:record.degree||'',blocks:[],coverId:'',displayMode:'story'}:{collection:source.collection,title:source.title||source.frontMatter.title||'',excerpt:source.excerpt||'',date:String(source.date).slice(0,10),displayMode:source.frontMatter.display_mode||'story',coverId:'',blocks:[],markdown:source.body};
  const clean=cmsValidate_({media:{}},input,true,source),now=new Date().toISOString();
  return {id,source,publishedSource:source,draft:clean,published:JSON.parse(JSON.stringify(clean)),revision:1,updated:now,override:false};
}
function cmsImport_(state) {
  const entries=cmsCatalog_(),head=cmsHead_(),next=[],known=new Set(Object.values(state.posts).filter(row=>row.source).map(row=>cmsSourceKey_(row.source)));let skipped=0;
  // Validate all source hashes and records before a single durable state write.
  entries.forEach(source=>{cmsCheckSource_(source,head);if(known.has(cmsSourceKey_(source))){skipped++;return;}const id=cmsDigest_('lab-cms-source:'+cmsSourceKey_(source)).slice(0,32);if(state.posts[id])cmsFail_('기존 CMS 자료와 가져오기 식별자가 충돌합니다.');next.push(cmsImportedRow_(source,id));});
  if(Object.keys(state.posts).length+next.length>500)cmsFail_('게시물은 500개까지 관리할 수 있습니다.');
  next.forEach(row=>{state.posts[row.id]=row;});
  return {imported:next.length,skipped,posts:cmsPosts_(state),message:'현재 홈페이지 자료 '+next.length+'개를 가져왔습니다. 원본과 홈페이지 표시는 아직 변경하지 않았습니다.'};
}
function cmsMarkdownBody_(value,original) {
  if(typeof value!=='string'||value.length>200000||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value))cmsFail_('기존 글의 Markdown 본문을 확인해 주세요.');
  // Textareas normalize CRLF. Preserve the exact trusted original on a no-op edit.
  if(value===original||typeof original==='string'&&value.replace(/\r\n/g,'\n')===original.replace(/\r\n/g,'\n'))return original;
  if(/[<>]|\{[{%:]|[%}]\}/.test(value)||/(?:javascript|vbscript|data)\s*:/i.test(value)||/&(?:#x?[0-9a-f]+|colon|Tab|NewLine);/i.test(value))cmsFail_('수정한 원문에는 HTML·Liquid·실행 가능한 링크를 사용할 수 없습니다. 일반 Markdown으로 작성해 주세요.');
  const links=[...value.matchAll(/\]\(\s*([^\s)]+)/g),...value.matchAll(/^\s{0,3}\[[^\]]+\]:\s*(\S+)/gm)];
  links.forEach(match=>{let target=match[1].replace(/\\/g,'');try{target=decodeURIComponent(target);}catch(error){}const scheme=target.match(/^([a-z][a-z0-9+.-]*):/i);if(scheme&&!/^(https?|mailto)$/i.test(scheme[1]))cmsFail_('수정한 본문의 링크 형식을 확인해 주세요.');});
  return value;
}
function cmsValidate_(state,input,publish,source) {
  if(!input || !Array.isArray(input.blocks) || input.blocks.length>100) cmsFail_('본문 형식을 확인해 주세요.');
  if(!CMS_COLLECTIONS.includes(input.collection))cmsFail_('블로그·공지·논문만 CMS에서 관리할 수 있습니다.');
  const paper=input.collection==='publication';
  const post={collection:input.collection,title:cmsText_(input.title||'',500,publish),excerpt:cmsText_(input.excerpt||'',1000),date:cmsDate_(input.date||cmsToday_()),displayMode:input.displayMode||'story',coverId:input.coverId||'',blocks:[]};
  if(source&&source.collection!==input.collection)cmsFail_('기존 자료의 분류는 변경할 수 없습니다.');
  if(source&&!paper) {
    post.markdown=cmsMarkdownBody_(input.markdown===undefined?source.body:input.markdown,source.body);
    if(input.removeOriginalImage!==undefined&&typeof input.removeOriginalImage!=='boolean')cmsFail_('기존 사진 선택을 확인해 주세요.');
    post.removeOriginalImage=!!input.removeOriginalImage;
  } else if(input.markdown!==undefined||!source&&input.removeOriginalImage)cmsFail_('기존 글에서만 원문을 편집할 수 있습니다.');
  if(paper) {
    if(!Array.isArray(input.authors)||input.authors.length>40||publish&&!input.authors.length)cmsFail_('논문 저자를 한 명씩 입력해 주세요.');
    post.authors=input.authors.map(author=>cmsText_(author,160,true));
    post.publisher=cmsText_(input.publisher||'',300,publish);
    post.link=cmsText_(input.link||'',1000,false);
    if(post.link&&!/^https:\/\/(?![^/?#]*@)[a-z0-9][a-z0-9.-]*(?::443)?(?:[/?#][^\s<>\\]*)?$/i.test(post.link)&&!(source&&source.record&&post.link===source.record.link&&/^http:\/\/(?![^/?#]*@)[a-z0-9][a-z0-9.-]*(?:[/?#][^\s<>\\]*)?$/i.test(post.link)))cmsFail_('새 논문 링크는 HTTPS 웹 주소를 입력해 주세요.');
    post.region=input.region||'international';post.publicationStatus=input.publicationStatus||'published';
    if(!['international','domestic'].includes(post.region)||!['published','online ahead of print','in press','in_press'].includes(post.publicationStatus))cmsFail_('논문 구분과 게재 상태를 확인해 주세요.');
    post.kind=input.kind||'paper';if(!['paper','thesis'].includes(post.kind))cmsFail_('논문 종류를 확인해 주세요.');
    post.degree=post.kind==='thesis'?cmsText_(input.degree||'',20,publish):'';
    if(post.kind==='thesis'&&!['Ph.D.','M.S.'].includes(post.degree))cmsFail_('학위 종류를 선택해 주세요.');
    post.year=source&&source.record&&post.date===cmsRecordDate_(source.record)&&Number.isInteger(Number(source.record.year))?Number(source.record.year):Number(post.date.slice(0,4));
    if(input.removeOriginalImage!==undefined&&typeof input.removeOriginalImage!=='boolean')cmsFail_('기존 사진 선택을 확인해 주세요.');
    post.removeOriginalImage=!!input.removeOriginalImage;
    if(input.blocks.length>1||input.blocks.some(block=>!block||block.type!=='image'))cmsFail_('논문에는 선택한 이미지 한 장만 첨부할 수 있습니다.');
  }
  if(!['story','gallery'].includes(post.displayMode)) cmsFail_('이야기형 또는 사진첩형을 선택해 주세요.');
  const ids=[];
  input.blocks.forEach(block=>{
    if(!block || typeof block!=='object') cmsFail_('본문 형식을 확인해 주세요.');
    if(['text','heading'].includes(block.type)) { const text=cmsText_(block.text||'',10000); if(text)post.blocks.push({type:block.type,text}); }
    else if(['image','video'].includes(block.type)) {
      const id=cmsId_(block.mediaId), media=state.media[id];
      if(!media || media.kind!==block.type) cmsFail_('첨부파일을 확인해 주세요.');
      ids.push(id); post.blocks.push({type:block.type,mediaId:id,caption:cmsText_(block.caption||'',300),alt:cmsText_(block.alt||'',160)});
    } else if(block.type==='youtube') {
      const id=cmsYoutube_(cmsText_(block.url||'',500)); if(!id)cmsFail_('유튜브 주소를 확인해 주세요.');
      post.blocks.push({type:'youtube',videoId:id,url:'https://www.youtube.com/watch?v='+id,caption:cmsText_(block.caption||'',300)});
    } else cmsFail_('지원하지 않는 본문 형식입니다.');
  });
  if(ids.length>30)cmsFail_('한 게시물에는 사진·영상 30개까지 첨부할 수 있습니다.');
  if(publish && !paper && !post.blocks.length && !source)cmsFail_('글이나 사진·영상을 하나 이상 넣어 주세요.');
  if(post.coverId && !ids.includes(post.coverId))cmsFail_('대표 이미지는 본문의 첨부파일 중 선택해 주세요.');
  post.coverId=source?post.coverId:post.coverId||ids[0]||'';
  if(!post.excerpt)post.excerpt=(post.blocks.find(b=>b.type==='text')||{text:''}).text.slice(0,140);
  return post;
}
function cmsDataImage_(fileId) { return 'data:image/jpeg;base64,'+Utilities.base64Encode(cmsFile_(fileId).getBlob().getBytes()); }
function cmsMedia_(state,id,detail) {
  const asset=state.media[id]; if(!asset)cmsFail_('첨부파일을 찾을 수 없습니다.');
  const thumb=cmsDataImage_(asset.thumbId);
  return {id,kind:asset.kind,status:'ready',size:asset.size,error:'',url:asset.kind==='image'?thumb:'',poster:asset.kind==='video'?thumb:'',previewUrl:asset.kind==='video'?'https://drive.google.com/file/d/'+asset.fileId+'/preview':'',driveUrl:asset.kind==='video'?'https://drive.google.com/file/d/'+asset.fileId+'/view':''};
}
function cmsPosts_(state) {
  return Object.values(state.posts).filter(row=>!row.deleted)
    .sort((a,b)=>String(b.draft.date||'').localeCompare(String(a.draft.date||''))||a.id.localeCompare(b.id))
    .map(row=>cmsPost_(state,row.id,false));
}
function cmsPost_(state,id,detail) {
  const row=state.posts[id]; if(!row||row.deleted)cmsFail_('게시물을 찾을 수 없습니다.');
  const value=JSON.parse(JSON.stringify(row.draft)), ids=detail?value.blocks.filter(b=>b.mediaId).map(b=>b.mediaId):[value.coverId];
  value.media={}; [...new Set(ids)].filter(Boolean).forEach(mid=>value.media[mid]=cmsMedia_(state,mid,detail));
  const keys=['collection','title','excerpt','date','displayMode','coverId','blocks','authors','publisher','link','region','publicationStatus','kind','degree','markdown','removeOriginalImage'];
  const originalImage=row.source&&(row.source.collection==='publication'?row.source.record.image:row.source.image);
  return Object.assign(value,{id,revision:row.revision,updated:row.updated,status:row.published?'published':'draft',hasChanges:!!row.published&&keys.some(k=>JSON.stringify(row.draft[k])!==JSON.stringify(row.published[k])),sourceImported:!!row.source,legacyImageUrl:originalImage?CMS_SITE+'/'+cmsImage_(originalImage):'',url:row.source&&row.source.url||(value.collection==='publication'?'/research/':'/'+value.collection+'/cms-'+id+'/')});
}
function cmsBase64_(value,max) {
  // Avoid a repeated regex group: multi-megabyte images can overflow its stack.
  if(typeof value!=='string' || value.length>Math.ceil(max/3)*4 || value.length%4!==0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value))cmsFail_('첨부파일 형식을 확인해 주세요.');
  const bytes=Utilities.base64Decode(value); if(!bytes.length||bytes.length>max)cmsFail_('첨부파일 용량을 줄여 주세요.');
  if(Utilities.base64Encode(bytes)!==value)cmsFail_('첨부파일 형식을 확인해 주세요.');
  return bytes;
}
function cmsJpeg_(bytes) { return bytes.length>=4 && (bytes[0]&255)===255 && (bytes[1]&255)===216 && (bytes[2]&255)===255; }
function cmsUpload_(state,payload) {
  if(!['image','video'].includes(payload.kind))cmsFail_('JPEG 사진 또는 MP4 영상만 사용할 수 있습니다.');
  const video=payload.kind==='video', bytes=cmsBase64_(payload.base64,video?CMS_MAX_VIDEO:CMS_MAX_IMAGE), thumbnail=cmsBase64_(payload.thumbnail,250000);
  if(video ? bytes.length<12 || String.fromCharCode.apply(null,bytes.slice(4,8))!=='ftyp' : !cmsJpeg_(bytes))cmsFail_('사진은 JPEG, 영상은 MP4 파일을 사용해 주세요.');
  if(!cmsJpeg_(thumbnail))cmsFail_('대표 이미지는 JPEG 파일이어야 합니다.');
  const id=cmsUuid_(), folder=cmsFolder_(); let file,thumb;
  try {
    file=folder.createFile(Utilities.newBlob(bytes,video?'video/mp4':'image/jpeg',id+(video?'.mp4':'.jpg')));
    thumb=folder.createFile(Utilities.newBlob(thumbnail,'image/jpeg',id+'-thumb.jpg'));
    cmsPrivate_(file); cmsPrivate_(thumb);
    state.media[id]={id,kind:payload.kind,fileId:file.getId(),thumbId:thumb.getId(),size:bytes.length};
    return cmsMedia_(state,id,true);
  } catch(error) { try{if(file)file.setTrashed(true);if(thumb)thumb.setTrashed(true);}catch(cleanup){} throw error; }
}

function cmsAssetPath_(id,kind,poster) { cmsId_(id); return 'images/cms/'+id+(poster?'-poster.jpg':kind==='video'?'.mp4':'.jpg'); }
function cmsMarkdown_(row,state) {
  if(!['blog','notice'].includes(row.published.collection))cmsFail_('블로그 또는 공지 글만 Markdown으로 게시할 수 있습니다.');
  const source=row.publishedSource||row.source,post=row.published, e=cmsEscape_, cover=post.coverId&&state.media[post.coverId], front=Object.assign({},source&&source.frontMatter||{},{layout:'post',title:post.title,date:post.date,published:true,summary:post.excerpt,description:post.excerpt,cms_entry_id:cmsId_(row.id),cms_revision:row.revision,display_mode:post.displayMode});
  if(source){front.cms_source_path=source.path;front.permalink=source.url;delete front.cms_hidden;}
  if(source&&post.removeOriginalImage){delete front.image;delete front.image_alt;delete front.image_caption;}
  else if(source&&front.image)front.image=cmsImage_(front.image);
  if(cover) {
    const block=post.blocks.find(b=>b.mediaId===post.coverId)||{};
    front.image=cmsAssetPath_(post.coverId,cover.kind,cover.kind==='video'); front.image_alt=block.alt||post.title; front.image_caption=block.caption||'';
  }
  const parts=[], gallery=[];
  const flush=()=>{if(gallery.length){parts.push('<div class="article-gallery">'+gallery.join('')+'</div>');gallery.length=0;}};
  post.blocks.forEach(b=>{
    if(b.type==='image' && b.mediaId===post.coverId)return;
    const caption=b.caption?'<figcaption>'+e(b.caption)+'</figcaption>':'';
    if(post.displayMode==='gallery'&&b.type==='image') {
      gallery.push('<figure><img src="/'+cmsAssetPath_(b.mediaId,'image',false)+'" alt="'+e(b.alt||post.title)+'" loading="lazy">'+caption+'</figure>'); return;
    }
    flush();
    if(b.type==='text') {parts.push('<p>'+e(b.text).replace(/\n/g,'<br>')+'</p>');return;}
    if(b.type==='heading') {parts.push('<h2>'+e(b.text)+'</h2>');return;}
    const html=b.type==='youtube'?'<iframe style="width:100%;aspect-ratio:16/9;border:0" src="https://www.youtube-nocookie.com/embed/'+e(b.videoId)+'" title="'+e(b.caption||post.title)+'" loading="lazy" allowfullscreen></iframe>':b.type==='image'?'<img src="/'+cmsAssetPath_(b.mediaId,'image',false)+'" alt="'+e(b.alt||post.title)+'" loading="lazy">':'<video style="display:block;width:100%;max-width:100%" controls playsinline preload="metadata" poster="/'+cmsAssetPath_(b.mediaId,'video',true)+'" src="/'+cmsAssetPath_(b.mediaId,'video',false)+'"></video>';
    parts.push('<figure>'+html+caption+'</figure>');
  }); flush();
  return cmsDocument_(front,(post.markdown===undefined?'':cmsMarkdownBody_(post.markdown,source&&source.body||'')+'\n\n')+parts.join('\n\n'));
}
function cmsYamlValue_(value) {
  // Escape Liquid delimiters only inside JSON strings, never object syntax.
  return JSON.stringify(value).replace(/"(?:\\.|[^"\\])*"/g,token=>token.replace(/\{/g,'\\u007b').replace(/\}/g,'\\u007d'));
}
function cmsDocument_(front,body) { return '---\n'+Object.keys(front).map(key=>JSON.stringify(key)+': '+cmsYamlValue_(front[key])).join('\n')+'\n---\n\n'+body+'\n'; }
function cmsTombstone_(row) { return cmsDocument_({layout:'post',title:row.draft.title,date:row.draft.date,published:true,cms_hidden:true,cms_source_path:row.source.path,permalink:row.source.url,cms_entry_id:cmsId_(row.id),cms_revision:row.revision},''); }
function cmsPublication_(row,state) {
  const source=row.publishedSource||row.source,post=cmsValidate_(state,row.published,true,source);
  if(post.collection!=='publication')cmsFail_('논문 자료가 아닙니다.');
  const result=Object.assign({},source&&source.record||{},{id:'cms:'+cmsId_(row.id),title:post.title,authors:post.authors,publisher:post.publisher,year:post.year,date:post.date,link:post.link,kind:post.kind,region:post.region,status:post.publicationStatus,description:post.excerpt});
  if(source)result.sourceId=source.sourceId;
  if(source){if(source.record.id)result.id=source.record.id;else delete result.id;}
  if(source&&post.date===cmsRecordDate_(source.record)&&source.record.date)result.date=source.record.date;
  delete result.cms_hidden;
  if(post.kind==='thesis')result.degree=post.degree;else delete result.degree;
  if(post.removeOriginalImage)delete result.image;
  else if(result.image)result.image=cmsImage_(result.image);
  if(post.coverId)result.image=cmsAssetPath_(post.coverId,'image',false);
  return result;
}
function cmsGithub_(path,method,body,allow404) {
  const token=cmsProps_().getProperty('CMS_GITHUB_TOKEN');
  if(!token)cmsFail_('GitHub 게시 연결 키가 아직 설정되지 않았습니다. 글은 Google에 저장됩니다.');
  const options={method:method||'get',headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'},muteHttpExceptions:true,followRedirects:false};
  if(body!==undefined){options.contentType='application/json';options.payload=JSON.stringify(body);}
  const response=UrlFetchApp.fetch(CMS_REPO+path,options), code=response.getResponseCode();
  if(allow404&&code===404)return null;
  if(code<200||code>=300){const error=new Error('GitHub 게시 요청이 거절됐습니다 ('+code+'). 연결 권한·만료와 원격 변경을 확인한 뒤 다시 반영해 주세요.');error.cmsSafe=true;error.githubStatus=code;throw error;}
  return JSON.parse(response.getContentText());
}
function cmsBlob_(content,base64) { return cmsGithub_('/git/blobs','post',{content,encoding:base64?'base64':'utf-8'}).sha; }
function cmsOwned_(path) { return [CMS_RELEASE,'_data/cms-publications.json'].includes(path) || /^(?:_(?:blog|notice)\/cms-[a-f0-9]{32}\.md|images\/cms\/[a-f0-9]{32}(?:\.jpg|\.mp4|-poster\.jpg))$/.test(path); }
function cmsSha_(value) { return typeof value==='string'&&/^[a-f0-9]{40}$/.test(value); }
function cmsDigest_(value) { return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,value).map(b=>('0'+(b&255).toString(16)).slice(-2)).join(''); }
function cmsReadBlob_(sha) {
  const blob=cmsGithub_('/git/blobs/'+sha);
  if(blob.encoding!=='base64'||typeof blob.content!=='string'||blob.content.length>2000000)cmsFail_('GitHub 게시 기록을 읽을 수 없습니다.');
  return Utilities.newBlob(Utilities.base64Decode(blob.content.replace(/\s/g,''))).getDataAsString('UTF-8');
}
function cmsHead_() {
  const ref=cmsGithub_('/git/ref/heads/main'), commit=cmsGithub_('/git/commits/'+ref.object.sha), tree=cmsGithub_('/git/trees/'+commit.tree.sha+'?recursive=1');
  if(tree.truncated||!Array.isArray(tree.tree))cmsFail_('저장소 전체 파일 목록을 확인할 수 없어 게시를 중단했습니다.');
  const files={}; tree.tree.filter(item=>item.type==='blob').forEach(item=>{files[item.path]=item;});
  return {sha:ref.object.sha,tree:commit.tree.sha,files};
}
function cmsPrior_(head) {
  let prior={version:2,ownerId:'',ownerEmail:'',files:{}};
  if(head.files[CMS_MANIFEST]) {
    try { prior=JSON.parse(cmsReadBlob_(head.files[CMS_MANIFEST].sha)); } catch(error) { if(error.cmsSafe)throw error;cmsFail_('CMS 게시 목록 형식이 올바르지 않습니다.'); }
    if(Array.isArray(prior.files)&&prior.files.length===0&&!prior.ownerId)prior={version:2,ownerId:'',ownerEmail:'',files:{}};
  }
  if(!prior||prior.version!==2||!prior.files||typeof prior.files!=='object'||Array.isArray(prior.files)||Object.keys(prior.files).some(path=>!cmsOwned_(path)||!cmsSha_(prior.files[path])))cmsFail_('CMS 게시 파일 목록이 올바르지 않습니다.');
  const paths=Object.keys(prior.files), instance=cmsProps_().getProperty('CMS_INSTANCE_ID');
  if((prior.ownerId||paths.length) && (prior.ownerId!==instance||prior.ownerEmail!==CMS_PRIMARY))cmsFail_('다른 CMS 저장소의 게시 기록입니다. 기존 데이터를 복구한 뒤 연결해 주세요.');
  paths.forEach(path=>{if(!head.files[path]||head.files[path].sha!==prior.files[path])cmsFail_('CMS 게시 파일이 GitHub에서 별도로 수정되거나 삭제됐습니다. 원본을 덮어쓰지 않았습니다.');});
  Object.keys(head.files).filter(cmsOwned_).forEach(path=>{if(!Object.prototype.hasOwnProperty.call(prior.files,path))cmsFail_('게시 목록에 없는 CMS 파일이 있습니다. 기존 파일을 덮어쓰지 않았습니다.');});
  return prior;
}
function cmsRecover_(state) {
  const pending=state.publication&&state.publication.pending;
  if(!pending)return;
  if(!cmsSha_(pending.commit)||!cmsSha_(pending.manifest)||typeof pending.release!=='string')cmsFail_('게시 복구 기록을 확인해 주세요.');
  const compare=cmsGithub_('/compare/'+pending.commit+'...main');
  if(compare.status==='diverged') {
    state.publication={phase:'error',message:'동시에 다른 GitHub 변경이 있어 다시 반영해야 합니다.'};cmsWrite_(state);return;
  }
  if(!['identical','ahead','behind'].includes(compare.status))cmsFail_('GitHub 반영 결과를 확인하지 못했습니다. 잠시 뒤 다시 반영해 주세요.');
  const prepared=cmsGithub_('/git/commits/'+pending.commit), tree=cmsGithub_('/git/trees/'+prepared.tree.sha+'?recursive=1');
  if(tree.truncated||!tree.tree.some(item=>item.path===CMS_MANIFEST&&item.sha===pending.manifest))cmsFail_('준비된 게시 기록을 확인하지 못했습니다. 다시 게시하지 말고 설정을 확인해 주세요.');
  if(compare.status==='behind')cmsGithub_('/git/refs/heads/main','patch',{sha:pending.commit,force:false});
  state.publication={phase:'building',message:'GitHub 반영을 확인했습니다. 홈페이지 배포를 확인하고 있습니다.',commit:pending.commit,release:pending.release,started:Date.now()};cmsWrite_(state);
}
function cmsSyncSafely_(state) {
  try {
    if(state.publication&&state.publication.pending){cmsRecover_(state);return;}
    state.publication={phase:'sending',message:'홈페이지로 전송 중입니다.',started:Date.now()};cmsWrite_(state);
    cmsSync_(state);
  } catch(error) {
    state.publication=Object.assign({},state.publication,{phase:state.publication&&state.publication.pending?'uncertain':'error',message:error.cmsSafe?error.message:'전송 결과를 확인하지 못했습니다. 글은 Google에 저장되어 있습니다. 다시 반영해 주세요.'});
  }
  cmsWrite_(state);
}
function cmsSync_(state) {
  // Validate the remote manifest before creating even unreferenced Git blobs.
  const initial=cmsHead_();cmsPrior_(initial);
  const pending={}, active=Object.values(state.posts).filter(row=>!row.source||row.override), posts=active.filter(row=>row.published), mediaIds=[...new Set(posts.flatMap(row=>row.published.blocks.filter(b=>b.mediaId).map(b=>b.mediaId)))];
  active.filter(row=>row.source).forEach(row=>{cmsSource_(row.source);cmsCheckSource_(row.source,initial);});
  // Validate all published snapshots before producing any repository writes.
  posts.forEach(row=>{cmsId_(row.id);cmsValidate_(state,row.published,true,row.publishedSource||row.source);});
  mediaIds.forEach(id=>{
    const asset=state.media[cmsId_(id)], bytes=cmsFile_(asset.fileId).getBlob().getBytes();
    if(bytes.length!==asset.size)cmsFail_('저장된 첨부파일 크기가 변경됐습니다. 백업을 확인해 주세요.');
    pending[cmsAssetPath_(id,asset.kind,false)]=cmsBlob_(Utilities.base64Encode(bytes),true);
    if(asset.kind==='video')pending[cmsAssetPath_(id,'video',true)]=cmsBlob_(Utilities.base64Encode(cmsFile_(asset.thumbId).getBlob().getBytes()),true);
  });
  posts.filter(row=>row.published.collection!=='publication').forEach(row=>{pending['_'+row.published.collection+'/cms-'+row.id+'.md']=cmsBlob_(cmsMarkdown_(row,state),false);});
  const papers=posts.filter(row=>row.published.collection==='publication').map(row=>cmsPublication_(row,state));
  active.filter(row=>row.source&&!row.published).forEach(row=>{if(row.source.collection==='publication')papers.push({sourceId:row.source.sourceId,cms_hidden:true});else pending['_'+row.source.collection+'/cms-'+row.id+'.md']=cmsBlob_(cmsTombstone_(row),false);});
  if(papers.length)pending['_data/cms-publications.json']=cmsBlob_(JSON.stringify(papers),false);
  const release=cmsDigest_(JSON.stringify(Object.keys(pending).sort().map(path=>[path,pending[path]])));
  pending[CMS_RELEASE]=cmsBlob_(JSON.stringify({id:release}),false);
  const manifest={version:2,ownerId:cmsProps_().getProperty('CMS_INSTANCE_ID'),ownerEmail:CMS_PRIMARY,files:{}};
  Object.keys(pending).sort().forEach(path=>{if(!cmsOwned_(path))cmsFail_('허용되지 않은 게시 경로입니다.');manifest.files[path]=pending[path];});
  const manifestSha=cmsBlob_(JSON.stringify(manifest),false);pending[CMS_MANIFEST]=manifestSha;
  for(let attempt=0;attempt<3;attempt++) {
    const head=cmsHead_(), prior=cmsPrior_(head);
    active.filter(row=>row.source).forEach(row=>cmsCheckSource_(row.source,head));
    const updates=Object.keys(pending).filter(path=>!head.files[path]||head.files[path].sha!==pending[path]).map(path=>({path,mode:'100644',type:'blob',sha:pending[path]}));
    Object.keys(prior.files).filter(path=>!Object.prototype.hasOwnProperty.call(pending,path)).forEach(path=>updates.push({path,mode:'100644',type:'blob',sha:null}));
    if(!updates.length){state.publication={phase:'building',message:'GitHub 내용은 최신입니다. 홈페이지 반영을 확인하고 있습니다.',commit:head.sha,release,started:Date.now()};return;}
    const tree=cmsGithub_('/git/trees','post',{base_tree:head.tree,tree:updates}), commit=cmsGithub_('/git/commits','post',{message:'Publish lab Blog from Google CMS',tree:tree.sha,parents:[head.sha]});
    state.publication={phase:'sending',message:'GitHub 반영 결과를 확인하고 있습니다.',started:Date.now(),pending:{commit:commit.sha,manifest:manifestSha,release}};cmsWrite_(state);
    try { cmsGithub_('/git/refs/heads/main','patch',{sha:commit.sha,force:false}); }
    catch(error) {
      if([409,422].includes(error.githubStatus)) { state.publication={phase:'sending',message:'동시 변경을 보존하여 다시 반영하고 있습니다.',started:Date.now()};cmsWrite_(state);if(attempt<2)continue; }
      throw error;
    }
    state.publication={phase:'building',message:'전송했습니다. 홈페이지 배포를 확인하고 있습니다.',commit:commit.sha,release,started:Date.now()};return;
  }
}
function cmsStatus_(state) {
  const status=Object.assign({},state.publication,{enabled:true,siteUrl:CMS_SITE}); delete status.pending;
  if(status.phase==='building') {
    const cache=CacheService.getScriptCache(),key='lab-cms-live-'+status.release;let live=cache.get(key)==='yes';
    if(!live)try { const response=UrlFetchApp.fetch(CMS_SITE+'/'+CMS_RELEASE+'?cms='+encodeURIComponent(status.release)+'&t='+Date.now(),{muteHttpExceptions:true,followRedirects:false});live=response.getResponseCode()===200&&JSON.parse(response.getContentText()).id===status.release;if(live)cache.put(key,'yes',600); } catch(error){}
    if(live){status.phase='live';status.message='홈페이지 반영을 확인했습니다.';}
    else if(Date.now()-status.started>600000){status.phase='unconfirmed';status.message='GitHub 전송은 완료됐지만 홈페이지 반영을 아직 확인하지 못했습니다. 다시 반영해 주세요.';}
  }
  if(!cmsProps_().getProperty('CMS_GITHUB_TOKEN')){status.phase='error';status.message='GitHub 게시 연결 키가 필요합니다. 임시저장은 사용할 수 있습니다.';}
  return status;
}
