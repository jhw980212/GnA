"""Exercise the CMS demo in a real browser without using external services."""

from __future__ import annotations

import io
import json
import os
from pathlib import Path
import random
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / ".preview" / "deps"))

from PIL import Image
from playwright.sync_api import expect, sync_playwright

BASE = os.environ.get("CMS_TEST_URL", "http://127.0.0.1:4177")
CHROMIUM = Path(
    "C:/Users/jhw98/AppData/Local/ms-playwright/"
    "chromium_headless_shell-1228/chrome-headless-shell-win64/"
    "chrome-headless-shell.exe"
)


def sample_png() -> bytes:
    """A valid deterministic image of approximately 5 KB for the upload flow."""
    pixels = random.Random(731).randbytes(40 * 40 * 3)
    stream = io.BytesIO()
    Image.frombytes("RGB", (40, 40), pixels).save(stream, format="PNG")
    return stream.getvalue()


def assert_no_overflow(page) -> None:
    assert not page.evaluate(
        "document.documentElement.scrollWidth > window.innerWidth + 1"
    ), "The CMS overflows the viewport horizontally."


def assert_readonly(locator) -> None:
    assert locator.is_disabled() or locator.get_attribute("readonly") is not None


def switch_role(page, role: str) -> None:
    page.locator("#demo-role").select_option(role)
    expect(page.locator("#list-view")).to_be_visible()
    expect(page.locator("#profile-role")).to_have_text(
        re.compile("관리자" if role == "admin" else "구성원")
    )


def open_entry(page, title: str) -> None:
    page.get_by_role("searchbox", name=re.compile("글 검색")).fill(title)
    page.locator("#entries").get_by_text(title, exact=True).click()
    expect(page.locator("#editor-view")).to_be_visible()


def confirm_dialog(page) -> None:
    dialog = page.get_by_role("dialog")
    expect(dialog).to_be_visible()
    dialog.locator("button[type=submit]").click()
    expect(dialog).to_be_hidden()


