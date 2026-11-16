import { stateHash } from '../../server/durableState';
import { stickerQualityChecks, type StickerQualityInput, type StickerQualityReceipt } from '../../server/stickerQuality';

/** Transport/pipeline fixture only; rectangle PNGs are not a visual QA test. */
export function stickerQualityFixture(input:Pick<StickerQualityInput,'frames'>):StickerQualityReceipt{
  return {version:1,inputHash:'a'.repeat(64),policyHash:'b'.repeat(64),modelId:'fixture-vision',reviewedAt:new Date().toISOString(),frameHashes:input.frames.map(bytes=>stateHash(bytes.toString('base64'))),passed:true,issues:[],frames:input.frames.map((_bytes,index)=>({index,subjects:1,heads:1,checks:Object.fromEntries(stickerQualityChecks.map(key=>[key,{status:'passed',detail:'受控管线测试证据，非实际视觉验收'}])) as any}))};
}
