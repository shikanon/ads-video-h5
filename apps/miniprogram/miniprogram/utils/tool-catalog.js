// Generated from original template manifests by tooling/build-tool-catalog.ts.
module.exports = [
  {
    "id": "qingmao-stickers",
    "name": "动态表情套装",
    "description": "复用轻喵24套透明动态表情，可同步制作带音乐的故事分享视频。",
    "defaults": {
      "width": 1080,
      "height": 1440,
      "fps": 30,
      "seconds": 24,
      "panels": 0,
      "narration": false,
      "bgm": true
    },
    "output": "sticker-pack",
    "localThumbnail": "/assets/templates/qingmao-stickers.png",
    "tool": {
      "category": "stickers",
      "group": "diagram",
      "prompt": "@动态表情套装 参考轻喵24张表情，为我的角色制作两种画风，选定后生成3张样张。"
    }
  },
  {
    "id": "video-style-interface",
    "name": "界面动效",
    "description": "按钮、加载和完成状态连续变化，适合产品演示。",
    "defaults": {
      "width": 960,
      "height": 540,
      "fps": 30,
      "seconds": 12,
      "panels": 0,
      "narration": false,
      "bgm": false
    },
    "localThumbnail": "/assets/templates/video-style-interface.png",
    "tool": {
      "category": "video",
      "group": "interface",
      "prompt": "@界面动效\n产品/功能：【填写】\n操作流程：【触发操作 → 系统反馈 → 完成结果】\n按原模板制作3幕界面演示。同一主组件在原位连续变形，用按钮、加载进度与完成状态讲清流程；每幕用3个短标签对应操作、反馈和结果。保留原模板构图与节奏，文案和界面内容围绕我的产品。\n默认12秒，16:9横屏（960×540），30fps，无口播、无配乐。"
    }
  },
  {
    "id": "video-style-diagram",
    "name": "原理拆解",
    "description": "用节点与流动路径解释一个机制，适合科普和流程说明。",
    "defaults": {
      "width": 960,
      "height": 540,
      "fps": 30,
      "seconds": 12,
      "panels": 0,
      "narration": false,
      "bgm": false
    },
    "localThumbnail": "/assets/templates/video-style-diagram.png",
    "tool": {
      "category": "video",
      "group": "diagram",
      "prompt": "@原理拆解\n原理/流程：【填写】\n给谁看：【填写】\n按原模板把机制拆成输入 → 变化 → 输出，分3幕推进。每幕3个节点作用清晰，用动画沿因果路径展示变化；短标题给出本幕结论，补充必要边界。沿用原模板的节点、路径与节奏；示例数据标明示意，不编造实验或指标。\n默认12秒，16:9横屏（960×540），30fps，无口播、无配乐。"
    }
  },
  {
    "id": "video-style-spatial",
    "name": "空间发布",
    "description": "层叠结构与旋转镜头，适合产品结构和功能揭晓。",
    "defaults": {
      "width": 960,
      "height": 540,
      "fps": 30,
      "seconds": 12,
      "panels": 0,
      "narration": false,
      "bgm": false
    },
    "localThumbnail": "/assets/templates/video-style-spatial.png",
    "tool": {
      "category": "video",
      "group": "product",
      "prompt": "@空间发布\n产品：【填写】\n3个功能/卖点：【填写】\n按原模板制作3幕产品展示，每幕突出一个价值点。用三层空间结构、层间距、转动和透视展示功能关系，3个标签对应可辨认的层次，文字始终正面可读。沿用原模板的空间构图与镜头节奏，以抽象产品示意呈现，不冒充实拍或真实产品建模。\n默认12秒，16:9横屏（960×540），30fps，无口播、无配乐。"
    }
  },
  {
    "id": "daily-ai-frontier",
    "name": "AI前沿图解",
    "description": "从可靠原文讲清一个AI问题，用紫粉动态图解展示机制、证据与边界。",
    "defaults": {
      "width": 1920,
      "height": 1080,
      "fps": 30,
      "seconds": 35,
      "panels": 4,
      "narration": true,
      "bgm": true
    },
    "localThumbnail": "/assets/templates/daily-ai-frontier.png",
    "tool": {
      "category": "video",
      "group": "diagram",
      "prompt": "@AI前沿图解\nAI主题/指定对象：【填写；也可请轻喵找合适选题】\n优先查证近48小时的一手公告、论文或官方文档，并交叉核验；保留来源与原文日期，没有合适新稿就说明，不把旧消息当今日更新。只讲清一个问题：问题/结果 → 关键机制 → 证据或反例 → 结论与限制。4–6个场景，前2秒切入重点，约100–180字；沿用原模板紫粉图解、大主图、短标题和清晰字幕。旁白与字幕同步，音乐低于人声，保留轻喵水印。不冒充实测，不自动发布。\n默认35秒，16:9横屏（1920×1080），30fps，带旁白、配乐。"
    }
  }
];