def exercise_demo(page) -> None:
    response = page.goto(BASE + "/admin/", wait_until="networkidle")
    assert response and response.status == 200
    expect(page.locator("#connection-note")).to_be_visible()
    expect(page.locator("#connection-note")).to_contain_text(re.compile("설정|연결"))
    expect(page.get_by_role("button", name="로그인", exact=True)).to_be_disabled()
    expect(page.locator("#workspace")).to_be_hidden()
    expect(page.locator("#demo-banner")).to_be_hidden()
    page.set_viewport_size({"width": 390, "height": 844})
    assert_no_overflow(page)

    page.get_by_role("button", name=re.compile("화면 체험하기")).click()
    expect(page.locator("#workspace")).to_be_visible()
    expect(page.locator("#demo-banner")).to_contain_text("실제 홈페이지에 반영되지 않습니다")
    expect(page.locator("#admin-tools")).to_be_hidden()
    assert_blog_only_controls(page)
    assert_no_overflow(page)
    page.set_viewport_size({"width": 1440, "height": 1000})

    page.get_by_role("button", name=re.compile("새 글 작성")).click()
    expect(page.locator("#editor-view")).to_be_visible()
    page.get_by_role("button", name="임시 저장", exact=True).click()
    assert page.locator("#entry-title").evaluate("field => !field.validity.valid")

    title = '<img src=x onerror="window.__cmsXss = 1"> Browser review test'
    body = '<script>window.__cmsXss = 2</script>\n\n## Browser test\n\n연구실 활동 기록입니다.'
    feedback = "일정을 구체적으로 적고 다시 제출해 주세요."
    title_field = page.get_by_label(re.compile("^제목"))
    title_field.focus()
    page.keyboard.insert_text(title)
    page.get_by_label("짧은 소개", exact=True).fill("Browser workflow verification")
    page.get_by_label("본문", exact=True).fill(body)
    page.get_by_role("tab", name="미리보기", exact=True).click()
    expect(page.locator("#preview-panel")).to_contain_text("<script>")
    assert page.locator("#preview-panel script").count() == 0
    assert page.locator("img[onerror]").count() == 0
    assert page.evaluate("window.__cmsXss === undefined")
    page.get_by_role("tab", name="작성", exact=True).click()
    page.get_by_role("button", name="임시 저장", exact=True).click()
    expect(page.locator("#save-state")).to_contain_text(re.compile("저장"))

    image_bytes = sample_png()
    assert 4500 <= len(image_bytes) <= 5500
    page.locator("#photo-upload").set_input_files(
        {"name": "browser-sample.png", "mimeType": "image/png", "buffer": image_bytes}
    )
    expect(page.locator("#photo-list img")).to_have_count(1)
    page.locator("#photo-list img").evaluate("image => image.decode()")
    assert page.locator("#photo-list img").get_attribute("src").startswith("data:image/png")
    page.locator("#photo-0-caption").fill("First Blog photo")
    page.locator("#photo-0-alt").fill("First laboratory picture")
    page.locator("#photo-upload").set_input_files(
        {"name": "browser-gallery.png", "mimeType": "image/png", "buffer": image_bytes}
    )
    expect(page.locator("#photo-list img")).to_have_count(2)
    page.locator("#photo-1-caption").fill("Second Blog photo")
    page.locator("#photo-1-alt").fill("Second laboratory picture")
    page.get_by_role("button", name="2번 사진 위로 이동", exact=True).click()
    expect(page.locator("#photo-0-caption")).to_have_value("Second Blog photo")
    expect(page.locator("#photo-1-caption")).to_have_value("First Blog photo")
    page.get_by_role("button", name="검토 요청", exact=True).click()
    if page.get_by_role("dialog").is_visible():
        confirm_dialog(page)
    expect(page.locator("#editor-status")).to_contain_text(re.compile("검토|제출"))
    assert_readonly(title_field)
    assert_readonly(page.get_by_label("본문", exact=True))
    expect(page.get_by_role("button", name="승인하고 반영", exact=True)).to_be_hidden()
    expect(page.locator("#photo-upload")).to_be_disabled()

    switch_role(page, "admin")
    expect(page.locator("#admin-tools")).to_be_visible()
    open_entry(page, title)
    expect(page.get_by_role("button", name="승인하고 반영", exact=True)).to_be_visible()
    page.get_by_role("button", name="수정 요청", exact=True).click()
    dialog = page.get_by_role("dialog")
    expect(dialog).to_be_visible()
    dialog.get_by_role("textbox").fill(feedback)
    dialog.get_by_role("textbox").focus()
    page.keyboard.press("Tab")
    assert page.evaluate("document.activeElement.closest('dialog') !== null")
    confirm_dialog(page)
    expect(page.locator("#entry-note")).to_contain_text(feedback)
    expect(page.locator("#editor-status")).to_contain_text("수정")

    switch_role(page, "editor")
    open_entry(page, title)
    expect(page.locator("#entry-note")).to_contain_text(feedback)
    expect(page.get_by_label("본문", exact=True)).to_be_editable()
    revised_body = body + "\n\n일정: 2026년 10월 3일 오후 2시."
    page.get_by_label("본문", exact=True).fill(revised_body)
    page.get_by_role("button", name="검토 요청", exact=True).click()
    if page.get_by_role("dialog").is_visible():
        confirm_dialog(page)
    expect(page.locator("#editor-status")).to_contain_text(re.compile("검토|제출"))
    assert_readonly(page.get_by_label("본문", exact=True))

    switch_role(page, "admin")
    open_entry(page, title)
    expect(page.get_by_label("본문", exact=True)).to_have_value(revised_body)
    page.get_by_role("button", name="승인하고 반영", exact=True).click()
    expect(page.get_by_role("dialog")).to_be_visible()
    page.keyboard.press("Escape")
    expect(page.get_by_role("dialog")).to_be_hidden()
    expect(page.locator("#editor-status")).to_contain_text(re.compile("검토|제출"))
    page.get_by_role("button", name="승인하고 반영", exact=True).click()
    confirm_dialog(page)
    expect(page.locator("#editor-status")).to_contain_text(re.compile("반영|체험"))
    expect(page.locator("#commit-link")).to_be_hidden()
    expect(page.locator("#demo-banner")).to_contain_text("실제 홈페이지에 반영되지 않습니다")
    expect(page.get_by_role("button", name="승인하고 반영", exact=True)).to_be_hidden()
    assert_readonly(page.get_by_label(re.compile("^제목")))
    expect(page.locator("#photo-list img")).to_have_count(2)
    expect(page.locator("#photo-0-caption")).to_have_value("Second Blog photo")
    expect(page.locator("#photo-0-alt")).to_have_value("Second laboratory picture")
    expect(page.locator("#photo-0-caption")).to_be_disabled()
    assert page.locator("img[onerror]").count() == 0
    assert page.evaluate("window.__cmsXss === undefined")
    page.set_viewport_size({"width": 390, "height": 844})
    assert_no_overflow(page)
    page.get_by_role("tab", name="미리보기", exact=True).click()
    expect(page.locator("#preview-panel")).to_contain_text("<script>")
    assert_no_overflow(page)
    page.screenshot(path=str(ROOT / ".preview" / "cms-mobile-review.png"), full_page=True)

    switch_role(page, "editor")
    expect(page.locator("#entries")).to_contain_text(title)
    assert_no_overflow(page)
    page.reload(wait_until="networkidle")
    expect(page.locator("#workspace")).to_be_visible()
    expect(page.locator("#entries")).to_contain_text(title)
    open_entry(page, title)
    assert_readonly(page.get_by_label(re.compile("^제목")))
    assert_no_overflow(page)
    print("PASS: explicit disconnected landing; local demo; author save/image/submit; reviewer feedback; revise/resubmit; approval; readonly states; escaped HTML; mobile and keyboard dialog; persisted demo; no external services.")


