// REQ-017: every catalog asset carries machine-checkable provenance. Licenses outside the allow-list
// (by-sa / by-nc / by-nd) are rejected at build time; assets that may not be redistributed standalone
// must never be served from a public static path (T-A3). Data files stay untouched — provenance is
// derived here from the pack each asset came from.
export type License='CC0-1.0'|'CC-BY-4.0'|'QAL-1.0'|'ITHAPPY-FREE'|'PROJECT-OWN'|'DEV_ONLY'|'UNVERIFIED';
export const ALLOWED_LICENSES:readonly License[]=['CC0-1.0','CC-BY-4.0','QAL-1.0','ITHAPPY-FREE','PROJECT-OWN','DEV_ONLY','UNVERIFIED'];
export const PUBLIC_PATHS=['/imported-assets/','/dev-assets/'];
export type Provenance={
 author:string;license:License;licenseUrl:string;sourceUrl:string;sourcePack?:string;
 requiresAttribution:boolean;attributionText:string;standaloneRedistributionAllowed:boolean;
 /** Set for DEV_ONLY / UNVERIFIED: shown in credits, never counted as released. */
 releasable:boolean;licenseSnapshotSha256?:string;
};
const CC0='https://creativecommons.org/publicdomain/zero/1.0/';
const packs:Record<string,Omit<Provenance,'attributionText'|'requiresAttribution'|'standaloneRedistributionAllowed'|'releasable'>&Partial<Provenance>>={
 'kenney_mini-arena':{author:'Kenney',license:'CC0-1.0',licenseUrl:CC0,sourceUrl:'https://kenney.nl/assets/mini-arena',sourcePack:'Kenney Mini Arena'},
 'kenney_mini-dungeon':{author:'Kenney',license:'CC0-1.0',licenseUrl:CC0,sourceUrl:'https://kenney.nl/assets/mini-dungeon',sourcePack:'Kenney Mini Dungeon'},
 'kenney_furniture-kit':{author:'Kenney',license:'CC0-1.0',licenseUrl:CC0,sourceUrl:'https://kenney.nl/assets/furniture-kit',sourcePack:'Kenney Furniture Kit'},
 'kenney_mini-characters':{author:'Kenney',license:'CC0-1.0',licenseUrl:CC0,sourceUrl:'https://kenney.nl/assets/mini-characters',sourcePack:'Kenney Mini Characters'},
 'Ultimate Animated Character Pack - Nov 2019':{author:'Quaternius',license:'CC0-1.0',licenseUrl:CC0,sourceUrl:'https://quaternius.com/packs/ultimatedanimatedcharacter.html',sourcePack:'Quaternius Ultimate Animated Character Pack'},
 // 2026-10-06 (Claude Opus 5.5): Quaternius MegaKits (Standard, free edition), CC0 1.0 per each pack's License_Standard.txt; imported on the user's instruction (megakits-v1).
 'Quaternius Fantasy Props MegaKit':{author:'Quaternius',license:'CC0-1.0',licenseUrl:CC0,sourceUrl:'https://quaternius.com/packs/fantasypropsmegakit.html',sourcePack:'Quaternius Fantasy Props MegaKit'},
 'Quaternius Stylized Nature MegaKit':{author:'Quaternius',license:'CC0-1.0',licenseUrl:CC0,sourceUrl:'https://quaternius.com/packs/stylizednaturemegakit.html',sourcePack:'Quaternius Stylized Nature MegaKit'},
 'Quaternius Modular SciFi MegaKit':{author:'Quaternius',license:'CC0-1.0',licenseUrl:CC0,sourceUrl:'https://quaternius.com/packs/modularscifimegakit.html',sourcePack:'Quaternius Modular SciFi MegaKit'},
 'Quaternius Medieval Village MegaKit':{author:'Quaternius',license:'CC0-1.0',licenseUrl:CC0,sourceUrl:'https://quaternius.com/packs/medievalvillagemegakit.html',sourcePack:'Quaternius Medieval Village MegaKit'},
 // 2026-10-10 (Claude Opus 5.5): adventure-v1 — KayKit packs by Kay Lousberg (each License.txt: CC0, credit optional, www.kaylousberg.com)
 // and Quaternius Ultimate Modular Ruins (License.txt: CC0 1.0); imported on the user's instruction, licence texts copied next to the GLBs.
 'KayKit Adventurers':{author:'Kay Lousberg',license:'CC0-1.0',licenseUrl:CC0,sourceUrl:'https://www.kaylousberg.com',sourcePack:'KayKit Adventurers'},
 'KayKit Skeletons':{author:'Kay Lousberg',license:'CC0-1.0',licenseUrl:CC0,sourceUrl:'https://www.kaylousberg.com',sourcePack:'KayKit Skeletons'},
 'KayKit Medieval Hexagon Pack':{author:'Kay Lousberg',license:'CC0-1.0',licenseUrl:CC0,sourceUrl:'https://www.kaylousberg.com',sourcePack:'KayKit Medieval Hexagon Pack'},
 'KayKit Fantasy Weapons Bits':{author:'Kay Lousberg',license:'CC0-1.0',licenseUrl:CC0,sourceUrl:'https://www.kaylousberg.com',sourcePack:'KayKit Fantasy Weapons Bits'},
 'KayKit RPG Tools Bits':{author:'Kay Lousberg',license:'CC0-1.0',licenseUrl:CC0,sourceUrl:'https://www.kaylousberg.com',sourcePack:'KayKit RPG Tools Bits'},
 'KayKit Resource Bits':{author:'Kay Lousberg',license:'CC0-1.0',licenseUrl:CC0,sourceUrl:'https://www.kaylousberg.com',sourcePack:'KayKit Resource Bits'},
 'KayKit Furniture Bits':{author:'Kay Lousberg',license:'CC0-1.0',licenseUrl:CC0,sourceUrl:'https://www.kaylousberg.com',sourcePack:'KayKit Furniture Bits'},
 // 2026-10-10 (Claude Opus 5.5): bits-v1 — KayKit Bits packs. City / Restaurant / Space Base / Board Game: License.txt CC0. Holiday Bits FREE
 // ships no licence file; its itch.io page lists "Asset license: Creative Commons Zero v1.0 Universal" (snapshot saved as HOL-LICENSE.txt).
 'KayKit City Builder Bits':{author:'Kay Lousberg',license:'CC0-1.0',licenseUrl:CC0,sourceUrl:'https://www.kaylousberg.com',sourcePack:'KayKit City Builder Bits'},
 'KayKit Restaurant Bits':{author:'Kay Lousberg',license:'CC0-1.0',licenseUrl:CC0,sourceUrl:'https://www.kaylousberg.com',sourcePack:'KayKit Restaurant Bits'},
 'KayKit Space Base Bits':{author:'Kay Lousberg',license:'CC0-1.0',licenseUrl:CC0,sourceUrl:'https://www.kaylousberg.com',sourcePack:'KayKit Space Base Bits'},
 'KayKit Board Game Bits':{author:'Kay Lousberg',license:'CC0-1.0',licenseUrl:CC0,sourceUrl:'https://www.kaylousberg.com',sourcePack:'KayKit Board Game Bits'},
 'KayKit Holiday Bits':{author:'Kay Lousberg',license:'CC0-1.0',licenseUrl:CC0,sourceUrl:'https://kaylousberg.itch.io/holiday-bits',sourcePack:'KayKit Holiday Bits'},
 'Quaternius Ultimate Modular Ruins':{author:'Quaternius',license:'CC0-1.0',licenseUrl:CC0,sourceUrl:'https://quaternius.com',sourcePack:'Quaternius Ultimate Modular Ruins'},
};
export function provenanceFor(asset:{id:string;sourcePack?:string;license?:string;author?:string}):Provenance{
 if(asset.id.startsWith('DEV_'))return{author:'本專案（開發用練習模型）',license:'DEV_ONLY',licenseUrl:'',sourceUrl:'',requiresAttribution:false,attributionText:'',standaloneRedistributionAllowed:true,releasable:false};
 const pack=asset.sourcePack?packs[asset.sourcePack]:undefined;
 if(!pack)return{author:asset.author??'',license:'UNVERIFIED',licenseUrl:'',sourceUrl:'',sourcePack:asset.sourcePack,requiresAttribution:false,attributionText:'',standaloneRedistributionAllowed:false,releasable:false};
 const requiresAttribution=pack.license==='CC-BY-4.0';
 return{...pack,requiresAttribution,attributionText:requiresAttribution?pack.attributionText??`${pack.author} — CC BY 4.0（已為 Web 最佳化）`:'',
  standaloneRedistributionAllowed:pack.license==='CC0-1.0'||pack.license==='PROJECT-OWN',releasable:pack.license==='CC0-1.0'||pack.license==='CC-BY-4.0'||pack.license==='QAL-1.0'||pack.license==='ITHAPPY-FREE'||pack.license==='PROJECT-OWN'};
}
export type ProvenanceIssue='MISSING'|'LICENSE_NOT_ALLOWED'|'AUTHOR_EMPTY'|'ATTRIBUTION_EMPTY'|'LICENSE_URL_EMPTY'|'RESTRICTED_ON_PUBLIC_PATH'|'ATTRIBUTION_REQUIRED';
/** E1 (build) and E2 (server, via validAssetVersion) share this check. Returns every violation, never a boolean-only "ok". */
export function provenanceIssues(asset:{url:string;provenance?:Provenance}):ProvenanceIssue[]{
 const p=asset.provenance;if(!p)return['MISSING'];
 const issues:ProvenanceIssue[]=[];
 if(!ALLOWED_LICENSES.includes(p.license))issues.push('LICENSE_NOT_ALLOWED');
 if(!p.author.trim())issues.push('AUTHOR_EMPTY');
 if(p.license==='CC-BY-4.0'&&!p.requiresAttribution)issues.push('ATTRIBUTION_REQUIRED');
 if((p.requiresAttribution||p.license==='CC-BY-4.0')&&!p.attributionText.trim())issues.push('ATTRIBUTION_EMPTY');
 if(p.releasable&&!p.licenseUrl)issues.push('LICENSE_URL_EMPTY');
 if(!p.standaloneRedistributionAllowed&&p.license!=='UNVERIFIED'&&PUBLIC_PATHS.some(prefix=>asset.url.startsWith(prefix)))issues.push('RESTRICTED_ON_PUBLIC_PATH');
 return issues;
}
export function licenseLabel(license:License){return{'CC0-1.0':'CC0 · 無需署名','CC-BY-4.0':'CC BY 4.0 · 須署名','QAL-1.0':'Quaternius 授權 · 不得單獨再散布','ITHAPPY-FREE':'ITHappy 免費授權 · 不得單獨再散布','PROJECT-OWN':'專案自有 · 使用者自製','DEV_ONLY':'開發用練習模型','UNVERIFIED':'授權未核對（開發用）'}[license];}
/** Plain-text credits for export (credits.txt) and clipboard. Groups only identical displayed provenance; distinct sources and notices stay separate. */
export function creditsText(assets:{name:string;provenance:Provenance}[]):string{
 const groups=new Map<string,{p:Provenance;names:string[]}>();
 for(const a of assets){const p=a.provenance;const key=JSON.stringify([p.sourcePack??p.author,p.author,p.license,p.licenseUrl,p.sourceUrl,p.requiresAttribution,p.attributionText]);const g=groups.get(key)??{p:a.provenance,names:[]};g.names.push(a.name);groups.set(key,g);}
 const lines=['素材出處（Sandtray）',''];
 for(const {p,names} of groups.values()){const key=p.sourcePack??p.author;
  lines.push(`${key} — 作者：${p.author} — ${licenseLabel(p.license)}${p.licenseUrl?` — ${p.licenseUrl}`:''}${p.sourceUrl?` — ${p.sourceUrl}`:''}`);
  if(p.requiresAttribution)lines.push(`  署名：${p.attributionText}`);
  lines.push(`  物件：${names.join('、')}`);
 }
 return lines.join('\n')+'\n';
}
