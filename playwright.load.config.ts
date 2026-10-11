import {defineConfig} from '@playwright/test';
import base from './playwright.runtime.config';
export default defineConfig({...base,testDir:'tests/load',testIgnore:/endurance/,timeout:180000,outputDir:'test-results-load'});