def exercise_plain_id_login(browser) -> None:
    """Mock Auth and API separately so an ID alias cannot grant a role."""
    auth_origin = "https://cms-browser-test.supabase.co"
    member_email = "member@example.test"
    admin_email = "owner@example.test"
    accounts = {"member": member_email, "admin": admin_email}
    profiles = {
        "fixture-editor-token": {
            "id": "fixture-member", "email": member_email,
            "display_name": "Fixture member", "role": "editor",
        },
        "fixture-admin-token": {
            "id": "fixture-owner", "email": admin_email,
            "display_name": "Fixture owner", "role": "admin",
        },
    }
    for identifier, aliases, expected_role, expected_email in [
        ("member", accounts, "editor", member_email),
        ("admin", accounts, "admin", admin_email),
        ("admin", {**accounts, "admin": member_email}, "editor", member_email),
    ]:
        context = browser.new_context(viewport={"width": 1440, "height": 1000})
        context.set_default_timeout(8000)
        errors: list[str] = []
        unexpected_requests: list[str] = []
        credentials: list[dict] = []
        saves: list[dict] = []
        config = {
            "supabaseUrl": auth_origin,
            "publishableKey": "sb_publishable_browser_fixture",
            "functionName": "cms-api",
            "loginAccounts": aliases,
        }

        def request(route) -> None:
            url = route.request.url
            if url == BASE + "/admin/config.js":
                route.fulfill(
                    status=200, content_type="application/javascript",
                    body="window.CMS_CONFIG = " + json.dumps(config) + ";",
                )
            elif url.startswith(BASE + "/"):
                route.continue_()
            elif url == auth_origin + "/auth/v1/token?grant_type=password":
                supplied = route.request.post_data_json
                credentials.append(supplied)
                assert supplied["password"] == "fixture-auth-password"
                assert supplied["email"] in [member_email, admin_email]
                token = "fixture-admin-token" if supplied["email"] == admin_email else "fixture-editor-token"
                route.fulfill(
                    status=200, content_type="application/json",
                    body=json.dumps({
                        "access_token": token, "refresh_token": "fixture-refresh",
                        "expires_in": 3600, "user": {"id": profiles[token]["id"]},
                    }),
                )
            elif url == auth_origin + "/functions/v1/cms-api":
                token = route.request.headers["authorization"].removeprefix("Bearer ")
                supplied = route.request.post_data_json
                if supplied["action"] == "list":
                    rows = [{"id": "allowed-blog", "collection": "blog", "title": "Allowed Blog API row",
                             "author_id": profiles[token]["id"], "status": "draft", "version": 1}]
                    rows += [{"id": "forbidden-" + kind, "collection": kind, "title": "Forbidden API " + kind,
                              "author_id": profiles[token]["id"], "status": "draft", "version": 1}
                             for kind in ("notice", "member", "facility", "publication")]
                    response = {"entries": rows, "profile": profiles[token]}
                elif supplied["action"] == "save":
                    entry = supplied["payload"]["entry"]
                    assert entry["collection"] == "blog", entry
                    assert "details" not in entry and "source_path" not in entry
                    saves.append(entry)
                    response = {"entry": {**entry, "id": "fixture-blog", "author_id": profiles[token]["id"],
                                          "assets": [], "version": 1, "status": "draft"}}
                else:
                    raise AssertionError(supplied)
                route.fulfill(
                    status=200, content_type="application/json",
                    body=json.dumps(response),
                )
            else:
                unexpected_requests.append(url)
                route.abort()

        context.route("**/*", request)
        page = context.new_page()
        page.on("pageerror", lambda error: errors.append(str(error)))
        try:
            page.goto(BASE + "/admin/", wait_until="networkidle")
            expect(page.locator("#login-button")).to_be_enabled()
            assert page.locator("#login-email").get_attribute("type") == "text"
            page.locator("#login-email").fill(identifier)
            page.locator("#login-password").fill("fixture-auth-password")
            assert page.locator("#login-form").evaluate("form => form.checkValidity()")
            page.locator("#login-button").click()
            expect(page.locator("#workspace")).to_be_visible()
            expect(page.locator("#auth-view")).to_be_hidden()
            expect(page.locator("#demo-banner")).to_be_hidden()
            expect(page.locator("#profile-role")).to_have_text(
                "관리자" if expected_role == "admin" else "구성원"
            )
            if expected_role == "admin":
                expect(page.locator("#admin-tools")).to_be_visible()
            else:
                expect(page.locator("#admin-tools")).to_be_hidden()
            assert_blog_only_controls(page)
            expect(page.locator("#entries .entry-card")).to_have_count(1)
            assert "Forbidden API" not in page.locator("#entries").inner_text()
            page.locator("#new-entry").click()
            page.locator("#entry-title").fill("Forged form remains Blog")
            page.locator("#entry-body").fill("Only the Blog fields are sent.")
            page.evaluate("""() => {
                const field = document.createElement('input');
                field.type='hidden'; field.id='entry-collection'; field.name='collection'; field.value='notice';
                document.querySelector('#entry-form').append(field);
            }""")
            page.locator("#save-button").click()
            expect(page.locator("#save-state")).to_contain_text("저장")
            assert len(saves) == 1 and saves[0]["collection"] == "blog", saves
            assert credentials == [{"email": expected_email, "password": "fixture-auth-password"}]
            assert not errors, errors
            assert not unexpected_requests, unexpected_requests
        finally:
            context.close()
    print("PASS: member and admin ID login; alias edits cannot change backend-authorized role; isolated Auth/API fixtures only.")



