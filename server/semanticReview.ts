import { jobFetch, jobDelay, throwIfJobCancelled } from './jobExecution';
import type { ModelConfig } from './modelRegistry';
import { validateSemanticReview } from './reviewResults';

export async function requestSemanticReview(config:ModelConfig,messages:unknown[]) {
  for(let attempt=0;attempt<2;attempt++) {
    try {
      const response=await jobFetch(config.baseUrl.replace(/\/$/,'')+'/chat/completions',{method:'POST',headers:{Authorization:'Bearer '+config.apiKey,'Content-Type':'application/json'},signal:AbortSignal.timeout(180000),body:JSON.stringify({model:config.modelId,thinking:{type:'disabled'},response_format:{type:'json_object'},max_tokens:8000,messages})});
      if(!response.ok)throw new Error(`HTTP ${response.status}`);
      const body=await response.json() as {choices?:Array<{message?:{content?:string}}>};
      return validateSemanticReview(JSON.parse(body.choices?.[0]?.message?.content||''));
    } catch(error) {
      throwIfJobCancelled();
      if(attempt||error instanceof Error&&/^HTTP 4(?!08|29)/.test(error.message))throw error;
      await jobDelay(600);
    }
  }
  throw new Error('成片审查请求未完成');
}
