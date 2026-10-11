import {defineConfig} from '@playwright/test';
import base from './playwright.config';
export default defineConfig({...base,testDir:'tests/capacity',timeout:600000,reporter:'list',outputDir:'test-results-capacity'});
