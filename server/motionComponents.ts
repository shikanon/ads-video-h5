// This is the product motion library. Each primitive adds frame-addressable GSAP tweens.
export const motionLibrary = `window.QJMotion = Object.freeze({
  textRise(tl, selector, at=0.2) { return tl.fromTo(selector,{y:90,opacity:0,filter:'blur(14px)'},{y:0,opacity:1,filter:'blur(0px)',duration:0.68,ease:'power3.out'},at); },
  cardPop(tl, selector, at=0.35) { return tl.fromTo(selector,{scale:0.86,opacity:0,rotation:-3},{scale:1,opacity:1,rotation:0,duration:0.82,ease:'back.out(1.3)'},at); },
  lineDraw(tl, selector, at=0.7) { return tl.fromTo(selector,{scaleX:0,transformOrigin:'left center'},{scaleX:1,duration:0.42,ease:'expo.out'},at); },
  imageDrift(tl, selector, at=0.2, duration=4.8) { return tl.fromTo(selector,{scale:1.08,x:-24},{scale:1.17,x:24,duration,ease:'none'},at); },
  splitWipe(tl, selector, at=0.18) { return tl.fromTo(selector,{clipPath:'inset(0 100% 0 0)'},{clipPath:'inset(0 0% 0 0)',duration:0.76,ease:'power4.out'},at); },
  fadeOut(tl, selector, at, duration=0.3) { return tl.to(selector,{opacity:0,y:-18,duration,ease:'power2.in'},at); },
  keywordPunch(tl, selector, at=.3) { return tl.fromTo(selector,{scale:.94,opacity:0},{scale:1,opacity:1,duration:.42,ease:'back.out(1.1)'},at); },
  lowerThird(tl, selector, at=.4) { return tl.fromTo(selector,{x:-32,opacity:0},{x:0,opacity:1,duration:.5,ease:'power3.out'},at); },
  chapterProgress(tl, selector, at=.4, duration=4.8) { return tl.fromTo(selector,{scaleX:0,transformOrigin:'left center'},{scaleX:1,duration,ease:'none'},at); },
  compareReveal(tl, selector, at=.6) { return tl.fromTo(selector,{x:36,opacity:0},{x:0,opacity:1,duration:.62,ease:'expo.out',stagger:.18},at); },
  drawStroke(tl, selector, at=.4, duration=.7) { gsap.utils.toArray(selector).forEach((node,i)=>{const length=node.getTotalLength();tl.set(node,{strokeDasharray:length,strokeDashoffset:length},0);tl.fromTo(node,{strokeDashoffset:length},{strokeDashoffset:0,duration,ease:'power2.out'},at+i*.12);});return tl; },
  markerSweep(tl, selector, at=.5) { return tl.fromTo(selector,{scaleX:0,transformOrigin:'left center'},{scaleX:1,duration:.55,ease:'expo.out'},at); },
  staggerReveal(tl, selector, at=.2, duration=.45, ease='power3.out') { const nodes=gsap.utils.toArray(selector);return tl.fromTo(nodes,{y:24,opacity:0},{y:0,opacity:1,duration,ease,stagger:nodes.length>1?Math.min(.08,.4/(nodes.length-1)):0},at); },
  cardSettle(tl, selector, at=.2, duration=.5, ease='power3.out') { return tl.fromTo(selector,{y:20,scale:.97,opacity:0},{y:0,scale:1,opacity:1,duration,ease},at); },
  focusPulse(tl, selector, at=1.4, duration=.6) { tl.to(selector,{scale:1.025,duration:duration/2,ease:'sine.out'},at);return tl.to(selector,{scale:1,duration:duration/2,ease:'sine.in',immediateRender:false},at+duration/2); },
  ambientFloat(tl, selector, at=.2, duration=4, amplitude=8) { const count=Math.max(1,Math.ceil(duration/2));const segment=duration/count;for(let i=0;i<count;i++)tl.fromTo(selector,{y:i===0?0:(i%2?amplitude:-amplitude)},{y:i%2?-amplitude:amplitude,duration:segment,ease:'sine.inOut',immediateRender:i===0},at+i*segment);return tl; },
  connectorFlow(tl, selector, at=.5, duration=.7) { gsap.utils.toArray(selector).forEach((node,i)=>{const length=node.getTotalLength();tl.fromTo(node,{strokeDasharray:length,strokeDashoffset:length,opacity:0},{strokeDashoffset:0,opacity:1,duration,ease:'power2.out'},at+i*.12);});return tl; },
  barGrow(tl, selector, at=.4, duration=.8) { return tl.fromTo(selector,{scaleY:0,transformOrigin:'center bottom'},{scaleY:1,duration,ease:'power3.out'},at); },
  radialBurst(tl, selector, at=1, radius=36) { const nodes=gsap.utils.toArray(selector);nodes.forEach((node,i)=>{const angle=i*2*Math.PI/nodes.length;tl.fromTo(node,{x:0,y:0,scale:.3,opacity:0},{x:Math.cos(angle)*radius,y:Math.sin(angle)*radius,scale:1,opacity:.65,duration:.35,ease:'expo.out'},at);tl.to(node,{opacity:0,scale:.7,duration:.35,ease:'sine.in',immediateRender:false},at+.35);});return tl; }

});`;
