"""Check actual Blog CMS serializers with Jekyll without changing real content."""
from __future__ import annotations
from functools import partial
import hashlib
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys
import threading
from urllib.parse import unquote

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / ".preview/deps"))
import yaml
from PIL import Image
from playwright.sync_api import expect, sync_playwright

WORK = ROOT / ".preview/cms-blog-test"
BASELINE, SOURCE = WORK / "baseline", WORK / "source"
BASELINE_OUTPUT, OUTPUT = WORK / "baseline-output", WORK / "output"
NODE = ROOT / ".preview/deps/playwright/driver/node.exe"
CHROMIUM = Path("C:/Users/jhw98/AppData/Local/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-win64/chrome-headless-shell.exe")
WEB_FOLDERS = ("_includes", "_layouts", "_styles", "_scripts", "_members", "_blog", "_notice", "_data", "about", "blog", "projects", "research", "team", "images")


def content_hashes(base: Path = ROOT) -> dict[str, str]:
    paths = [p for folder in ("_members", "_blog", "_notice") for p in (base / folder).rglob("*.md")]
    paths += [base / "_data" / name for name in ("facility.yaml", "citations.yaml")]
    return {p.relative_to(base).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}


def document(path: Path) -> tuple[dict, str]:
    parts = path.read_text(encoding="utf-8-sig").split("---", 2)
    return yaml.safe_load(parts[1]), parts[2].strip()


def fixture_input() -> dict:
    entry_id = "fe960000-0000-4000-8000-000000000001"
    author_id = "fe960000-0000-4000-8000-000000000999"
    uploaded = {
        "id": entry_id, "version": 3, "author_id": author_id, "collection": "blog",
        "title": "CMS Blog & Photo Regression", "date": "2026-10-05",
        "body": "## Approved journal story\n\n**Approved Blog body** with photos.\n\n- One activity\n- Another activity",
        "description": "Approved Blog summary & laboratory moments.",
        "image_alt": "Blog cover & people", "image_caption": "Cover moment & people",
        "frontmatter": {}, "source_path": "_blog/cms-blog-regression.md",
        "assets": [
            {"path": f"{author_id}/{entry_id}/cover.png", "mime": "image/png", "alt": "Cover photo", "caption": "Original cover caption"},
            {"path": f"{author_id}/{entry_id}/detail.png", "mime": "image/png", "alt": "Detail photo", "caption": "Detail & instruments"},
            {"path": f"{author_id}/{entry_id}/group.png", "mime": "image/png", "alt": "Group photo", "caption": "The group photo"},
        ],
    }
    original_path = next(p for p in sorted((ROOT / "_blog").glob("*.md")) if document(p)[0].get("image"))
    original, _body = document(original_path)
    preserved = {
        "id": "fe960000-0000-4000-8000-000000000002", "version": 4,
        "author_id": author_id, "collection": "blog", "title": original["title"],
        "date": str(original["date"]), "frontmatter": original, "assets": [],
        "body": "## Updated journal story\n\n**Preserved original Blog photo** after a text edit.",
        "description": "A text edit keeps the original Blog picture URL.",
        "image_alt": "", "image_caption": "", "source_path": original_path.relative_to(ROOT).as_posix(),
    }
    return {"uploaded": uploaded, "preserved": preserved}


def prepare_fixture() -> None:
    # A separate directory prevents old typed CMS fixtures from leaking in.
    for destination in (BASELINE, SOURCE):
        destination.mkdir(parents=True, exist_ok=True)
        for folder in WEB_FOLDERS:
            shutil.copytree(ROOT / folder, destination / folder, dirs_exist_ok=True)
        for name in ("_config.yaml", "index.md", "notice.md", "404.md"):
            shutil.copyfile(ROOT / name, destination / name)
        config = yaml.safe_load((destination / "_config.yaml").read_text(encoding="utf-8"))
        config["maintenance"] = False
        (destination / "_config.yaml").write_text(yaml.safe_dump(config, allow_unicode=True), encoding="utf-8")
    data = fixture_input()
    for index, asset in enumerate(data["uploaded"]["assets"]):
        picture = SOURCE / "images/cms" / data["uploaded"]["id"] / asset["path"].split("/")[-1]
        picture.parent.mkdir(parents=True, exist_ok=True)
        Image.new("RGB", (48, 48), (50 + index * 50, 108, 79)).save(picture, format="PNG")
    input_path = WORK / "input.json"
    input_path.write_text(json.dumps(data, ensure_ascii=False, default=str), encoding="utf-8")
    bridge = """
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const root = process.argv[1], source = process.argv[2];
const input = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
const { renderEntryMarkdown } = await import(pathToFileURL(path.join(root, 'supabase/functions/cms-api/handler.js')));
for (const entry of Object.values(input)) fs.writeFileSync(path.join(source, entry.source_path), renderEntryMarkdown(entry), 'utf8');
console.log('Prepared actual Blog CMS serializer output.');
"""
    subprocess.run([str(NODE), "--input-type=module", "-e", bridge, str(ROOT), str(SOURCE), str(input_path)], cwd=ROOT, check=True)
    original, copied = content_hashes(), content_hashes(SOURCE)
    allowed = {data["uploaded"]["source_path"], data["preserved"]["source_path"]}
    assert {k: v for k, v in copied.items() if k not in allowed} == {k: v for k, v in original.items() if k not in allowed}, "Non-Blog content changed."
    assert content_hashes(BASELINE) == original, "Baseline differs from original content."
    script = """set -e
cd /mnt/d/홈페이지
export RUBY_ROOT=/var/tmp/galab-preview/ruby/x64
export LD_LIBRARY_PATH="$RUBY_ROOT/lib:$LD_LIBRARY_PATH"
export RUBYLIB="$RUBY_ROOT/lib/ruby/3.2.0:$RUBY_ROOT/lib/ruby/3.2.0/x86_64-linux"
export GEM_HOME=/var/tmp/galab-gems-20260927
export GEM_PATH="$GEM_HOME:$RUBY_ROOT/lib/ruby/gems/3.2.0"
export PATH="$RUBY_ROOT/bin:$GEM_HOME/bin:$PATH"
export LANG=C.UTF-8 LC_ALL=C.UTF-8 BUNDLE_FROZEN=true
export BUNDLE_APP_CONFIG="$PWD/.preview/bundle-config"
for variant in baseline source; do
  destination=baseline-output
  if [ "$variant" = source ]; then destination=output; fi
  ruby -rbundler/setup "$GEM_HOME/bin/jekyll" build --config ".preview/cms-blog-test/$variant/_config.yaml" --source ".preview/cms-blog-test/$variant" --destination ".preview/cms-blog-test/$destination" --trace
done
"""
    (WORK / "build.sh").write_text(script, encoding="utf-8", newline="\n")