def assert_blog_only_controls(page) -> None:
    for identifier in ("entry-collection", "collection-filter", "catalog-filter",
                       "member-fields", "facility-fields", "publication-fields",
                       "visibility-fields", "invite-button"):
        expect(page.locator("#" + identifier)).to_have_count(0)
    for collection in ("notice", "member", "facility", "publication"):
        expect(page.locator(f'option[value="{collection}"]')).to_have_count(0)


def exercise_blog_catalog(page) -> None:
    page.set_viewport_size({"width": 1440, "height": 1000})
    switch_role(page, "admin")
    assert_blog_only_controls(page)
    page.locator("#new-entry").click()
    page.locator("#entry-title").fill("Owner Blog story")
    page.locator("#entry-body").fill("An owner's Blog story can use the same review flow.")
    page.locator("#save-button").click()
    expect(page.locator("#save-state")).to_contain_text("저장")
    page.locator("#submit-button").click()
    if page.get_by_role("dialog").is_visible():
        confirm_dialog(page)
    expect(page.locator("#approve-button")).to_be_visible()
    page.locator("#approve-button").click()
    confirm_dialog(page)
    expect(page.locator("#entry-note")).to_contain_text("실제 GitHub 커밋이나 홈페이지 반영은 이루어지지 않았습니다")
    originals = json.loads((ROOT / "admin/demo-data.json").read_text(encoding="utf-8"))["files"]
    assert originals and all(row["collection"] == "blog" and row["path"].startswith("_blog/") for row in originals)
    page.locator("#catalog-button").click()
    expect(page.locator("#catalog-list .catalog-row")).to_have_count(len(originals) + 2)
    assert_blog_only_controls(page)
    original = next(row for row in originals if row.get("image"))
    page.locator("#catalog-search").fill(original["title"])
    row = page.locator("#catalog-list .catalog-row").filter(has_text=original["title"]).filter(has_text=original["date"])
    expect(row).to_have_count(1)
    row.get_by_role("button", name="가져와서 수정", exact=True).click()
    expect(page.locator("#entry-title")).to_have_value(original["title"])
    expect(page.locator("#photo-list img")).to_have_count(1)
    image = page.locator("#photo-list img")
    image.scroll_into_view_if_needed()
    expect(image).to_have_js_property("complete", True)
    image.evaluate("image => image.decode()")
    old_url = image.get_attribute("src")
    page.locator("#entry-body").fill("A text-only edit retains the original Blog photo.")
    page.locator("#save-button").click()
    expect(page.locator("#save-state")).to_contain_text("저장")
    expect(page.locator("#photo-list img")).to_have_attribute("src", old_url)
    page.set_viewport_size({"width": 390, "height": 844})
    assert_no_overflow(page)
    page.evaluate("document.activeElement.blur(); window.scrollTo(0, 0)")
    assert page.locator(".skip-link").evaluate("link => link.getBoundingClientRect().bottom < 0")
    page.screenshot(path=str(ROOT / ".preview/cms-blog-mobile.png"), full_page=True)
    page.reload(wait_until="networkidle")
    switch_role(page, "admin")
    open_entry(page, original["title"])
    expect(page.locator("#entry-body")).to_have_value("A text-only edit retains the original Blog photo.")
    expect(page.locator("#photo-list img")).to_have_attribute("src", old_url)
    assert_blog_only_controls(page)
    assert_no_overflow(page)
    print("PASS: Blog-only owner/editor menus; owner write/submit/approve; original Blog-only catalog/import/photo URL; mobile and persistence.")


