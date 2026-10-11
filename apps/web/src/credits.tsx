import {useMemo,useState} from 'react';
import {creditsText,licenseLabel,type CatalogAsset,type License} from '../../../packages/asset-catalog/src/index';

// REQ-017 §2: the credits list is always rendered (no hide setting), grouped by license, and every pack expands to its
// per-asset authors. It reads catalog metadata only, so it lists assets even when their GLB failed to load (AC17-8).
const order:License[]=['CC-BY-4.0','QAL-1.0','ITHAPPY-FREE','CC0-1.0','PROJECT-OWN','UNVERIFIED','DEV_ONLY'];
export function Credits({assets,title='素材出處'}:{assets:CatalogAsset[];title?:string}){
 const [copied,setCopied]=useState('');
 const groups=useMemo(()=>{
  const byLicense=new Map<License,Map<string,CatalogAsset[]>>();
  for(const a of assets){const packs=byLicense.get(a.provenance.license)??new Map();const key=a.provenance.sourcePack??a.provenance.author;packs.set(key,[...(packs.get(key)??[]),a]);byLicense.set(a.provenance.license,packs);}
  return order.filter(l=>byLicense.has(l)).map(l=>({license:l,packs:[...byLicense.get(l)!]}));
 },[assets]);
 async function copy(){
  const text=creditsText(assets);
  try{await navigator.clipboard.writeText(text);setCopied('已複製出處文字');}
  catch{setCopied('無法存取剪貼簿，請從下方文字框複製');}
 }
 return <section className="credits" aria-label={title} data-testid="credits">
  <details open>
   <summary>{title}（{assets.length} 件）</summary>
   {groups.map(g=><div key={g.license} className="credits-group">
    <h3>{licenseLabel(g.license)} · {g.packs.reduce((n,[,list])=>n+list.length,0)} 件</h3>
    {g.packs.map(([pack,list])=><details key={pack}><summary>{pack} — {list[0].provenance.author}（{list.length}）</summary>
     <p>{list[0].provenance.licenseUrl&&<a href={list[0].provenance.licenseUrl} target="_blank" rel="noreferrer">授權條款</a>}{list[0].provenance.sourceUrl&&<> · <a href={list[0].provenance.sourceUrl} target="_blank" rel="noreferrer">來源頁</a></>}{list[0].provenance.requiresAttribution&&<> · 署名：{list[0].provenance.attributionText}</>}</p>
     <ul>{list.map(a=><li key={a.id}>{a.name} — {a.provenance.author}{a.provenance.licenseUrl!==list[0].provenance.licenseUrl&&a.provenance.licenseUrl&&<> · <a href={a.provenance.licenseUrl} target="_blank" rel="noreferrer">授權條款</a></>}{a.provenance.sourceUrl!==list[0].provenance.sourceUrl&&a.provenance.sourceUrl&&<> · <a href={a.provenance.sourceUrl} target="_blank" rel="noreferrer">來源頁</a></>}{a.provenance.requiresAttribution&&a.provenance.attributionText!==list[0].provenance.attributionText&&<> · 署名：{a.provenance.attributionText}</>}</li>)}</ul>
    </details>)}
   </div>)}
   <button type="button" onClick={()=>void copy()}>複製出處文字</button>{copied&&<span role="status">{copied}</span>}
   {copied.startsWith('無法')&&<textarea readOnly aria-label="出處文字" value={creditsText(assets)} rows={6}/>}
  </details>
 </section>;
}
export function ProvenanceLine({asset}:{asset:CatalogAsset}){
 const p=asset.provenance;
 return <p className="provenance" data-testid="provenance">出處：{p.author} · {licenseLabel(p.license)}{p.requiresAttribution&&<> · {p.attributionText}</>}</p>;
}
