"""Import the approved local set as portable server assets; no model calls."""
from pathlib import Path
from PIL import Image
import argparse, hashlib, json, shutil

p = argparse.ArgumentParser()
p.add_argument('source', type=Path)
p.add_argument('video', type=Path)
a = p.parse_args()
target = Path(__file__).resolve().parents[1] / 'skills/qingmao-stickers/assets'
pack = target / 'pack'
pack.mkdir(parents=True, exist_ok=True)
records = json.loads((a.source / '动画清单.json').read_text('utf-8'))
items = []
for i, record in enumerate(records, 1):
    name, sid = record['name'], f'{i:02}'
    folder = pack / sid
    folder.mkdir(exist_ok=True)
    for sub, filename in [('GIF','animation.gif'),('WebP','animation.webp'),('动态PNG','animation.png'),('透明PNG','still.png'),('缩略图120','thumb.png')]:
        ext = '.gif' if sub == 'GIF' else '.webp' if sub == 'WebP' else '.png'
        shutil.copyfile(a.source / sub / (name + ext), folder / filename)
    atlas = Image.new('RGBA', (512 * 5, 512 * 2))
    for j in range(10):
        frame = Image.open(a.source / 'PNG序列帧' / name / f'{name}_{j+1:02}.png').convert('RGBA')
        atlas.paste(frame, ((j % 5)*512, (j // 5)*512))
    atlas.save(folder / 'atlas.webp', quality=94, method=6)
    items.append({'id':sid,'name':name,'action':record['action'],'durations':record['duration_ms'],'frameSize':512,'columns':5,'rows':2})
shutil.copyfile(a.video / '原创轻音乐.wav', target / 'music.wav')
shutil.copyfile(a.video.parent / '成片归档/2026-11-14_轻喵第2弹_被你哄好的一天_1080x1440.mp4', target / 'sample.mp4')
Image.open(a.video / '检查帧/22.5.jpg').save(target / 'poster.png', optimize=True)
for src, dst in [('横幅-750x400.jpg','banner.jpg'),('封面-240x240.png','album.png'),('图标-50x50.png','icon.png'),('填写文案.json','album.json')]:
    shutil.copyfile(a.source.parent / '轻喵第2弹-专辑配套素材-v1' / src, target / dst)
files = {}
for file in sorted(target.rglob('*')):
    if file.is_file() and file.name != 'pack.json':
        files[file.relative_to(target).as_posix()] = hashlib.sha256(file.read_bytes()).hexdigest()
manifest = {'id':'qingmao-affection-v1','name':'轻喵第2弹·亲昵互动','version':'1.0.0','items':items,
            'defaultSceneIds':['24','09','03','12','01','20'],'files':files}
(target / 'pack.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n','utf-8')
print(json.dumps({'items':len(items),'files':len(files),'bytes':sum(f.stat().st_size for f in target.rglob('*') if f.is_file())}))