def exercise_legacy_demo_cache(browser) -> None:
    """Old local records remain stored but cannot appear or be mutated."""
    legacy_types = ("notice", "member", "facility", "publication")
    legacy_entries = [{
        "id": "legacy-" + kind, "author_id": "demo-editor", "collection": kind,
        "title": "Forbidden legacy " + kind, "date": "2026-01-01", "body": "Kept original",
        "description": "", "assets": [], "status": "submitted", "version": 1,
    } for kind in legacy_types]
    blog = {**legacy_entries[0], "id": "legacy-blog", "collection": "blog",
            "title": "Allowed legacy Blog", "status": "draft"}
    legacy_entries.append({**blog, "id": "legacy-spoofed-blog", "source_path": "_members/spoof.md",
                           "title": "Forbidden legacy spoofed Blog"})
    catalog = [{"path": "_blog/legacy-blog.md", "collection": "blog", "title": blog["title"],
                "date": blog["date"], "body": blog["body"], "image": "", "frontmatter": {}}]
    catalog += [{"path": "_notice/legacy.md" if kind == "notice" else
                         "_members/legacy.md" if kind == "member" else
                         "_data/facility.yaml" if kind == "facility" else "_data/citations.yaml",
                 "source_key": "0", "collection": kind, "title": "Forbidden legacy " + kind}
                for kind in legacy_types]
    catalog.append({"path": "_members/spoof.md", "collection": "blog", "title": "Forbidden legacy spoofed Blog"})
    for key, schema in (("galab-cms-demo-v1", 1), ("galab-cms-demo-v2", 2)):
        context = browser.new_context(viewport={"width": 390, "height": 844})
        context.set_default_timeout(8000)
        state = {"schema": schema, "entries": [blog, *legacy_entries], "catalog": catalog}
        context.add_init_script(
            "localStorage.setItem(" + json.dumps(key) + "," + json.dumps(json.dumps(state)) + ");"
        )
        context.route("**/*", lambda route: route.fulfill(
            status=200, content_type="application/javascript",
            body='window.CMS_CONFIG = {supabaseUrl:"",publishableKey:"",functionName:"cms-api"};'
        ) if route.request.url == BASE + "/admin/config.js" else route.continue_()
            if route.request.url.startswith(BASE + "/") else route.abort())
        page = context.new_page()
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        try:
            page.goto(BASE + "/admin/?demo=1", wait_until="networkidle")
            expect(page.locator("#workspace")).to_be_visible()
            expect(page.locator("#entries .entry-card")).to_have_count(1)
            expect(page.locator("#entries")).to_contain_text("Allowed legacy Blog")
            assert "Forbidden legacy" not in page.locator("#workspace").inner_text()
            assert_blog_only_controls(page)
            switch_role(page, "admin")
            expect(page.locator("#entries .entry-card")).to_have_count(1)
            page.locator("#catalog-button").click()
            expect(page.locator("#catalog-list .catalog-row")).to_have_count(1)
            assert "Forbidden legacy" not in page.locator("#catalog-list").inner_text()
            result = page.evaluate("""async ({legacyEntries, catalog}) => {
                const {createDemoClient} = await import('./demo.js');
                const client = createDemoClient();
                const failures = [];
                for (const role of ['editor','admin']) {
                    await client.setRole(role);
                    const visible = await client.request('list');
                    if (visible.entries.some(row => row.collection !== 'blog')) failures.push(role+':list');
                    for (const entry of legacyEntries) {
                        const source = catalog.find(row => row.collection === entry.collection && (!entry.source_path || row.path === entry.source_path));
                        const attempts = [
                            ['save',{entry:{...entry,collection:'blog',title:'Forged conversion'},version:1}],
                            ['save',{entry:{...entry},version:1}],
                            ['assets',{id:entry.id}],
                            ['upload',{id:entry.id,version:1,mime:'image/png',base64:'AAAA',name:'fake.png'}],
                            ['submit',{id:entry.id,version:1}],
                            ['reject',{id:entry.id,version:1,feedback:'forged'}],
                            ['approve',{id:entry.id,version:1}],
                            ['import',{path:source.path,source_key:source.source_key}],
                            ['import',{path:source.path,source_key:source.source_key,refresh:true,id:entry.id,version:1}],
                            ['import',{path:'_blog/legacy-blog.md',refresh:true,id:entry.id,version:1}],
                        ];
                        if (entry.collection !== 'blog') attempts.push(['save',{entry:{collection:entry.collection,title:'Forged new',date:'2026-01-01',body:'',assets:[]}}]);
                        for (const [action,payload] of attempts) {
                            try {await client.request(action,payload); failures.push(role+':'+entry.collection+':'+action);}
                            catch {}
                        }
                    }
                }
                const persisted = JSON.parse(localStorage.getItem('galab-cms-demo-v2'));
                return {failures,legacy:persisted.entries.filter(row => row.id !== 'legacy-blog')};
            }""", {"legacyEntries": legacy_entries, "catalog": catalog})
            assert result["failures"] == [], result["failures"]
            assert result["legacy"] == legacy_entries, "Legacy records were silently rewritten or deleted."
            assert not errors, errors
            assert_no_overflow(page)
        finally:
            context.close()
    print("PASS: v1/v2 cached non-Blog records filtered and preserved; both roles denied legacy and forged demo requests.")


