import { Client } from '@notionhq/client';
import { ConfigService } from '../../config/config.service.js';
import { UnifiedDocument, UnifiedBlock, RichTextSegment } from '../../schema/document.schema.js';

export class NotionExporterService {
  private configService: ConfigService;

  constructor() {
    this.configService = ConfigService.getInstance();
  }

  private getNotionClient(overrideApiKey?: string): Client {
    const apiKey = overrideApiKey || this.configService.getConfig().credentials.notionApiKey;
    if (!apiKey) {
      throw new Error('Notion API Key is missing. Please set NOTION_API_KEY in .env or config.');
    }
    return new Client({ auth: apiKey });
  }

  public parseNotionId(urlOrId: string): string {
    if (!urlOrId) return '';
    const clean = urlOrId.trim();

    // 1. Check for standard 36-char hyphenated UUID
    const uuidWithHyphensMatch = clean.match(/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i);
    if (uuidWithHyphensMatch) {
      return uuidWithHyphensMatch[1].toLowerCase();
    }

    // 2. Check for 32-char hex string (common in Notion URLs like app.notion.com/p/3a51bce929b680ce9a37f8ac039e0...)
    const hex32Match = clean.match(/([a-f0-9]{32})/i);
    if (hex32Match) {
      const hex = hex32Match[1].toLowerCase();
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    }

    // 3. Fallback: Strip hyphens and check if length is 32
    const rawDigits = clean.replace(/[^a-f0-9]/gi, '');
    if (rawDigits.length >= 32) {
      const hex = rawDigits.slice(-32).toLowerCase();
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    }

    return clean;
  }


