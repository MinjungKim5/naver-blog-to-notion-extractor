import { NaverBlogMcpServer } from './modules/mcp/mcp-server.js';
import { NaverCrawlerService } from './modules/crawler/naver-crawler.service.js';
import { NaverParserService } from './modules/parser/naver-parser.service.js';
import { NotionExporterService } from './modules/notion/notion-exporter.service.js';
import { BatchProcessorService } from './modules/batch/batch-processor.service.js';

async function main() {
  const args = process.argv.slice(2);

  // If run with --mcp flag or stdin pipe, start MCP server
  if (args.includes('--mcp')) {
    const mcpServer = new NaverBlogMcpServer();
    await mcpServer.startStdio();
    return;
  }

  // Batch Execution Command Mode:
  // npm run dev batch <BLOG_URL_OR_ID> [NOTION_DB_URL_OR_ID] [--count 5] [--page 1]
  if (args[0] === 'batch' || args.includes('--batch')) {
    const blogUrlOrId = args.find(a => !a.startsWith('-') && a !== 'batch' && (a.includes('blog.naver.com') || !a.includes('notion.so')));
    let notionDbUrlOrId = args.find(a => !a.startsWith('-') && a !== 'batch' && a !== blogUrlOrId);

    // Fallback to .env config if NOTION_PARENT_PAGE_ID is set
    if (!notionDbUrlOrId) {
      const configService = (await import('./config/config.service.js')).ConfigService.getInstance();
      notionDbUrlOrId = configService.getConfig().credentials.notionParentPageId;
    }

    const countIdx = args.indexOf('--count');
    const count = countIdx !== -1 && args[countIdx + 1] ? Number(args[countIdx + 1]) : 5;

    const pageIdx = args.indexOf('--page');
    const pageNum = pageIdx !== -1 && args[pageIdx + 1] ? Number(args[pageIdx + 1]) : 1;

    if (!blogUrlOrId || !notionDbUrlOrId) {
      console.log(`
❌ Usage for Batch Mode:
  npm run dev batch <BLOG_URL_OR_ID> [NOTION_DB_URL_OR_ID] [--count 5] [--page 1]

Example:
  npm run dev batch https://blog.naver.com/myblogid --count 5
  (if NOTION_PARENT_PAGE_ID is set in .env)
`);
      return;
    }

    const batchProcessor = new BatchProcessorService();
    await batchProcessor.runBatch({
      blogUrlOrId,
      notionDatabaseUrlOrId: notionDbUrlOrId,
      count,
      pageNum,
    });
    return;
  }


  // If run with 'web' argument, '--ui' flag, or no arguments, launch Web UI server
  if (args.length === 0 || args.includes('web') || args.includes('--ui')) {
    const { WebServer } = await import('./modules/web/web-server.js');
    const { exec } = await import('child_process');

    const webServer = new WebServer(3000);
    const port = await webServer.start();
    const targetUrl = `http://localhost:${port}`;

    // Auto open browser
    const startCmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
    exec(`${startCmd} ${targetUrl}`, (err) => {
      if (err) {
        console.log(`💡 Please open your browser and navigate to: ${targetUrl}`);
      }
    });
    return;
  }

  // Single URL Extraction CLI Mode
  const urlArg = args.find(a => a.startsWith('http'));
  if (!urlArg) {
    console.log(`
================================================================
 📝 Naver Blog Extractor Studio
================================================================

Usage:
  1. Web UI Mode (Recommended - Interactive Input Screen):
     npm run dev
     npm run dev web

  2. Single Post Extractor:
     npm run dev <NAVER_BLOG_SINGLE_POST_URL> [--notion]

  3. Batch Extractor:
     npm run dev batch <BLOG_ID_OR_URL> <NOTION_DB_URL_OR_ID> [--count 5] [--page 1]

  4. MCP Server Mode:
     npm run dev -- --mcp
`);
    return;
  }

  console.log(`🔍 Crawling Naver Blog: ${urlArg}...`);
  const crawler = new NaverCrawlerService();
  const parser = new NaverParserService();

  const rawData = await crawler.fetchPostRawData(urlArg);
  console.log(`✅ Extracted post: [${rawData.category || 'No Category'}] ${rawData.title}`);

  const doc = await parser.parseRawDataToUnifiedDocument(rawData);
  console.log(`📊 Unified Document parsed. Total blocks: ${doc.blocks.length}`);

  if (args.includes('--notion')) {
    console.log('🚀 Exporting to Notion...');
    const exporter = new NotionExporterService();
    const result = await exporter.exportToNotion(doc);
    console.log(`🎉 Successfully exported!`);
    console.log(`   Page ID : ${result.pageId}`);
    console.log(`   Page URL: ${result.pageUrl}`);
  } else {
    console.log('\n--- Unified Document Sample ---');
    console.log(JSON.stringify(doc, null, 2));
  }
}

main().catch((err) => {
  console.error('Fatal Error:', err);
  process.exit(1);
});
