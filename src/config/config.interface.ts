export interface AppCredentials {
  notionApiKey?: string;
  notionParentPageId?: string;
  naverNidAut?: string;
  naverNidSes?: string;
}

export interface AppConfig {
  credentials: AppCredentials;
  storageDir: string;
  headless: boolean;
  timeout: number;
}
