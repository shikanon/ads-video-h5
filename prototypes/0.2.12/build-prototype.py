"""Build a self-contained local UI prototype from existing acceptance fixtures."""
import base64
import io
import json
import hashlib
import math
from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parent
fixtures = Path('D:/ads-video-h5-diagnostics/tool-style-real-20261117')
sources = {
    'soft': 'candidate-soft.png',
    'round': 'candidate-round.png',
    'sample0': 'sample-01.png',
    'sample1': 'sample-03.png',
    'sample2': 'sample-20.png',
}
media = {}
for name, filename in sources.items():
    with Image.open(fixtures / filename) as image:
        image.thumbnail((300, 300), Image.Resampling.LANCZOS)
        out = io.BytesIO()
        image.save(out, format='WEBP', quality=83, method=6)
    media[name] = 'data:image/webp;base64,' + base64.b64encode(out.getvalue()).decode('ascii')
native = root.parents[1] / 'apps/miniprogram/miniprogram/assets/ui/fresh'
repo = root.parents[1]
original_sources = {
    'template-lightmao-01': 'skills/qingmao-stickers/assets/pack/01/still.png',
    'template-lightmao-03': 'skills/qingmao-stickers/assets/pack/03/still.png',
    'template-interface': 'skills/video-style-interface/assets/poster.png',
    'template-diagram': 'skills/video-style-diagram/assets/poster.png',
    'template-spatial': 'skills/video-style-spatial/assets/poster.png',
    'template-news': 'skills/daily-ai-frontier/assets/poster.png',
}
provenance = {}
for key, relative in original_sources.items():
    source = repo / relative
    with Image.open(source) as image:
        image.thumbnail((360, 240), Image.Resampling.LANCZOS)
        out = io.BytesIO()
        image.save(out, format='WEBP', quality=87, method=6)
    media[key] = 'data:image/webp;base64,' + base64.b64encode(out.getvalue()).decode('ascii')
    provenance[key] = {'source': relative, 'sourceSha256': hashlib.sha256(source.read_bytes()).hexdigest()}
(root / 'TEMPLATE-IMAGE-SOURCES.json').write_bytes((json.dumps(provenance, indent=2) + '\n').encode('utf-8'))
for name in ('create', 'idea', 'library', 'profile'):
    icon = native / ('active' if name == 'idea' else 'idle') / (name + '.png')
    media['tab-' + name] = 'data:image/png;base64,' + base64.b64encode(icon.read_bytes()).decode('ascii')
template = (root / 'canvas-tools.template.html').read_text(encoding='utf-8')
assert template.count('__LIGHTMAO_DEMO_MEDIA__') == 1
fragment = template.replace('__LIGHTMAO_DEMO_MEDIA__', json.dumps(media))
prompt_spec = json.loads((root / 'video-prompts.json').read_text(encoding='utf-8'))
prompts = {}
for key, spec in prompt_spec['templates'].items():
    original = json.loads((repo / 'skills' / spec['templateId'] / 'template.json').read_text(encoding='utf-8'))
    defaults = original['defaults']
    common = math.gcd(defaults['width'], defaults['height'])
    context = dict(defaults)
    context['ratio'] = str(defaults['width'] // common) + ':' + str(defaults['height'] // common)
    context['narration'] = prompt_spec['narration']['yes' if defaults['narration'] else 'no']
    context['bgm'] = prompt_spec['bgm']['yes' if defaults['bgm'] else 'no']
    prompts[key] = '\n'.join(['@' + original['name']] + spec['fields'] + [spec['instructions'], prompt_spec['defaultsLine'].format(**context)])
assert fragment.count('__LIGHTMAO_VIDEO_PROMPTS__') == 1
fragment = fragment.replace('__LIGHTMAO_VIDEO_PROMPTS__', json.dumps(prompts, ensure_ascii=False))
(root / 'VIDEO-PROMPTS-BUILT.json').write_bytes((json.dumps(prompts, ensure_ascii=False, indent=2) + '\n').encode('utf-8'))
assert len(fragment.encode('utf-8')) < 1_000_000
(root / 'workbench.fragment.html').write_bytes(fragment.encode('utf-8'))
thread_root = Path('C:/Users/\u9648\u6d0b/.codex/visualizations/2026/11/14/01a1d904-d59a-7420-bcd4-5343cf859b7d')
thread_root.mkdir(parents=True, exist_ok=True)
(thread_root / 'lightmao-0212-workbench.html').write_bytes(fragment.encode('utf-8'))
print(json.dumps({'bytes': len(fragment.encode('utf-8')), 'images': len(media), 'localOnly': True}))
