import type { ImagePrice } from '../shared/creditTypes';
import { POINT_MICROS, POINT_VALUE_RMB, PRICING_SOURCE } from './tokenPricing';
import { stateHash } from './durableState';

// Regular online output-image price. Input references are not charged again.
export const defaultImagePrices = (): ImagePrice[] => [{ modelId:'doubao-seedream-5-0-flash-260915',rmbPerImage:.12,source:PRICING_SOURCE,updatedAt:'2026-11-15T00:00:00+08:00' }];
export function validateImagePrice(value: unknown): ImagePrice {
  const p=value as ImagePrice;
  if(!p||typeof p.modelId!=='string'||! /^[\w.-]{1,160}$/.test(p.modelId)||typeof p.rmbPerImage!=='number'||!Number.isFinite(p.rmbPerImage)||p.rmbPerImage<=0||p.rmbPerImage>1000||Math.abs(p.rmbPerImage*1000-Math.round(p.rmbPerImage*1000))>1e-6)throw Error('图片价格须大于0，单位元/张，最多三位小数。');
  return {modelId:p.modelId,rmbPerImage:p.rmbPerImage,source:PRICING_SOURCE,updatedAt:new Date().toISOString()};
}
export const imageCostMicros = (p:ImagePrice) => Math.round(p.rmbPerImage / POINT_VALUE_RMB * POINT_MICROS);
export const imagePriceHash = (p:ImagePrice) => stateHash({modelId:p.modelId,rmbPerImage:p.rmbPerImage,pointValueRmb:POINT_VALUE_RMB});
