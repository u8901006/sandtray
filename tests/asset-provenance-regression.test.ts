import {it,expect} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {Credits} from '../apps/web/src/credits';
import {resolveAsset,provenanceIssues,validAssetVersion,creditsText,type CatalogAsset} from '../packages/asset-catalog/src/index';

function pair():CatalogAsset[]{
 return ['one','two'].map((id,i)=>({...structuredClone(resolveAsset('IMP_ARENA_banner')!),id,name:`Model ${id}`,
  provenance:{author:'Same author',license:'CC-BY-4.0',licenseUrl:'https://creativecommons.org/licenses/by/4.0/',sourceUrl:`https://example.com/${id}`,sourcePack:'Shared pack',requiresAttribution:true,attributionText:`Model ${id} by Same author (modified ${i})`,standaloneRedistributionAllowed:true,releasable:true}}));
}
it('CC-BY cannot opt out of attribution through its boolean flag',()=>{
 const asset=resolveAsset('IMP_ARENA_banner')!;const saved=asset.provenance;
 try{asset.provenance={...pair()[0].provenance,requiresAttribution:false,attributionText:''};
  expect(provenanceIssues(asset).length).toBeGreaterThan(0);expect(validAssetVersion(asset.id,asset.version)).toBe(false);
 }finally{asset.provenance=saved;}
});
it('credits text preserves distinct source and modification notices within one pack or author',()=>{
 for(const withPack of [true,false]){const assets=pair();if(!withPack)for(const a of assets)delete a.provenance.sourcePack;
  const text=creditsText(assets);for(const a of assets){expect(text).toContain(a.provenance.sourceUrl);expect(text).toContain(a.provenance.attributionText);}
 }
});
it('credits text does not merge different authors or licenses in a shared pack',()=>{
 const assets=pair();assets[1].provenance={...assets[1].provenance,author:'Second author',license:'CC0-1.0',requiresAttribution:false,attributionText:'',licenseUrl:'https://creativecommons.org/publicdomain/zero/1.0/'};
 const text=creditsText(assets);expect(text).toContain('Second author');expect(text).toContain('CC0');expect(text).toContain('CC BY 4.0');
});
it('expanded credits render the source and attribution of every asset in a shared pack',()=>{
 const assets=pair();const html=renderToStaticMarkup(createElement(Credits,{assets}));
 for(const a of assets){expect(html).toContain(a.provenance.sourceUrl);expect(html).toContain(a.provenance.attributionText);}
});