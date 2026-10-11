import {test,expect} from '@playwright/test';
import {budget} from './budget';
// 2026-10-10 garden-visual-v4: the user-adopted 草叢與花木 switch adds 'vegetation' to the visual-only key set (still no sound / room data).
test('opt-in visual preferences survive reload while exploration and audio stay off',async({page})=>{
 test.setTimeout(budget(90000));await page.goto('/');await page.getByRole('button',{name:'走進自然庭園'}).click();
 await page.getByLabel('庭園光照').selectOption('sunset');await page.getByLabel('庭園霧氣').uncheck();await page.getByLabel('庭園陰影').uncheck();await page.getByLabel('庭園音量').fill('0.6');
 await page.getByLabel('在這台裝置記住庭園設定').check();await page.reload();await expect(page.getByRole('button',{name:'走進自然庭園'})).toBeVisible();await expect(page.getByTestId('explore-status')).toHaveCount(0);await page.getByRole('button',{name:'走進自然庭園'}).click();
 await expect(page.getByLabel('庭園光照')).toHaveValue('sunset');await expect(page.getByLabel('庭園霧氣')).not.toBeChecked();await expect(page.getByLabel('庭園陰影')).not.toBeChecked();await expect(page.getByLabel('庭園音量')).toHaveValue('0.6');await expect(page.getByRole('button',{name:'開啟環境音'})).toBeVisible();await expect(page.getByLabel('在這台裝置記住庭園設定')).toBeChecked();
 const stored=await page.evaluate(()=>JSON.parse(localStorage.getItem('sandtray.garden.preferences.v1')!));expect(Object.keys(stored.preferences).sort()).toEqual(['fog','lanterns','mood','quality','reflections','shadows','vegetation','volume']);
 await page.getByLabel('在這台裝置記住庭園設定').uncheck();await page.reload();await page.getByRole('button',{name:'走進自然庭園'}).click();await expect(page.getByLabel('庭園光照')).toHaveValue('day');await expect(page.getByLabel('庭園霧氣')).toBeChecked();await expect(page.getByLabel('庭園音量')).toHaveValue('0.25');
});
test('blocked preference storage leaves the current lighting controls usable',async({page})=>{
 await page.addInitScript(()=>{Storage.prototype.setItem=function(){throw new Error('blocked');};Storage.prototype.getItem=function(){throw new Error('blocked');};});
 await page.goto('/');await page.getByRole('button',{name:'走進自然庭園'}).click();await page.getByLabel('在這台裝置記住庭園設定').check();await expect(page.getByRole('status').filter({hasText:'無法記住設定'})).toBeVisible();await page.getByLabel('庭園光照').selectOption('evening');await expect(page.getByLabel('庭園光照')).toHaveValue('evening');
});
