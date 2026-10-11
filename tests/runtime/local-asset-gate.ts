import {existsSync} from 'node:fs';

const enabledValues=new Set(['1','true','on']);
const disabledValues=new Set(['0','false','off']);

export function parseRequireLocalAssetsMode(value:string|undefined):boolean{
 const normalized=value?.trim().toLowerCase()??'';
 if(!normalized)return false;
 if(enabledValues.has(normalized))return true;
 if(disabledValues.has(normalized))return false;
 throw new Error('INVALID_REQUIRE_LOCAL_ASSETS: use 1/true/on to require fixtures or 0/false/off to allow explicit skips.');
}

export function missingLocalAssetReason(assetPath:string,description:string,value=process.env.REQUIRE_LOCAL_ASSETS):string|undefined{
 const required=parseRequireLocalAssetsMode(value);
 if(existsSync(assetPath))return undefined;
 const missing='ENV_MISSING_ASSET: required '+description+' is absent; generate and SHA-256-verify it before rerunning.';
 if(required)throw new Error(missing+' REQUIRE_LOCAL_ASSETS enables required-fixture mode and forbids skipping.');
 return missing+' This is SKIPPED/NOT_RUN, not PASS.';
}
// R1-P2 (Claude Opus 5.5 2026-09-27): unit tests that read gitignored asset bytes gate on every path they open, so a clean
// checkout reports SKIPPED/NOT_RUN with the reason instead of ENOENT, while REQUIRE_LOCAL_ASSETS=1 still fails loud.
export function missingLocalAssetsReason(assetPaths:Iterable<string>,description:string,value=process.env.REQUIRE_LOCAL_ASSETS):string|undefined{
 for(const assetPath of assetPaths){const reason=missingLocalAssetReason(assetPath,description+' ('+assetPath+')',value);if(reason)return reason;}
 return undefined;
}
