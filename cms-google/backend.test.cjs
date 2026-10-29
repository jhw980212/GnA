const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const SOURCE = fs.readFileSync(require('node:path').join(__dirname,'Code.gs'),'utf8');
const PRIMARY='plie0312@gmail.com', PERSONAL='jhw980212@gmail.com', SCHOOL='jhw980212@khu.ac.kr';
const ADMINS=[PRIMARY,PERSONAL,SCHOOL], ID='a'.repeat(32), OTHER='b'.repeat(32);
const JPEG=Buffer.from([255,216,255,224,0,0,255,217]);
const json=value=>JSON.parse(JSON.stringify(value));
const sha=value=>crypto.createHash('sha1').update(value).digest('hex');

function fixture(options={}) {
  let counter=0, active=PRIMARY, effective=PRIMARY, locked=false;
  const properties={}, files=new Map(), caches=new Map(), requests=[], blobs=new Map(), trees=new Map(), commits=new Map();
  const flags={};
  const state={properties,files,requests,blobs,trees,commits,flags,refWrites:0,permissionInvites:[],liveRelease:''};
  const response=(value,code=200)=>({getResponseCode:()=>code,getContentText:()=>typeof value==='string'?value:JSON.stringify(value)});
  const blob=value=>{
    const bytes=Buffer.isBuffer(value)?value:Array.isArray(value)?Buffer.from(value):Buffer.from(String(value),'utf8');
    return {getBytes:()=>Array.from(bytes),getDataAsString:()=>bytes.toString('utf8')};
  };
  function makeFile(name,content,parent,folder=false) {
    const id='drive-'+(++counter), owner=active;
    const value={id,name,bytes:blob(content||''),parent,folder,owner,public:false,trashed:false,permissions:[{id:'owner-'+id,type:'user',emailAddress:owner,role:'owner'}]};
    if(parent) value.permissions.push(...files.get(parent).permissions.filter(p=>p.role!=='owner'&&p.emailAddress!==owner).map(p=>({...p})));
    Object.assign(value,{
      getId:()=>id,getOwner:()=>({getEmail:()=>value.owner}),getSharingAccess:()=>value.public?'ANYONE':'PRIVATE',
      getBlob:()=>value.bytes,setContent:source=>{if(flags.failStateWrite&&name==='lab-cms-state.json'){flags.failStateWrite=false;throw Error('lost write');}value.bytes=blob(source);return value;},
      getParents:()=>{let consumed=false;return {hasNext:()=>!!value.parent&&!consumed,next:()=>{consumed=true;return files.get(value.parent);}};},
      createFile:(nameOrBlob,source)=>makeFile(typeof nameOrBlob==='string'?nameOrBlob:'media',typeof nameOrBlob==='string'?source:nameOrBlob.getBytes(),id),
      setTrashed:trashed=>{value.trashed=trashed;},
    });files.set(id,value);return value;
  }
  const props={getProperty:key=>properties[key]||null,setProperty:(key,value)=>{properties[key]=String(value);return props;},setProperties:values=>{Object.assign(properties,values);return props;}};
  function cache(name) {if(!caches.has(name))caches.set(name,new Map());const map=caches.get(name);return {get:key=>map.get(key)||null,put:(key,value)=>map.set(key,value),remove:key=>map.delete(key)};}
  function putBlob(bytes) {const data=Buffer.from(bytes),hash=sha(Buffer.concat([Buffer.from('blob '+data.length+'\0'),data]));blobs.set(hash,data);return hash;}
  function putTree(tree) {const hash=sha(JSON.stringify(tree));trees.set(hash,{...tree});return hash;}
  function putCommit(tree,parent) {const hash=sha(JSON.stringify({tree,parent,counter:++counter}));commits.set(hash,{sha:hash,tree:{sha:tree},parents:parent?[{sha:parent}]:[]});return hash;}
  const initial={};for(const [path,content] of Object.entries(options.originals||{'_blog/original.md':'Original blog bytes','_notice/original.md':'Original notice bytes','_members/original.md':'Original member bytes','_data/facility.yaml':'Original facility bytes','_data/citations.yaml':'Original citations bytes','index.html':'Original home'}))initial[path]=putBlob(content);
  state.head=putCommit(putTree(initial));
  function ancestor(first,last) {return first===last||(commits.get(last)?.parents||[]).some(p=>ancestor(first,p.sha));}
  function fetcher(url,init={}) {
    const target=new URL(url),method=init.method||'get',body=init.payload?JSON.parse(init.payload):undefined;
    requests.push({url,method,body,options:init});
    if(target.hostname==='www.googleapis.com') {
      assert.equal(init.headers.Authorization,'Bearer google-oauth-token');
      assert.equal(init.followRedirects,false);
      const match=target.pathname.match(/^\/drive\/v3\/files\/([^/]+)\/permissions(?:\/([^/]+))?$/);assert.ok(match,'unknown Drive route');
      const file=files.get(decodeURIComponent(match[1]));assert.ok(file);
      if(method==='get')return response({permissions:json(file.permissions)});
      if(method==='post') {
        assert.equal(target.searchParams.get('sendNotificationEmail'),'false');state.permissionInvites.push(body.emailAddress);
        const permission={id:'permission-'+(++counter),...body};file.permissions.push(permission);return response(permission);
      }
      if(method==='patch'){const permission=file.permissions.find(p=>p.id===match[2]);Object.assign(permission,body);return response(permission);}
    }
    if(target.hostname==='galab.khu.ac.kr')return response({id:state.liveRelease});
    assert.equal(target.hostname,'api.github.com');assert.equal(init.headers.Authorization,'Bearer github-server-token');assert.equal(init.followRedirects,false);
    const path=decodeURIComponent(target.pathname.replace('/repos/jhw980212/GnA',''));
    if(path==='/git/ref/heads/main')return response({object:{sha:state.head}});
    if(path==='/git/blobs'&&method==='post')return response({sha:putBlob(body.encoding==='base64'?Buffer.from(body.content,'base64'):Buffer.from(body.content))},201);
    if(path.startsWith('/git/blobs/')){const hash=path.split('/').at(-1);return response({sha:hash,encoding:'base64',content:blobs.get(hash).toString('base64')});}
    if(path==='/git/trees'&&method==='post') {const tree={...trees.get(body.base_tree)};body.tree.forEach(item=>{if(item.sha===null)delete tree[item.path];else tree[item.path]=item.sha;});return response({sha:putTree(tree)},201);}
    if(path.startsWith('/git/trees/'))return response({truncated:false,tree:Object.entries(trees.get(path.split('/').at(-1))).map(([path,hash])=>({path,sha:hash,type:'blob',size:blobs.get(hash).length}))});
    if(path==='/git/commits'&&method==='post')return response({sha:putCommit(body.tree,body.parents[0])},201);
    if(path.startsWith('/git/commits/'))return response(commits.get(path.split('/').at(-1)));
    if(path==='/git/refs/heads/main') {
      assert.equal(body.force,false);
      if(flags.failRefBefore){flags.failRefBefore=false;throw Error('connection lost before update');}
      if(flags.concurrentRef){flags.concurrentRef=false;const tree={...trees.get(commits.get(state.head).tree.sha),'unrelated.txt':putBlob('Concurrent unrelated file')};state.head=putCommit(putTree(tree),state.head);return response({},422);}
      if(!ancestor(state.head,body.sha))return response({},422);
      state.head=body.sha;state.refWrites++;
      if(flags.failRefAfter){flags.failRefAfter=false;throw Error('connection lost after update');}
      return response({object:{sha:state.head}});
    }
    if(path.startsWith('/compare/')) {const first=path.slice('/compare/'.length).split('...')[0];return response({status:first===state.head?'identical':ancestor(first,state.head)?'ahead':ancestor(state.head,first)?'behind':'diverged'});}
    throw Error('Unexpected API route '+method+' '+path);
  }
  const context={console,Date,JSON,Object,Array,String,Number,Set,Map,Math,RegExp,Error,isNaN,Date,Utilities:{getUuid:()=>String(++counter).padStart(32,'0').replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/,'$1-$2-$3-$4-$5'),formatDate:()=> '2026-10-29',newBlob:blob,base64Encode:bytes=>Buffer.from(bytes).toString('base64'),base64Decode:value=>Array.from(Buffer.from(value,'base64')),DigestAlgorithm:{SHA_256:'sha256'},computeDigest:(algorithm,value)=>Array.from(crypto.createHash('sha256').update(typeof value==='string'?value:Buffer.from(value)).digest())},
    Session:{getActiveUser:()=>({getEmail:()=>active}),getEffectiveUser:()=>({getEmail:()=>effective})},PropertiesService:{getScriptProperties:()=>props},
    LockService:{getScriptLock:()=>({waitLock:()=>{if(locked)throw Error('locked');locked=true;},tryLock:()=>{if(locked)return false;locked=true;return true;},releaseLock:()=>{locked=false;}})},
    CacheService:{getUserCache:()=>cache(active),getScriptCache:()=>cache('script')},ScriptApp:{getOAuthToken:()=> 'google-oauth-token'},
    DriveApp:{Access:{PRIVATE:'PRIVATE'},createFolder:name=>makeFile(name,'',null,true),getFolderById:id=>files.get(id),getFileById:id=>files.get(id)},MimeType:{PLAIN_TEXT:'text/plain'},UrlFetchApp:{fetch:fetcher},
    HtmlService:{createHtmlOutput:source=>({source,setTitle(){return this;},addMetaTag(){return this;},getContent(){return this.source;}}),createHtmlOutputFromFile:()=>({getContent:()=>'<html>Admin</html>'})},
  };
  vm.createContext(context);vm.runInContext(SOURCE,context);
  const f={state,context,identity:(a,e=a)=>{active=a;effective=e;},locked:value=>{locked=value;},readState:()=>JSON.parse(files.get(properties.CMS_STATE_ID).bytes.getDataAsString()),writeState:value=>files.get(properties.CMS_STATE_ID).setContent(JSON.stringify(value)),seed:(path,source)=>{const tree={...trees.get(commits.get(state.head).tree.sha),[path]:putBlob(source)};state.head=putCommit(putTree(tree),state.head);},read:path=>{const hash=trees.get(commits.get(state.head).tree.sha)[path];return hash?blobs.get(hash).toString('utf8'):undefined;},tree:()=>({...trees.get(commits.get(state.head).tree.sha)})};
  f.setup=()=>context.setupLabCms();f.session=()=>json(context.cmsRequest('session',{}));f.call=(action,payload={})=>json(context.cmsRequest(action,{csrf:f.session().value?.csrf,...payload}));
  if(options.setup!==false)f.setup();properties.CMS_GITHUB_TOKEN='github-server-token';
  return f;
}
const post=(collection='blog',overrides={})=>({collection,title:'Research & lab story',excerpt:'Lab summary',date:'2026-10-29',displayMode:'story',coverId:'',blocks:[{type:'text',text:'A new lab story.'}],...overrides});
const save=(f,id=ID,value=post(),revision=0,action='save')=>f.call(action,{id,revision,post:value});
const upload=(f,kind='image')=>{const bytes=kind==='video'?Buffer.from([0,0,0,20,102,116,121,112,105,115,111,109]):JPEG;return f.call('upload',{kind,base64:bytes.toString('base64'),thumbnail:JPEG.toString('base64')});};

