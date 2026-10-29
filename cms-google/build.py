"""Build the Google editor and a standalone, single-paste Apps Script bundle."""
from pathlib import Path
import base64
import json

ROOT = Path(__file__).resolve().parent
WEB = ROOT / 'web'
html = (WEB / 'index.html').read_text(encoding='utf-8')
css = (WEB / 'cms.css').read_text(encoding='utf-8')
bridge = (ROOT / 'bridge.js').read_text(encoding='utf-8')
editor = (WEB / 'cms.js').read_text(encoding='utf-8')
boot = (ROOT / 'boot.js').read_text(encoding='utf-8')
loader = (ROOT / 'loader.js').read_text(encoding='utf-8')
assert html.count('<link rel="stylesheet" href="cms.css">') == 1
assert html.count('<script src="cms.js" defer></script>') == 1
html = html.replace('<link rel="stylesheet" href="cms.css">', '<style>' + css + '</style>')
html = html.replace('<script src="cms.js" defer></script>', '')
# The fixed editor source is encoded at build time. User content is never code.
encoded = base64.b64encode((bridge + '\n' + editor).encode('utf-8')).decode('ascii')
chunks = [encoded[i:i + 240] for i in range(0, len(encoded), 240)]
assert loader.count('/*CMS_EDITOR_BASE64*/') == 1
loader = loader.replace('/*CMS_EDITOR_BASE64*/', json.dumps(chunks))
html = html.replace('</body>', '<script>' + boot + '</script><script>' + loader + '</script></body>')
assert '<?' not in html
(ROOT / 'Admin.html').write_text(html, encoding='utf-8')
backend = (ROOT / 'Code.gs').read_text(encoding='utf-8')
source = "HtmlService.createHtmlOutputFromFile('Admin').getContent()"
assert backend.count(source) == 1, 'Expected exactly one Admin HTML reference.'
backend = backend.replace(source, 'CMS_ADMIN_HTML')
assert 'createHtmlOutputFromFile' not in backend, 'Standalone bundle must not depend on extra HTML files.'
bundle = ('// Paste this entire file into Code.gs in a NEW research lab CMS project.\n'
          '// Includes the editor; no separate HTML files are required.\n'
          + backend + '\nconst CMS_ADMIN_HTML = ' + json.dumps(html, ensure_ascii=True) + ';\n')
(ROOT / 'Install.gs').write_text(bundle, encoding='utf-8')
print('Built Admin.html and single-file Install.gs; no credentials included.')
