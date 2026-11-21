from pathlib import Path
from PIL import Image, ImageDraw
root=Path(__file__).resolve().parent.parent/'apps/miniprogram/miniprogram/assets/ui'
for theme,color in {'light':'#fff0db','dark':'#8b5d3c'}.items():
    for name in ['note','asset']:
        scale=8;im=Image.new('RGBA',(192,192));d=ImageDraw.Draw(im)
        def line(points):d.line([(round(x*scale),round(y*scale)) for x,y in points],fill=color,width=12,joint='curve')
        if name=='note':
            d.rounded_rectangle((5*scale,3*scale,20*scale,21*scale),radius=2*scale,outline=color,width=12)
            line([(8,3),(8,21)]);line([(11,8),(16,8)]);line([(11,12),(17,12)]);line([(11,16),(15,16)])
            line([(3,7),(6,7)]);line([(3,12),(6,12)]);line([(3,17),(6,17)])
        else:
            line([(12,3),(21,8),(21,17),(12,22),(3,17),(3,8),(12,3)])
            line([(3,8),(12,13),(21,8)]);line([(12,13),(12,22)]);line([(8,5.2),(17,10.2)])
        im.resize((96,96),Image.Resampling.LANCZOS).save(root/(name+'-'+theme+'.png'))
