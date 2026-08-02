import express, { Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { ConfigService } from '../../config/config.service.js';
import { NaverCrawlerService } from '../crawler/naver-crawler.service.js';
import { NaverParserService } from '../parser/naver-parser.service.js';
import { NotionExporterService } from '../notion/notion-exporter.service.js';
import { BatchProcessorService } from '../batch/batch-processor.service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// SSE Client type
interface SseClient {
  id: number;
  res: Response;
}

export class WebServer {
  private app = express();
  private clients: SseClient[] = [];
  private clientIdCounter = 0;
  private port: number;

  constructor(port = 3105) {
    this.port = port;
    this.setupMiddleware();
    this.setupRoutes();
  }

  private setupMiddleware() {
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));
    
    // Serve static frontend files
    const publicPath = path.join(__dirname, 'public');
    if (!fs.existsSync(publicPath)) {
      fs.mkdirSync(publicPath, { recursive: true });
    }
    this.app.use(express.static(publicPath));
  }

  private broadcastLog(level: 'info' | 'success' | 'warn' | 'error', message: string, data?: any) {
    const logItem = {
      timestamp: new Date().toLocaleTimeString(),
      level,
      message,
      data,
    };
    const payload = `data: ${JSON.stringify(logItem)}\n\n`;

    this.clients.forEach((client) => {
      client.res.write(payload);
    });
  }

  private setupRoutes() {
    // SSE Stream for real-time logs
    this.app.get('/api/stream', (req: Request, res: Response) => {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders();

      const clientId = ++this.clientIdCounter;
      const newClient: SseClient = { id: clientId, res };
      this.clients.push(newClient);

      this.broadcastLog('info', '🟢 Client connected to log stream');

      req.on('close', () => {
        this.clients = this.clients.filter((c) => c.id !== clientId);
      });
    });

    // Get Current Configuration
    this.app.get('/api/config', (_req: Request, res: Response) => {
      const config = ConfigService.getInstance().getConfig();
      const creds = config.credentials;

      const mask = (str?: string) => {
        if (!str) return '';
        if (str.length <= 8) return '********';
        return `${str.substring(0, 4)}...${str.substring(str.length - 4)}`;
      };

      res.json({
        configured: {
          notionApiKey: Boolean(creds.notionApiKey),
          notionParentPageId: Boolean(creds.notionParentPageId),
          naverNidAut: Boolean(creds.naverNidAut),
          naverNidSes: Boolean(creds.naverNidSes),
        },
        masked: {
          notionApiKey: mask(creds.notionApiKey),
          notionParentPageId: creds.notionParentPageId || '',
          naverNidAut: mask(creds.naverNidAut),
          naverNidSes: mask(creds.naverNidSes),
        },
        raw: {
          notionApiKey: creds.notionApiKey || '',
          notionParentPageId: creds.notionParentPageId || '',
          naverNidAut: creds.naverNidAut || '',
          naverNidSes: creds.naverNidSes || '',
        }
      });
    });

    // Update Configuration
    this.app.post('/api/config', (req: Request, res: Response) => {
      const { notionApiKey, notionParentPageId, naverNidAut, naverNidSes } = req.body;
      
      const configService = ConfigService.getInstance();
      configService.saveCredentials({
        ...(notionApiKey !== undefined && { notionApiKey }),
        ...(notionParentPageId !== undefined && { notionParentPageId }),
        ...(naverNidAut !== undefined && { naverNidAut }),
        ...(naverNidSes !== undefined && { naverNidSes }),
      });

      this.broadcastLog('success', '⚙️ Credentials updated and saved to config.json');
      res.json({ success: true, message: 'Settings saved successfully' });
    });

    // Single Post Extraction API
    this.app.post('/api/extract/single', async (req: Request, res: Response) => {
      const { url, exportToNotion } = req.body;

      if (!url) {
        res.status(400).json({ error: 'URL is required' });
        return;
      }

      this.broadcastLog('info', `🚀 Starting Single Post Extraction for: ${url}`);

      try {
        const crawler = new NaverCrawlerService();
        const parser = new NaverParserService();

        this.broadcastLog('info', '🔍 Crawling Naver Blog page...');
        const rawData = await crawler.fetchPostRawData(url);
        this.broadcastLog('success', `✅ Extracted title: "${rawData.title}" [Category: ${rawData.category || 'None'}]`);

        this.broadcastLog('info', '📊 Parsing HTML to Unified Document Model...');
        const doc = await parser.parseRawDataToUnifiedDocument(rawData);
        this.broadcastLog('success', `✅ Document parsed. Total blocks: ${doc.blocks.length}`);

        let notionResult = null;
        if (exportToNotion) {
          this.broadcastLog('info', '📤 Exporting Unified Document to Notion...');
          const exporter = new NotionExporterService();
          notionResult = await exporter.exportToNotion(doc);
          this.broadcastLog('success', `🎉 Notion Export Complete! Page ID: ${notionResult.pageId}`);
        }

        res.json({
          success: true,
          post: {
            title: doc.title,
            category: doc.category,
            author: doc.author,
            publishDate: doc.publishedAt,
            url: doc.sourceUrl,
            blocksCount: doc.blocks.length,
          },
          notion: notionResult,
        });
      } catch (err: any) {
        const errMsg = err.message || String(err);
        this.broadcastLog('error', `❌ Single Extraction Failed: ${errMsg}`);
        res.status(500).json({ error: errMsg });
      }
    });

    // Batch Extraction API
    this.app.post('/api/extract/batch', async (req: Request, res: Response) => {
      const { blogUrlOrId, notionDatabaseUrlOrId, count = 5, pageNum = 1 } = req.body;

      if (!blogUrlOrId) {
        res.status(400).json({ error: 'blogUrlOrId is required' });
        return;
      }

      const dbTarget = notionDatabaseUrlOrId || ConfigService.getInstance().getConfig().credentials.notionParentPageId;
      if (!dbTarget) {
        res.status(400).json({ error: 'Notion Database/Page ID is required' });
        return;
      }

      this.broadcastLog('info', `🚀 Starting Batch Extraction for Blog: ${blogUrlOrId} (Count: ${count}, Page: ${pageNum})`);

      try {
        const batchProcessor = new BatchProcessorService();
        
        await batchProcessor.runBatch({
          blogUrlOrId,
          notionDatabaseUrlOrId: dbTarget,
          count: Number(count),
          pageNum: Number(pageNum),
        });

        this.broadcastLog('success', `🎉 Batch Extraction Finished Successfully!`);
        res.json({ success: true, message: 'Batch extraction completed' });
      } catch (err: any) {
        const errMsg = err.message || String(err);
        this.broadcastLog('error', `❌ Batch Extraction Failed: ${errMsg}`);
        res.status(500).json({ error: errMsg });
      }
    });
  }

  public async start(): Promise<number> {
    return new Promise((resolve) => {
      this.app.listen(this.port, () => {
        console.log(`\n==================================================`);
        console.log(`🌐 Blog Extractor Web UI is running at: http://localhost:${this.port}`);
        console.log(`==================================================\n`);
        resolve(this.port);
      });
    });
  }
}
