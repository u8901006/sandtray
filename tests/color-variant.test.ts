import {describe,it,expect} from 'vitest';
import Ajv2020 from 'ajv/dist/2020';
import {readFileSync} from 'node:fs';
import {colorVariantHex,colorVariantSchema,parseInbound,sceneSchema} from '../packages/protocol/src/index';
import {resolveAsset,supportsColorVariants,colorVariantOriginal,ORIGINAL_SKIN_LINEAR,COLOR_VARIANT_ASSET_IDS} from '../packages/asset-catalog/src/index';
import {Group,Mesh,BoxGeometry,MeshStandardMaterial} from 'three';
import {applyColorVariant} from '../apps/web/src/catalog-model';

describe('REQ-019 color variants',()=>{
 it('accepts all seven variants and rejects unknown protocol values',()=>{
  for(const variant of ['t1','t2','t3','t4','t5','t6','orig'] as const){
   expect(colorVariantSchema.safeParse(variant).success).toBe(true);
   const command={protocolVersion:1,operationId:'appearance-'+variant,sessionEpoch:1,controlEpoch:1,type:'object.appearance.commit',objectId:'o',expectedObjectRevision:0,materialOverrides:{},colorVariant:variant,hidden:false};
   expect(parseInbound(JSON.stringify(command))).toEqual(command);
  }
  expect(()=>parseInbound(JSON.stringify({protocolVersion:1,operationId:'bad',sessionEpoch:1,controlEpoch:1,type:'object.appearance.commit',objectId:'o',expectedObjectRevision:0,materialOverrides:{},colorVariant:'purple',hidden:false}))).toThrow();
 });
 it('keeps legacy snapshots valid when colorVariant is absent',()=>{
  const legacy={schemaVersion:1,sceneId:'scene',sceneRevision:0,objects:[{id:'o',assetId:'DEV_ROCK',assetVersion:'dev-v1',transform:{position:[0,0,0],rotation:[0,0,0,1],scale:1},materialOverrides:{},hidden:false,revision:0}],environment:{sandColor:'#deceac',backgroundColor:'#e9e5db'},updatedAt:0};
  expect(sceneSchema.parse(legacy).objects[0].colorVariant).toBeUndefined();
 });
 it('uses an explicit allow-list rather than Skin presence alone',()=>{
  const approved=resolveAsset('IMP_ULTIMATE_Casual_Male');
  const unapproved=resolveAsset('IMP_ULTIMATE_Cow');
  expect(approved&&supportsColorVariants(approved.id,approved.version)).toBe(true);
  expect(unapproved&&supportsColorVariants(unapproved.id,unapproved.version)).toBe(false);
  expect(supportsColorVariants('IMP_ULTIMATE_Casual_Male','wrong-version')).toBe(false);
 });
 it('records the original linear Skin factor for every approved character',()=>{
  expect(COLOR_VARIANT_ASSET_IDS).toHaveLength(12);
  for(const id of COLOR_VARIANT_ASSET_IDS){
   const asset=resolveAsset(id);
   expect(asset).toBeTruthy();
   expect(asset&&colorVariantOriginal(asset.id,asset.version)).toEqual(ORIGINAL_SKIN_LINEAR);
  }
 });
 it('applies orig as the catalog linear factor even when the loaded clone is t2',()=>{
  const group=new Group();const material=new MeshStandardMaterial({color:'#E8BE9A'});material.name='Skin';
  group.add(new Mesh(new BoxGeometry(1,1,1),material));
  applyColorVariant(group,'orig',ORIGINAL_SKIN_LINEAR);
  expect(material.color.r).toBeCloseTo(ORIGINAL_SKIN_LINEAR[0],12);
  expect(material.color.g).toBeCloseTo(ORIGINAL_SKIN_LINEAR[1],12);
  expect(material.color.b).toBeCloseTo(ORIGINAL_SKIN_LINEAR[2],12);
 });
 it('publishes the user-approved sRGB palette',()=>{
  expect(colorVariantHex).toEqual({t1:'#F6DCC6',t2:'#E8BE9A',t3:'#D4A27C',t4:'#B7835C',t5:'#8A5A3C',t6:'#5A3A28'});
 });
 it('generated inbound JSON contract exposes colorVariant on create and appearance',()=>{
  const schema=JSON.parse(readFileSync('specs/001-sandtray/contracts/ws-inbound.schema.json','utf8')) as any;
  const ajv=new Ajv2020({strict:false});const validate=ajv.compile(schema);
  const base={protocolVersion:1,operationId:'op',sessionEpoch:1,controlEpoch:1};
  expect(validate({...base,type:'object.create',objectId:'o',assetId:'IMP_ULTIMATE_Casual_Male',assetVersion:resolveAsset('IMP_ULTIMATE_Casual_Male')!.version,transform:{position:[0,0,0],rotation:[0,0,0,1],scale:1},colorVariant:'t2'})).toBe(true);
  expect(validate({...base,type:'object.appearance.commit',objectId:'o',expectedObjectRevision:0,materialOverrides:{},hidden:false,colorVariant:'orig'})).toBe(true);
 });
});
