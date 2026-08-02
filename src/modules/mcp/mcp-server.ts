import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { ConfigService } from '../../config/config.service.js';
import { NaverCrawlerService } from '../crawler/naver-crawler.service.js';
import { NaverParserService } from '../parser/naver-parser.service.js';
import { NotionExporterService } from '../notion/notion-exporter.service.js';
import { BatchProcessorService } from '../batch/batch-processor.service.js';

export class NaverBlogMcpServer {
  private server: Server;
  private configService: ConfigService;
  private crawlerService: NaverCrawlerService;
  private parserService: NaverParserService;
  private notionExporterService: NotionExporterService;
  private batchProcessorService: BatchProcessorService;

  constructor() {
    this.configService = ConfigService.getInstance();
    this.crawlerService = new NaverCrawlerService();
    this.parserService = new NaverParserService();
    this.notionExporterService = new NotionExporterService();
    this.batchProcessorService = new BatchProcessorService();

    this.server = new Server(
      {
        name: 'naver-blog-extractor',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupHandlers();
  }

  private setupHandlers(): void {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'extract_naver_blog',
          description: 'Extract raw text, structure, and images from a Naver Blog post URL into Unified JSON format.',
          inputSchema: {
            type: 'object',
            properties: {
              url: { type: 'string', description: 'Naver blog post URL' },
            },
            required: ['url'],
          },
        },
        {
          name: 'export_naver_blog_to_notion',
          description: 'Extract Naver blog post and export as a structured Notion page.',
          inputSchema: {
            type: 'object',
            properties: {
              url: { type: 'string', description: 'Naver blog post URL' },
              notionParentPageId: { type: 'string', description: 'Target Notion Page or Database ID/URL' },
              notionApiKey: { type: 'string', description: 'Optional Notion Integration API Key' },
            },
            required: ['url'],
          },
        },
        {
          name: 'batch_export_naver_blog_to_notion_db',
          description: 'Batch extract recent posts from a Naver Blog and populate a Notion Database in batches (default 5 posts).',
          inputSchema: {
            type: 'object',
            properties: {
              blogUrlOrId: { type: 'string', description: 'Naver Blog main URL or Blog ID' },
              notionDatabaseUrlOrId: { type: 'string', description: 'Notion Database URL or ID' },
              count: { type: 'number', description: 'Number of posts to extract per batch (default: 5)' },
              pageNum: { type: 'number', description: 'Page number for list pagination (default: 1)' },
            },
            required: ['blogUrlOrId', 'notionDatabaseUrlOrId'],
          },
        },
        {
          name: 'set_credentials',
          description: 'Set or update Naver login cookies and Notion Integration keys dynamically.',
          inputSchema: {
            type: 'object',
            properties: {
              notionApiKey: { type: 'string' },
              notionParentPageId: { type: 'string' },
              naverNidAut: { type: 'string', description: 'NID_AUT cookie value' },
              naverNidSes: { type: 'string', description: 'NID_SES cookie value' },
            },
          },
        },
      ],
    }));

    // Handle tool call
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        if (name === 'set_credentials') {
          this.configService.setCredentials(args as any);
          return {
            content: [{ type: 'text', text: 'Credentials updated successfully.' }],
          };
        }

        if (name === 'extract_naver_blog') {
          const url = (args as any).url;
          const rawData = await this.crawlerService.fetchPostRawData(url);
          const doc = await this.parserService.parseRawDataToUnifiedDocument(rawData);
          return {
            content: [{ type: 'text', text: JSON.stringify(doc, null, 2) }],
          };
        }

        if (name === 'export_naver_blog_to_notion') {
          const url = (args as any).url;
          const rawData = await this.crawlerService.fetchPostRawData(url);
          const doc = await this.parserService.parseRawDataToUnifiedDocument(rawData);

          const result = await this.notionExporterService.exportToNotion(doc, {
            parentPageId: (args as any).notionParentPageId,
            apiKey: (args as any).notionApiKey,
          });

          return {
            content: [
              {
                type: 'text',
                text: `Successfully exported to Notion!\nPage ID: ${result.pageId}\nPage URL: ${result.pageUrl}`,
              },
            ],
          };
        }

        if (name === 'batch_export_naver_blog_to_notion_db') {
          const blogUrlOrId = (args as any).blogUrlOrId;
          const notionDatabaseUrlOrId = (args as any).notionDatabaseUrlOrId;
          const count = Number((args as any).count) || 5;
          const pageNum = Number((args as any).pageNum) || 1;

          const batchResult = await this.batchProcessorService.runBatch({
            blogUrlOrId,
            notionDatabaseUrlOrId,
            count,
            pageNum,
          });

          return {
            content: [{ type: 'text', text: JSON.stringify(batchResult, null, 2) }],
          };
        }

        throw new Error(`Unknown tool: ${name}`);
      } catch (error: any) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Error executing tool ${name}: ${error?.message || error}` }],
        };
      }
    });
  }

  public async startStdio(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Naver Blog Extractor MCP Server running on stdio');
  }
}