def build_fixture() -> None:
    # Existing local Ruby/gems only, with no package installation.
    subprocess.run(["wsl.exe", "--exec", "bash", "/mnt/d/홈페이지/.preview/cms-blog-test/build.sh"], cwd=ROOT, check=True)


def assert_preserved_public_rendering() -> None:
    pages = [Path(name) / "index.html" for name in ("team", "about", "research", "notice")]
    pages += [p.relative_to(BASELINE_OUTPUT) for folder in ("members", "notice") for p in (BASELINE_OUTPUT / folder).rglob("index.html")]
    for relative in pages:
        before = (BASELINE_OUTPUT / relative).read_text(encoding="utf-8")
        after = (OUTPUT / relative).read_text(encoding="utf-8")
        before_main = re.search(r"<main\b[^>]*>.*?</main>", before, re.S).group()
        after_main = re.search(r"<main\b[^>]*>.*?</main>", after, re.S).group()
        assert before_main == after_main, f"Blog publication changed {relative}."


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_args) -> None:
        pass


def no_overflow(page) -> None:
    assert not page.evaluate("document.documentElement.scrollWidth > innerWidth + 1")


def check_public_site() -> None:
    data = json.loads((WORK / "input.json").read_text(encoding="utf-8"))
    assert_preserved_public_rendering()
    server = ThreadingHTTPServer(("127.0.0.1", 0), partial(QuietHandler, directory=str(OUTPUT)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{server.server_port}"
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(executable_path=str(CHROMIUM), headless=True)
            page = browser.new_page(viewport={"width": 1440, "height": 960})
            page.route("**/*", lambda r: r.continue_() if r.request.url.startswith(base + "/") else r.abort())
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            for width in (1440, 390):
                page.set_viewport_size({"width": width, "height": 960})
                assert page.goto(base + "/blog/", wait_until="networkidle").status == 200
                card = page.locator(".journal-entry").filter(has_text=data["uploaded"]["title"])
                expect(card).to_have_count(1)
                card.locator("a").click()
                expect(page.locator(".article-heading h1")).to_have_text(data["uploaded"]["title"])
                expect(page.locator('meta[name="description"]')).to_have_attribute("content", data["uploaded"]["description"])
                expect(page.locator(".article-body strong")).to_have_text("Approved Blog body")
                expect(page.locator(".article-body li")).to_have_count(2)
                expect(page.locator(".article-cover img")).to_have_attribute("alt", "Blog cover & people")
                expect(page.locator(".article-cover figcaption")).to_have_text("Cover moment & people")
                expect(page.locator(".article-gallery img")).to_have_count(2)
                expect(page.locator(".article-gallery figcaption")).to_have_text(["Detail & instruments", "The group photo"])
                for picture in page.locator(".article-cover img, .article-gallery img").all():
                    picture.scroll_into_view_if_needed()
                    expect(picture).to_have_js_property("naturalWidth", 48)
                    picture.evaluate("image => image.decode()")
                no_overflow(page)
                old_name = Path(data["preserved"]["source_path"]).stem
                assert page.goto(base + f"/blog/{old_name}/", wait_until="networkidle").status == 200
                expect(page.locator(".article-body strong")).to_have_text("Preserved original Blog photo")
                image = page.locator(".article-cover img")
                assert unquote(image.get_attribute("src")).lstrip("/") == data["preserved"]["frontmatter"]["image"].lstrip("/")
                image.evaluate("image => image.decode()")
                no_overflow(page)
            assert not errors, errors
            browser.close()
    finally:
        server.shutdown()
        server.server_close()


def main() -> None:
    before = content_hashes()
    try:
        if "--skip-build" not in sys.argv:
            prepare_fixture()
        if "--prepare-only" in sys.argv:
            print("PASS: isolated Blog/photos serializers and unchanged public baseline prepared.")
            return
        if "--skip-build" not in sys.argv:
            build_fixture()
        assert OUTPUT.is_dir() and BASELINE_OUTPUT.is_dir(), "Build both isolated Jekyll variants first."
        check_public_site()
    finally:
        assert content_hashes() == before, "Original public source content was modified."
    print("PASS: Blog serializers -> Jekyll -> desktop/mobile body, summary, gallery/captions and old photo URLs; unrelated public rendering and all original content unchanged.")


if __name__ == "__main__":
    main()
