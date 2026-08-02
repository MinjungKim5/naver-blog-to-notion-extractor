import { NaverCrawlerService } from '../crawler/naver-crawler.service.js';
import { NaverParserService } from '../parser/naver-parser.service.js';
import { NotionExporterService } from '../notion/notion-exporter.service.js';

export interface BatchOptions {
  blogUrlOrId: string;
  notionDatabaseUrlOrId: string;
  count?: number; // Number of posts per batch, default 5
  pageNum?: number; // Page number
}

export interface BatchResultItem {
  logNo: string;
  title: string;
  sourceUrl: string;
  notionPageId?: string;
  notionPageUrl?: string;
  status: 'SUCCESS' | 'FAILED';
  error?: string;
}

export interface BatchProcessResult {
  totalProcessed: number;
  successCount: number;
  failureCount: number;
  items: BatchResultItem[];
}

export class BatchProcessorService {
  private crawlerService: NaverCrawlerService;
  private parserService: NaverParserService;
  private notionExporterService: NotionExporterService;

  constructor() {
    this.crawlerService = new NaverCrawlerService();
    this.parserService = new NaverParserService();
    this.notionExporterService = new NotionExporterService();
  }

  public async runBatch(options: BatchOptions): Promise<BatchProcessResult> {
    const count = options.count || 5;
    const pageNum = options.pageNum || 1;

    console.log(`\n📦 Starting batch extraction: ${options.blogUrlOrId} (Limit: ${count} posts, Page: ${pageNum})...`);

    // 1. Fetch post list
    const postList = await this.crawlerService.fetchBlogPostList(options.blogUrlOrId, count, pageNum);
    console.log(`📋 Found ${postList.length} posts to process.\n`);

    const resultItems: BatchResultItem[] = [];
    let successCount = 0;
    let failureCount = 0;

    // 2. Process each post sequentially
    for (let i = 0; i < postList.length; i++) {
      const item = postList[i];
      console.log(`[${i + 1}/${postList.length}] Processing: "${item.title}" (${item.url})...`);

      try {
        const rawData = await this.crawlerService.fetchPostRawData(item.url);
        const doc = await this.parserService.parseRawDataToUnifiedDocument(rawData);

        const exported = await this.notionExporterService.exportToNotion(doc, {
          parentPageId: options.notionDatabaseUrlOrId,
        });

        console.log(`  ✅ Notion Page Created: ${exported.pageUrl}`);

        resultItems.push({
          logNo: item.logNo,
          title: item.title,
          sourceUrl: item.url,
          notionPageId: exported.pageId,
          notionPageUrl: exported.pageUrl,
          status: 'SUCCESS',
        });
        successCount++;
      } catch (err: any) {
        console.error(`  ❌ Failed to process post ${item.url}:`, err?.message || err);
        resultItems.push({
          logNo: item.logNo,
          title: item.title,
          sourceUrl: item.url,
          status: 'FAILED',
          error: err?.message || String(err),
        });
        failureCount++;
      }
    }

    console.log(`\n🎉 Batch processing finished! Success: ${successCount}, Failed: ${failureCount}\n`);

    return {
      totalProcessed: postList.length,
      successCount,
      failureCount,
      items: resultItems,
    };
  }
}
