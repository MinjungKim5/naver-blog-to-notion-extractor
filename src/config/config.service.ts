import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { AppConfig, AppCredentials } from './config.interface.js';

export class ConfigService {
  private static instance: ConfigService;
  private config: AppConfig;

  private constructor() {
    dotenv.config();
    this.config = this.loadInitialConfig();
  }

  public static getInstance(): ConfigService {
    if (!ConfigService.instance) {
      ConfigService.instance = new ConfigService();
    }
    return ConfigService.instance;
  }

  private loadInitialConfig(): AppConfig {
    let jsonConfig: Partial<AppCredentials> = {};
    const configJsonPath = path.resolve(process.cwd(), 'config.json');

    if (fs.existsSync(configJsonPath)) {
      try {
        const raw = fs.readFileSync(configJsonPath, 'utf-8');
        jsonConfig = JSON.parse(raw);
      } catch (err) {
        console.warn('Failed to parse config.json, fallback to env vars');
      }
    }

    return {
      credentials: {
        notionApiKey: process.env.NOTION_API_KEY || jsonConfig.notionApiKey || '',
        notionParentPageId: process.env.NOTION_PARENT_PAGE_ID || jsonConfig.notionParentPageId || '',
        naverNidAut: process.env.NAVER_NID_AUT || jsonConfig.naverNidAut || '',
        naverNidSes: process.env.NAVER_NID_SES || jsonConfig.naverNidSes || '',
      },
      storageDir: process.env.STORAGE_DIR || './storage',
      headless: process.env.HEADLESS !== 'false',
      timeout: Number(process.env.TIMEOUT) || 30000,
    };
  }

  public getConfig(): AppConfig {
    return this.config;
  }

  public setCredentials(credentials: Partial<AppCredentials>): void {
    this.config.credentials = {
      ...this.config.credentials,
      ...credentials,
    };
  }

  public saveCredentials(credentials: Partial<AppCredentials>): void {
    this.setCredentials(credentials);

    // Also update process.env for runtime modules
    if (credentials.notionApiKey !== undefined) process.env.NOTION_API_KEY = credentials.notionApiKey;
    if (credentials.notionParentPageId !== undefined) process.env.NOTION_PARENT_PAGE_ID = credentials.notionParentPageId;
    if (credentials.naverNidAut !== undefined) process.env.NAVER_NID_AUT = credentials.naverNidAut;
    if (credentials.naverNidSes !== undefined) process.env.NAVER_NID_SES = credentials.naverNidSes;

    const configJsonPath = path.resolve(process.cwd(), 'config.json');
    try {
      let existingConfig: Record<string, any> = {};
      if (fs.existsSync(configJsonPath)) {
        const raw = fs.readFileSync(configJsonPath, 'utf-8');
        existingConfig = JSON.parse(raw);
      }
      const updated = {
        ...existingConfig,
        ...this.config.credentials,
      };
      fs.writeFileSync(configJsonPath, JSON.stringify(updated, null, 2), 'utf-8');
    } catch (err) {
      console.error('Failed to save config.json:', err);
    }
  }

  public getNaverCookies(): Array<{ name: string; value: string; domain: string; path: string }> {
    const cookies = [];
    if (this.config.credentials.naverNidAut) {
      cookies.push({
        name: 'NID_AUT',
        value: this.config.credentials.naverNidAut,
        domain: '.naver.com',
        path: '/',
      });
    }
    if (this.config.credentials.naverNidSes) {
      cookies.push({
        name: 'NID_SES',
        value: this.config.credentials.naverNidSes,
        domain: '.naver.com',
        path: '/',
      });
    }
    return cookies;
  }
}