  public async exportToNotion(doc: UnifiedDocument, options?: { parentPageId?: string; apiKey?: string }): Promise<{ pageId: string; pageUrl: string }> {
    const client = this.getNotionClient(options?.apiKey);
    const rawParentId = options?.parentPageId || this.configService.getConfig().credentials.notionParentPageId;

    if (!rawParentId) {
      throw new Error('Notion Parent Page / Database ID is missing. Please provide parentPageId.');
    }

    const parentId = this.parseNotionId(rawParentId);
    const notionBlocks = this.convertUnifiedBlocksToNotionBlocks(doc.blocks);

    let isDatabase = false;
    let titleProp = { name: 'title', type: 'title' };
    let dateProp: { name: string; type: string } | null = null;
    let categoryProp: { name: string; type: string } | null = null;
    let urlProp: { name: string; type: string } | null = null;
    let authorProp: { name: string; type: string } | null = null;
    let tagProp: { name: string; type: string } | null = null;
    let publishProp: { name: string; type: string } | null = null;

    // 1. Inspect Target: Check if parentId is a Database or a Page
    try {
      const dbInfo: any = await client.databases.retrieve({ database_id: parentId });
      isDatabase = true;

      const props = dbInfo.properties || {};
      for (const [propName, propConfig] of Object.entries(props)) {
        const type = (propConfig as any)?.type;
        const nameLower = propName.toLowerCase();

        if (type === 'title') {
          titleProp = { name: propName, type: 'title' };
        } else if (type === 'date' || nameLower.includes('게시일') || nameLower.includes('날짜') || nameLower.includes('date')) {
          dateProp = { name: propName, type };
        } else if (type === 'select' || type === 'multi_select' || nameLower.includes('카테고리') || nameLower.includes('category')) {
          categoryProp = { name: propName, type };
        } else if (type === 'url' || nameLower.includes('url') || nameLower.includes('링크') || nameLower.includes('link')) {
          urlProp = { name: propName, type };
        } else if (nameLower.includes('작성자') || nameLower.includes('author')) {
          authorProp = { name: propName, type };
        } else if (type === 'checkbox' || nameLower === '발행' || nameLower.includes('publish')) {
          publishProp = { name: propName, type };
        } else if (type === 'multi_select' || nameLower.includes('태그') || nameLower.includes('tag')) {
          tagProp = { name: propName, type };
        }
      }

      // Auto-create missing DB columns in Notion if missing
      const missingPropsToCreate: Record<string, any> = {};
      if (!dateProp) {
        missingPropsToCreate['게시일'] = { date: {} };
        dateProp = { name: '게시일', type: 'date' };
      }
      if (!categoryProp) {
        missingPropsToCreate['카테고리'] = { select: {} };
        categoryProp = { name: '카테고리', type: 'select' };
      }
      if (!urlProp) {
        missingPropsToCreate['원문링크'] = { url: {} };
        urlProp = { name: '원문링크', type: 'url' };
      }
      if (!authorProp) {
        missingPropsToCreate['작성자'] = { rich_text: {} };
        authorProp = { name: '작성자', type: 'rich_text' };
      }
      if (!publishProp) {
        missingPropsToCreate['발행'] = { checkbox: {} };
        publishProp = { name: '발행', type: 'checkbox' };
      }
      if (!tagProp) {
        missingPropsToCreate['태그'] = { multi_select: {} };
        tagProp = { name: '태그', type: 'multi_select' };
      }

      if (Object.keys(missingPropsToCreate).length > 0) {
        try {
          await client.databases.update({
            database_id: parentId,
            properties: missingPropsToCreate,
          });
          console.log(`  ✨ Added missing metadata columns to Notion Database: ${Object.keys(missingPropsToCreate).join(', ')}`);
        } catch (updateErr: any) {
          console.warn(`  ⚠️ Could not auto-add DB columns:`, updateErr?.message || updateErr);
        }
      }
    } catch (err: any) {
      // Target is a Notion Page
      isDatabase = false;
    }

    let response: any;

    try {
      if (isDatabase) {
        // Target is a Notion Database
        const properties: any = {
          [titleProp.name]: {
            title: [
              {
                type: 'text',
                text: { content: doc.title || 'Untitled Naver Blog Post' },
              },
            ],
          },
        };

        if (publishProp) {
          properties[publishProp.name] = { checkbox: true }; // Default: Checked (True) for immediate publication
        }

        if (tagProp && doc.tags && doc.tags.length > 0) {
          const cleanTags = doc.tags
            .map(t => t.replace(/^#/, '').trim())
            .filter(Boolean)
            .slice(0, 10);
          if (cleanTags.length > 0) {
            properties[tagProp.name] = {
              multi_select: cleanTags.map(t => ({ name: t }))
            };
          }
        }

        if (dateProp && doc.publishedAt) {
          const formattedDate = this.formatNotionDate(doc.publishedAt);
          if (formattedDate) {
            properties[dateProp.name] = { date: { start: formattedDate } };
          }
        }

        if (categoryProp && doc.category) {
          const catName = doc.category.replace(/,/g, ' ').trim();
          if (categoryProp.type === 'select') {
            properties[categoryProp.name] = { select: { name: catName } };
          } else {
            properties[categoryProp.name] = { rich_text: [{ type: 'text', text: { content: catName } }] };
          }
        }

        if (urlProp && doc.sourceUrl) {
          properties[urlProp.name] = { url: doc.sourceUrl };
        }

        if (authorProp && doc.author) {
          properties[authorProp.name] = { rich_text: [{ type: 'text', text: { content: doc.author } }] };
        }

        response = await client.pages.create({
          parent: { database_id: parentId },
          properties,
        });
      } else {
        // Target is a Notion Page
        response = await client.pages.create({
          parent: { page_id: parentId },
          properties: {
            title: {
              title: [
                {
                  type: 'text',
                  text: { content: doc.title || 'Untitled Naver Blog Post' },
                },
              ],
            },
          },
        });
      }
    } catch (createErr: any) {
      if (createErr?.code === 'object_not_found') {
        throw new Error(
          `Notion API object_not_found (${parentId}):\n` +
          `1. Check if NOTION_API_KEY in .env belongs to the same Workspace.\n` +
          `2. Check if the Integration "노션토큰" is added via '...' (Top Right) -> 'Add Connections' on the target page/database.\n` +
          `3. Make sure you copied the main Database/Page URL.`
        );
      }
      throw createErr;
    }

    const pageId = response.id;
    const pageUrl = (response as any).url || `https://notion.so/${pageId.replace(/-/g, '')}`;

    // 2. Explicitly append content blocks into the page in batches of 100
    if (notionBlocks.length > 0) {
      console.log(`  📄 Appending ${notionBlocks.length} body blocks to Notion page...`);
      for (let i = 0; i < notionBlocks.length; i += 100) {
        const batch = notionBlocks.slice(i, i + 100);
        try {
          await client.blocks.children.append({
            block_id: pageId,
            children: batch as any,
          });
        } catch (appendErr: any) {
          console.warn(`  ⚠️ Warning: Failed to append block batch (${i}~${i + batch.length}):`, appendErr?.message || appendErr);
        }
      }
    }

    return { pageId, pageUrl };
  }




  private convertUnifiedBlocksToNotionBlocks(blocks: UnifiedBlock[]): any[] {
    const notionBlocks: any[] = [];

    for (const block of blocks) {
      switch (block.type) {
        case 'heading_1':
          notionBlocks.push({
            object: 'block',
            type: 'heading_1',
            heading_1: { rich_text: this.toNotionRichText(block.content) },
          });
          break;

        case 'heading_2':
          notionBlocks.push({
            object: 'block',
            type: 'heading_2',
            heading_2: { rich_text: this.toNotionRichText(block.content) },
          });
          break;

        case 'heading_3':
          notionBlocks.push({
            object: 'block',
            type: 'heading_3',
            heading_3: { rich_text: this.toNotionRichText(block.content) },
          });
          break;

        case 'paragraph':
          notionBlocks.push({
            object: 'block',
            type: 'paragraph',
            paragraph: { rich_text: this.toNotionRichText(block.content) },
          });
          break;

        case 'quote':
          notionBlocks.push({
            object: 'block',
            type: 'quote',
            quote: { rich_text: this.toNotionRichText(block.content) },
          });
          break;

        case 'bookmark':
          notionBlocks.push({
            object: 'block',
            type: 'bookmark',
            bookmark: { url: block.url },
          });
          break;

        case 'image':
          if (block.originalUrl.startsWith('http')) {
            notionBlocks.push({
              object: 'block',
              type: 'image',
              image: {
                type: 'external',
                external: { url: block.originalUrl },
                caption: block.caption ? [{ type: 'text', text: { content: block.caption } }] : [],
              },
            });
          }
          break;

        case 'divider':
          notionBlocks.push({
            object: 'block',
            type: 'divider',
            divider: {},
          });
          break;

        case 'table':
          const tableRows = block.rows.map(row => ({
            type: 'table_row',
            table_row: {
              cells: row.cells.map(cell => this.toNotionRichText(cell)),
            },
          }));

          notionBlocks.push({
            object: 'block',
            type: 'table',
            table: {
              table_width: block.rows[0]?.cells.length || 1,
              has_column_header: block.hasColumnHeader || false,
              children: tableRows,
            },
          });
          break;
      }
    }

    return notionBlocks;
  }

  private toNotionRichText(segments: RichTextSegment[]): any[] {
    const valid = segments.filter(seg => seg.text && seg.text.length > 0);

    if (valid.length === 0) {
      return [{ type: 'text', text: { content: ' ' } }];
    }

    return valid.map(seg => {
      // Notion API limits single text content to 2000 chars
      const content = seg.text.length > 2000 ? seg.text.slice(0, 2000) : seg.text;
      return {
        type: 'text',
        text: {
          content,
          link: seg.linkUrl && seg.linkUrl.startsWith('http') ? { url: seg.linkUrl } : null,
        },
        annotations: {
          bold: seg.annotations?.bold || false,
          italic: seg.annotations?.italic || false,
          strikethrough: seg.annotations?.strikethrough || false,
          underline: seg.annotations?.underline || false,
          code: seg.annotations?.code || false,
          color: 'default',
        },
      };
    });
  }

  private formatNotionDate(dateStr?: string): string | null {
    if (!dateStr) return null;
    const match = dateStr.match(/(\d{4})[\.\s\-]+(\d{1,2})[\.\s\-]+(\d{1,2})/);
    if (match) {
      const yyyy = match[1];
      const mm = match[2].padStart(2, '0');
      const dd = match[3].padStart(2, '0');
      return `${yyyy}-${mm}-${dd}`;
    }
    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) {
      return d.toISOString().split('T')[0];
    }
    return null;
  }
}