def exercise_auth_failure(browser) -> None:
    """Wrong credentials or an unauthorized profile never enable demo/admin."""
    origin = "https://cms-browser-test.supabase.co"
    for mode in ("wrong-password", "unauthorized-profile"):
        context = browser.new_context()
        context.set_default_timeout(8000)
        unexpected = []
        def request(route):
            url = route.request.url
            if url == BASE + "/admin/config.js":
                route.fulfill(status=200, content_type="application/javascript", body="window.CMS_CONFIG=" + json.dumps({
                    "supabaseUrl": origin, "publishableKey": "sb_publishable_browser_failure_fixture",
                    "functionName": "cms-api", "loginAccounts": {"admin": "admin@example.test"},
                }) + ";")
            elif url.startswith(BASE + "/"):
                route.continue_()
            elif url == origin + "/auth/v1/token?grant_type=password":
                route.fulfill(status=401 if mode == "wrong-password" else 200,
                    content_type="application/json", body=json.dumps(
                        {"message":"Invalid credentials"} if mode == "wrong-password" else {
                            "access_token":"fixture-token", "refresh_token":"fixture-refresh",
                            "expires_in":3600,"user":{"id":"fixture-no-profile"}}))
            elif url == origin + "/functions/v1/cms-api" and mode == "unauthorized-profile":
                route.fulfill(status=403, content_type="application/json",
                              body=json.dumps({"error":"not_allowed","message":"Unauthorized CMS profile"}))
            else:
                unexpected.append(url); route.abort()
        context.route("**/*", request)
        page = context.new_page()
        try:
            page.goto(BASE + "/admin/", wait_until="networkidle")
            page.locator("#login-email").fill("admin")
            page.locator("#login-password").fill("wrong-fixture-password")
            page.locator("#login-button").click()
            expect(page.locator("#auth-feedback")).not_to_be_empty()
            expect(page.locator("#workspace")).to_be_hidden()
            expect(page.locator("#demo-banner")).to_be_hidden()
            expect(page.locator("#auth-view")).to_be_visible()
            assert not unexpected, unexpected
        finally:
            context.close()
    print("PASS: rejected credentials/profile never fall back to demo or grant an admin workspace.")


def main() -> None:
    browser_errors: list[str] = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            executable_path=str(CHROMIUM), headless=True
        )
        context = browser.new_context(viewport={"width": 1440, "height": 1000})
        context.set_default_timeout(8000)
        external_requests: list[str] = []

        def isolated_request(route) -> None:
            if route.request.url == BASE + "/admin/config.js":
                route.fulfill(
                    status=200,
                    content_type="application/javascript",
                    body='window.CMS_CONFIG = Object.freeze({supabaseUrl:"",publishableKey:"",functionName:"cms-api"});',
                )
            elif route.request.url.startswith(BASE + "/"):
                route.continue_()
            else:
                external_requests.append(route.request.url)
                route.abort()

        context.route(
            "**/*",
            isolated_request,
        )
        page = context.new_page()
        page.on("pageerror", lambda error: browser_errors.append(str(error)))
        try:
            exercise_demo(page)
            exercise_blog_catalog(page)
            exercise_legacy_demo_cache(browser)
            assert not browser_errors, browser_errors
            assert not external_requests, external_requests
            exercise_plain_id_login(browser)
            exercise_auth_failure(browser)
        finally:
            context.close()
            browser.close()


if __name__ == "__main__":
    main()
