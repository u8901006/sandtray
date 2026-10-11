// Transfer diagnostics only: parsing, cloning, GPU upload and first frame are not measured.
export function summarizeTransfer(result){
 const invalid={verdict:'INVALID_SAMPLE',sceneAcceptance:'NOT_MEASURED'};
 if(!Number.isInteger(result.models)||result.models<1||!Number.isInteger(result.rounds)||result.rounds<1||
  !Number.isSafeInteger(result.expectedBytes)||result.expectedBytes<1)return invalid;
 for(const key of ['static','private']){
  const rows=result[key];
  if(!Array.isArray(rows)||rows.length!==result.rounds||rows.some(r=>!Number.isFinite(r.ms)||r.ms<=0||
   r.failed!==0||r.verified!==result.models||r.bytes!==result.expectedBytes))return invalid;
 }
 const median=rows=>{const a=rows.map(r=>r.ms).sort((a,b)=>a-b),i=Math.floor(a.length/2);return a.length%2?a[i]:(a[i-1]+a[i])/2;};
 const medianMs={static:median(result.static),private:median(result.private)};
 const ratio=medianMs.private/medianMs.static;
 return {medianMs,ratio,degradationPct:(ratio-1)*100,
  verdict:medianMs.private<=medianMs.static*1.2?'TRANSFER_WITHIN_20PCT':'TRANSFER_OVER_20PCT',sceneAcceptance:'NOT_MEASURED'};
}