test('setup binds only primary Google account and shares one private state with exact admins without mail',()=>{
  const f=fixture({setup:false});f.identity(PERSONAL);assert.throws(f.setup,/최초 설정/);assert.equal(f.state.files.size,0);
  f.identity(PRIMARY);f.setup();const ids={...f.state.properties};assert.deepEqual(f.state.permissionInvites,[PERSONAL,SCHOOL]);
  const state=json(f.readState());f.setup();assert.equal(f.state.properties.CMS_STATE_ID,ids.CMS_STATE_ID);assert.equal(f.state.properties.CMS_INSTANCE_ID,ids.CMS_INSTANCE_ID);assert.deepEqual(f.readState(),state);
  for(const email of ADMINS){f.identity(email);const result=f.session();assert.equal(result.ok,true);assert.equal(result.value.username,email);}
});
test('setup never reuses or shares preexisting Plie CMS properties from another project',()=>{
  const f=fixture({setup:false});f.state.properties.CMS_FOLDER_ID='existing-plie-folder';f.state.properties.CMS_STATE_ID='existing-plie-state';
  assert.throws(f.setup,/새 연구실 Apps Script/);assert.equal(f.state.properties.CMS_OWNER_EMAIL,undefined);assert.equal(f.state.permissionInvites.length,0);assert.equal(f.state.files.size,0);
});
test('every RPC checks active/effective identity; blank or unapproved caller cannot use owner execution',()=>{
  const f=fixture();
  for(const [active,effective] of [['',PRIMARY],['intruder@example.com',PRIMARY],[PERSONAL,PRIMARY],['intruder@example.com','intruder@example.com']]){
    f.identity(active,effective);for(const action of ['session','posts','upload','publish','site-sync'])assert.equal(f.context.cmsRequest(action,{}).ok,false);
  }
  assert.equal(f.state.refWrites,0);assert.equal(f.state.requests.some(r=>r.url.startsWith('https://api.github.com')),false);
});
test('mutations require per-user CSRF; another admin session and stale versions cannot write',()=>{
  const f=fixture(),primaryToken=f.session().value.csrf;
  assert.equal(f.context.cmsRequest('save',{id:ID,revision:0,post:post()}).ok,false);
  f.identity(PERSONAL);f.session();assert.equal(f.context.cmsRequest('save',{id:ID,revision:0,post:post(),csrf:primaryToken}).ok,false);
  assert.equal(save(f).ok,true);assert.equal(save(f,ID,post({}),0).ok,false);
  assert.equal(save(f,ID,post(),0).ok,false);assert.equal(Object.keys(f.readState().posts).length,1);
  const token=f.session().value.csrf;assert.equal(f.call('logout').ok,true);assert.equal(f.context.cmsRequest('save',{id:OTHER,revision:0,post:post(),csrf:token}).ok,false);
});
test('Drive rejects public, domain/group/unapproved shares and files outside the dedicated folder',()=>{
  for(const extra of [{type:'anyone',role:'reader'},{type:'domain',domain:'khu.ac.kr',role:'writer'},{type:'group',emailAddress:SCHOOL,role:'writer'},{type:'user',emailAddress:'other@example.com',role:'reader'}]){
    const f=fixture();f.state.files.get(f.state.properties.CMS_STATE_ID).permissions.push({id:'foreign',...extra});assert.equal(f.call('posts').ok,false);
  }
  const f=fixture(),file=f.state.files.get(f.state.properties.CMS_STATE_ID);file.public=true;assert.equal(f.call('posts').ok,false);file.public=false;file.parent='outside';assert.equal(f.call('posts').ok,false);
});
test('all admins share posts while lock and immutable collection prevent stale or redirected writes',()=>{
  const f=fixture();assert.equal(save(f).ok,true);f.identity(SCHOOL);assert.equal(f.call('posts').value.posts.length,1);
  assert.equal(save(f,ID,post('notice'),1).ok,false);assert.equal(f.readState().posts[ID].draft.collection,'blog');
  for(const collection of ['member','facility','admin','_config',null])assert.equal(save(f,OTHER,post(collection)).ok,false);
  f.locked(true);assert.equal(save(f,OTHER).ok,false);f.locked(false);assert.equal(f.readState().posts[OTHER],undefined);
});
test('uploads validate strict base64, image/video bytes, limits and private sharing; secondary owns allowed media',()=>{
  const f=fixture();
  for(const payload of [{kind:'image',base64:Buffer.from('<svg/>').toString('base64'),thumbnail:JPEG.toString('base64')},{kind:'image',base64:'$bad',thumbnail:JPEG.toString('base64')},{kind:'video',base64:JPEG.toString('base64'),thumbnail:JPEG.toString('base64')},{kind:'image',base64:JPEG.toString('base64'),thumbnail:Buffer.from('bad').toString('base64')},{kind:'image',base64:Buffer.alloc(3*1024*1024+1).toString('base64'),thumbnail:JPEG.toString('base64')}])assert.equal(f.call('upload',payload).ok,false);
  assert.equal(Object.keys(f.readState().media).length,0);f.identity(PERSONAL);const image=upload(f);assert.equal(image.ok,true);assert.match(image.value.url,/^data:image\/jpeg;base64,/);
  assert.equal(f.state.files.get(f.readState().media[image.value.id].fileId).owner,PERSONAL);f.identity(PRIMARY);assert.equal(f.call('media',{id:image.value.id}).ok,true);
  assert.equal(upload(f,'video').ok,true);
  const large=Buffer.alloc(3*1024*1024);JPEG.copy(large);assert.equal(f.call('upload',{kind:'image',base64:large.toString('base64'),thumbnail:JPEG.toString('base64')}).ok,true,'maximum-size valid upload must not overflow regex stack');
});
test('Blog and Notice serializers neutralize Liquid and escape HTML without double-escaping YAML text',()=>{
  const f=fixture(),image=upload(f).value.id,second=upload(f).value.id,video=upload(f,'video').value.id;
  const value=post('notice',{title:'A & B <title> {{ site.secret }}',excerpt:'Summary & details',displayMode:'gallery',coverId:image,blocks:[{type:'text',text:'<script>alert(1)</script>\n{% include secret %}'},{type:'image',mediaId:image,alt:'Cover & alt',caption:'Cover caption'},{type:'image',mediaId:second,alt:'Second <img>'},{type:'video',mediaId:video,caption:'Video'},{type:'youtube',url:'https://youtu.be/abcdefghijk',caption:'YouTube'}]});
  const clean=f.context.cmsValidate_(f.readState(),value,true),row={id:ID,revision:1,published:clean};const text=f.context.cmsMarkdown_(row,f.readState());
  assert.equal(text.includes('{{'),false);assert.equal(text.includes('{%'),false);assert.equal(text.includes('<script>'),false);
  assert.match(text,/title: "A & B <title> \\u007b/);assert.match(text,/summary: "Summary & details"/);assert.match(text,/&lt;script&gt;/);assert.match(text,/class="article-gallery"/);
  assert.equal(text.split('src="/images/cms/'+image+'.jpg"').length-1,0,'cover is rendered once by public post layout');assert.match(text,/aspect-ratio:16\/9/);assert.match(text,/max-width:100%/);
});
test('publication validation permits optional HTTPS DOI and preserves grouping; rejects scripts, theses or body/video',()=>{
  const f=fixture(),paper=post('publication',{authors:['Author One','Author Two'],publisher:'Journal & Research',link:'https://doi.org/10.0000/test',region:'domestic',publicationStatus:'online ahead of print',blocks:[]});
  assert.equal(save(f,ID,paper,0,'publish').ok,true);const data=JSON.parse(f.read('_data/cms-publications.json'));
  assert.equal(data[0].id,'cms:'+ID);assert.equal(data[0].year,2026);assert.equal(data[0].kind,'paper');assert.equal(data[0].region,'domestic');assert.equal(data[0].status,'online ahead of print');assert.deepEqual(data[0].authors,paper.authors);
  assert.equal(save(f,OTHER,{...paper,link:''},0).ok,true);
  for(const changes of [{link:'javascript:alert(1)'},{link:'http://doi.org/test'},{link:'https://user:pass@example.com/test'},{link:'https://doi.org/\\bad'},{kind:'thesis'},{authors:[]},{region:'other'},{publicationStatus:'rejected'},{blocks:[{type:'text',text:'not a structured paper'}]}])assert.equal(save(f,'c'.repeat(32),{...paper,...changes},0,'publish').ok,false,JSON.stringify(changes));
});
test('atomic publication owns only new CMS paths and preserves original Blog, Notice, members, citations and unrelated edits',()=>{
  const f=fixture(),before=f.tree(),image=upload(f).value.id;
  assert.equal(save(f,ID,post('blog',{coverId:image,blocks:[{type:'text',text:'Story'},{type:'image',mediaId:image}]}),0,'publish').ok,true);
  assert.equal(save(f,OTHER,post('notice'),0,'publish').ok,true);
  const after=f.tree();for(const [path,hash] of Object.entries(before))assert.equal(after[path],hash,path);
  assert.ok(after['_blog/cms-'+ID+'.md']);assert.ok(after['_notice/cms-'+OTHER+'.md']);assert.ok(after['images/cms/'+image+'.jpg']);
  const manifest=JSON.parse(f.read('content/cms-manifest.json'));assert.equal(manifest.version,2);assert.equal(manifest.ownerEmail,PRIMARY);
  for(const [path,hash]of Object.entries(manifest.files)){assert.equal(f.context.cmsOwned_(path),true);assert.equal(after[path],hash);}
  for(const request of f.state.requests.filter(r=>r.body?.tree&&Array.isArray(r.body.tree)))for(const update of request.body.tree)assert.ok(f.context.cmsOwned_(update.path)||update.path==='content/cms-manifest.json',update.path);
  const count=f.state.refWrites;assert.equal(f.call('site-sync').ok,true);assert.equal(f.state.refWrites,count,'same snapshot must not create another commit');
});
test('malicious or foreign manifests, unknown CMS files and remote SHA changes cannot overwrite or delete files',()=>{
  for(const mode of ['path','owner','unknown','modified','deleted']){
    const f=fixture();save(f,ID,post(),0,'publish');
    const manifest=JSON.parse(f.read('content/cms-manifest.json')),path='_blog/cms-'+ID+'.md';
    if(mode==='path'){manifest.files['_members/original.md']=f.tree()['_members/original.md'];f.seed('content/cms-manifest.json',JSON.stringify(manifest));}
    if(mode==='owner'){manifest.ownerEmail='other@example.com';f.seed('content/cms-manifest.json',JSON.stringify(manifest));}
    if(mode==='unknown')f.seed('_blog/cms-'+OTHER+'.md','Untracked CMS file');
    if(mode==='modified')f.seed(path,'Externally changed post');
    if(mode==='deleted'){const tree=f.state.trees.get(f.state.commits.get(f.state.head).tree.sha);delete tree[path];}
    const before=f.tree(),writes=f.state.refWrites;f.call('unpublish',{id:ID,revision:1});assert.deepEqual(f.tree(),before,mode);assert.equal(f.state.refWrites,writes);assert.equal(f.call('site-status').value.phase,'error');
  }
});
test('concurrent unrelated commits survive a non-force retry',()=>{
  const f=fixture();f.state.flags.concurrentRef=true;save(f,ID,post(),0,'publish');assert.equal(f.read('unrelated.txt'),'Concurrent unrelated file');assert.ok(f.read('_blog/cms-'+ID+'.md'));assert.equal(f.state.refWrites,1);
});
test('unknown push results retain prepared commit and recover without duplicate commits or deleting originals',()=>{
  for(const flag of ['failRefBefore','failRefAfter']){
    const f=fixture(),before=f.tree();f.state.flags[flag]=true;save(f,ID,post(),0,'publish');assert.equal(f.readState().publication.phase,'uncertain');assert.ok(f.readState().publication.pending);
    f.call('site-sync');assert.equal(f.readState().publication.phase,'building');assert.equal(f.state.refWrites,1);
    for(const [path,hash]of Object.entries(before))assert.equal(f.tree()[path],hash);const count=f.state.commits.size;f.call('site-sync');assert.equal(f.state.commits.size,count);
  }
});
test('unpublish removes only manifest-owned CMS files and public deployment requires live release confirmation',()=>{
  const f=fixture(),before=f.tree();save(f,ID,post(),0,'publish');assert.equal(f.call('site-status').value.phase,'building');
  f.state.liveRelease=f.readState().publication.release;assert.equal(f.call('site-status').value.phase,'live');
  assert.equal(f.call('unpublish',{id:ID,revision:1}).ok,true);assert.equal(f.read('_blog/cms-'+ID+'.md'),undefined);for(const [path,hash]of Object.entries(before))assert.equal(f.tree()[path],hash);
  assert.equal(f.readState().posts[ID].published,null);
});
test('client responses never contain GitHub/OAuth tokens or internal pending commit metadata',()=>{
  const f=fixture();f.state.flags.failRefBefore=true;save(f,ID,post(),0,'publish');const results=[f.session(),f.call('posts'),f.call('post',{id:ID}),f.call('site-status')];
  for(const result of results){const value=JSON.stringify(result);assert.equal(value.includes('github-server-token'),false);assert.equal(value.includes('google-oauth-token'),false);assert.equal(value.includes('"pending"'),false);}
});

module.exports={fixture,post,JPEG,ID,OTHER};
