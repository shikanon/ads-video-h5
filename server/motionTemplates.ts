// Native HTML/SVG components; no remote assets, runtime randomness or Lottie
// player required. The upstream skill supplies design rules, not animations.
const layouts = {
  'sop-flow': {
    name: 'SOP流程推进', description: '步骤卡片依次入场，连线绘制后逐项聚焦，适合方法与操作流程。',
    title: '把方法变成可执行流程', subtitle: '明确需求 → 制作 → 验收，每一步都有依据。',
    graphic: `<svg viewBox="0 0 920 780" class="links"><path class="flow" d="M460 180 L460 290 M460 440 L460 550"/></svg><div class="step block a"><small>01 · 明确需求</small><strong>目标与验收标准</strong></div><div class="step block b"><small>02 · 按流程制作</small><strong>输入 → 执行 → 输出</strong></div><div class="step block c"><small>03 · 检查与迭代</small><strong>核对结果，持续改进</strong></div>`,
    css: '.block{left:60px;width:800px;height:150px}.a{top:30px}.b{top:290px}.c{top:550px}',
    script: "QJMotion.staggerReveal(tl,'.step',.45,.45);QJMotion.connectorFlow(tl,'.flow',1.05,.6);['.a','.b','.c'].forEach((s,i)=>QJMotion.focusPulse(tl,s,1.8+i*.9));",
  },
  'cause-chain': {
    name: '因果链路', description: '原因与结果通过箭头连接，并依次强调，适合解释返工和人力消耗。',
    title: '需求含糊为何带来返工', subtitle: '让原因、过程与结果形成可读的因果关系。',
    graphic: `<svg viewBox="0 0 920 780" class="links"><defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 Z" fill="#fb7353" stroke="none"/></marker></defs><path class="flow" marker-end="url(#arrow)" d="M460 200 L460 290 M460 450 L460 540"/></svg><div class="step block a"><small>原因</small><strong>需求含糊</strong></div><div class="step block b"><small>过程</small><strong>反复修改与返工</strong></div><div class="step block c"><small>结果</small><strong>额外的人力消耗</strong></div>`,
    css: '.block{left:60px;width:800px;height:160px}.a{top:40px}.b{top:290px}.c{top:540px}',
    script: "QJMotion.cardSettle(tl,'.a',.4);QJMotion.cardSettle(tl,'.b',.7);QJMotion.cardSettle(tl,'.c',1);QJMotion.connectorFlow(tl,'.flow',1.35,.7);QJMotion.focusPulse(tl,'.b',2.3);QJMotion.focusPulse(tl,'.c',3.2);",
  },
  'data-growth': {
    name: '趋势图解', description: '柱形图依次生长，用示意趋势表达阶段关系，不虚构实测数字。',
    title: '从试点走向复用', subtitle: '示意趋势，不代表实测数据；实际数值须有来源。',
    graphic: `<div class="chart"><div class="column"><div class="bar bar-a"></div><span>试点</span></div><div class="column"><div class="bar bar-b"></div><span>复用</span></div><div class="column"><div class="bar bar-c"></div><span>规模化</span></div></div><div class="chart-note">阶段示意</div>`,
    css: '.chart{position:absolute;inset:40px 40px 100px;display:flex;align-items:flex-end;justify-content:space-around;border-bottom:4px solid #25293533}.column{width:180px;text-align:center;position:relative}.column span{display:block;width:100%;padding-top:26px;font-size:38px;font-weight:700}.bar{width:100%;border-radius:20px 20px 0 0;background:#4c95b7}.bar-a{height:160px}.bar-b{height:340px}.bar-c{height:560px;background:#fb7353}.chart-note{position:absolute;top:0;left:40px;font-size:28px;color:#625b59}',
    script: "['.bar-a','.bar-b','.bar-c'].forEach((s,i)=>QJMotion.barGrow(tl,s,.65+i*.18,.85));QJMotion.staggerReveal(tl,'.column span',.5);QJMotion.focusPulse(tl,'.bar-c',2.2);",
  },
  'result-reveal': {
    name: '成果揭示', description: '成果卡片揭示、SVG勾选与有限粒子收束，适合展示产出与总结。',
    title: '把想法变成可复用成果', subtitle: '成果卡片为示意，可替换为真实内容。',
    graphic: `<div class="result"><div class="mock-head"><i></i><i></i><i></i><span>成果示意</span></div><div class="mock-picture"><svg viewBox="0 0 200 200"><path class="check" d="M48 104 L85 140 L153 62" fill="none" stroke="#fb7353" stroke-width="14" stroke-linecap="round" stroke-linejoin="round"/></svg></div><div class="mock-line"></div><div class="mock-line short"></div></div><div class="burst">${Array.from({length:8},(_,i)=>`<i class="particle p${i}"></i>`).join('')}</div>`,
    css: '.result{position:absolute;inset:40px 70px;border:3px solid #2529351a;background:#fffdfa;border-radius:30px;padding:35px;box-shadow:0 18px 50px #25293512}.mock-head{display:flex;align-items:center;gap:12px;font-size:30px}.mock-head i{height:14px;width:14px;background:#fb7353;border-radius:50%}.mock-head span{margin-left:auto}.mock-picture{height:350px;margin:40px 0;background:#fff0e9;border-radius:22px;display:grid;place-items:center}.mock-picture svg{width:200px;height:200px}.mock-line{height:22px;background:#25293520;border-radius:10px;margin-top:30px}.short{width:65%}.burst{position:absolute;left:460px;top:335px;pointer-events:none}.particle{position:absolute;width:10px;height:10px;border-radius:50%;background:#fb7353;opacity:0}',
    script: "QJMotion.cardSettle(tl,'.result',.5,.65,'sine.out');QJMotion.connectorFlow(tl,'.check',1.25,.6);QJMotion.staggerReveal(tl,'.mock-line',1.35);QJMotion.radialBurst(tl,'.particle',2,135);QJMotion.focusPulse(tl,'.result',2.7);",
  },
};
export const richMotionIds = Object.keys(layouts);
export function richMotionTemplates() {
  return Object.entries(layouts).map(([id, item]) => ({id, name:item.name, description:item.description, title:item.title, subtitle:item.subtitle,
    html:`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>@font-face{font-family:'PingFang SC';src:local('PingFang SC')}@font-face{font-family:'Noto Sans CJK SC';src:local('Noto Sans CJK SC')}*{box-sizing:border-box}html,body{margin:0;width:1080px;height:1920px;overflow:hidden;background:#fffdfa;color:#252935;font-family:'PingFang SC','Noto Sans CJK SC',Arial,sans-serif}#root{position:relative;width:1080px;height:1920px;overflow:hidden}.scene-content{position:relative;width:100%;height:100%;padding:140px 80px;display:flex;flex-direction:column;justify-content:center;gap:50px}.eyebrow{font-size:30px;letter-spacing:.08em;color:#625b59}.title{font-size:76px;font-weight:800;line-height:1.25;margin:0;overflow-wrap:anywhere}.subtitle{font-size:36px;line-height:1.6;margin:0}.graphic{position:relative;width:920px;height:780px;flex-shrink:0}.links{position:absolute;inset:0;width:100%;height:100%;overflow:visible}.flow{fill:none;stroke:#fb7353;stroke-width:6;stroke-linecap:round}.step{position:absolute;padding:24px 40px;border:3px solid #fb735330;border-radius:24px;background:#fff0e9;display:flex;flex-direction:column;justify-content:center;gap:12px}.step small{font-size:30px;color:#625b59}.step strong{font-size:46px}.halo{position:absolute;width:550px;height:550px;background:#fff0e9;border-radius:50%;right:-260px;top:-120px;opacity:.55}${item.css}</style><!--QJ_RUNTIME--></head><body><main id="root" data-composition-id="main" data-start="0" data-duration="6" data-width="1080" data-height="1920"><div class="halo" data-layout-ignore></div><section class="scene-content"><div id="eyebrow" class="eyebrow" data-qj-field="eyebrow"></div><h1 id="title" class="title" data-qj-field="title"></h1><div class="graphic">${item.graphic}</div><p id="subtitle" class="subtitle" data-qj-field="subtitle"></p></section></main><!--QJ_DATA--><script>const tl=gsap.timeline({paused:true});QJMotion.lowerThird(tl,'#eyebrow',.15);QJMotion.textRise(tl,'#title',.25);${item.script}QJMotion.lowerThird(tl,'#subtitle',1.55);QJMotion.ambientFloat(tl,'.halo',.2,5.7,8);window.__timelines["main"]=tl;tl.seek(0);if(window.__QJ_PREVIEW__)tl.play(0);</script></body></html>`
  }));
}
