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

        case 'callout':
          notionBlocks.push({
            object: 'block',
            type: 'callout',
            callout: {
              rich_text: this.toNotionRichText(block.content),
              icon: block.icon ? { type: 'emoji', emoji: block.icon as any } : { type: 'emoji', emoji: '📍' },
            },
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
            // Ensure URL is properly encoded without invalid characters like raw pipes or spaces
            const safeUrl = block.originalUrl
              .replace(/&amp;/g, '&')
              .replace(/\|/g, '%7C')
              .replace(/ /g, '%20');

            notionBlocks.push({
              object: 'block',
              type: 'image',
              image: {
                type: 'external',
                external: { url: safeUrl },
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

        case 'bulleted_list_item':
          notionBlocks.push({
            object: 'block',
            type: 'bulleted_list_item',
            bulleted_list_item: { rich_text: this.toNotionRichText(block.content) },
          });
          break;

        case 'numbered_list_item':
          notionBlocks.push({
            object: 'block',
            type: 'numbered_list_item',
            numbered_list_item: { rich_text: this.toNotionRichText(block.content) },
          });
          break;

        case 'code':
          notionBlocks.push({
            object: 'block',
            type: 'code',
            code: {
              rich_text: [{ type: 'text', text: { content: (block.code || '').slice(0, 2000) } }],
              language: this.normalizeNotionLanguage(block.language),
            },
          });
          break;

        case 'video':
          if (block.url && block.url.startsWith('http')) {
            notionBlocks.push({
              object: 'block',
              type: 'video',
              video: {
                type: 'external',
                external: { url: block.url },
                caption: block.caption ? [{ type: 'text', text: { content: block.caption } }] : [],
              },
            });
          }
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
          color: this.mapToNotionColor(seg.annotations?.color),
        },
      };
    });
  }

  private mapToNotionColor(rawColor?: string): any {
    if (!rawColor) return 'default';
    const c = rawColor.trim().toLowerCase();

    // Check for explicit background requests
    const isBackground = c.includes('bg:') || c.includes('background') || c.includes('highlight');
    const cleanColor = c.replace(/^bg:/, '').replace(/_background$/, '').replace(/^highlight[-_]?/, '').trim();

    const colorName = this.detectColorName(cleanColor);
    if (!colorName) return 'default';

    return isBackground ? `${colorName}_background` : colorName;
  }

  private detectColorName(c: string): string | null {
    if (c.includes('red') || c.includes('crimson') || c.includes('salmon')) return 'red';
    if (c.includes('orange') || c.includes('coral')) return 'orange';
    if (c.includes('yellow') || c.includes('gold')) return 'yellow';
    if (c.includes('green') || c.includes('lime') || c.includes('teal')) return 'green';
    if (c.includes('blue') || c.includes('cyan') || c.includes('sky') || c.includes('navy')) return 'blue';
    if (c.includes('purple') || c.includes('violet') || c.includes('indigo') || c.includes('magenta')) return 'purple';
    if (c.includes('pink') || c.includes('rose')) return 'pink';
    if (c.includes('brown')) return 'brown';
    if (c.includes('gray') || c.includes('grey') || c.includes('silver')) return 'gray';

    // Parse RGB or Hex
    let r = 0, g = 0, b = 0;
    const rgbMatch = c.match(/rgb\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/);
    if (rgbMatch) {
      r = parseInt(rgbMatch[1], 10);
      g = parseInt(rgbMatch[2], 10);
      b = parseInt(rgbMatch[3], 10);
    } else {
      const hexMatch = c.match(/#([0-9a-f]{6}|[0-9a-f]{3})/i);
      if (hexMatch) {
        let hex = hexMatch[1];
        if (hex.length === 3) {
          hex = hex.split('').map(x => x + x).join('');
        }
        r = parseInt(hex.slice(0, 2), 16);
        g = parseInt(hex.slice(2, 4), 16);
        b = parseInt(hex.slice(4, 6), 16);
      } else {
        return null;
      }
    }

    // Grayscale threshold
    const diffRG = Math.abs(r - g);
    const diffGB = Math.abs(g - b);
    const diffRB = Math.abs(r - b);
    if (diffRG < 30 && diffGB < 30 && diffRB < 30) {
      if (r < 60) return 'default';
      return 'gray';
    }

    // Dominant hues
    if (r > g && r > b) {
      if (g > 140 && b < 100) return 'yellow';
      if (g > 70 && b < 70) return 'orange';
      if (b > 110) return 'pink';
      return 'red';
    }
    if (g > r && g > b) {
      if (r > 140) return 'yellow';
      if (b > 140) return 'blue';
      return 'green';
    }
    if (b > r && b > g) {
      if (r > 120) return 'purple';
      return 'blue';
    }

    return null;
  }

  private normalizeNotionLanguage(lang?: string): any {
    if (!lang) return 'plain text';
    const l = lang.trim().toLowerCase();
    const supported = [
      'abap', 'arduino', 'bash', 'basic', 'c', 'clojure', 'coffeescript', 'c++', 'c#', 'css', 
      'dart', 'diff', 'docker', 'elixir', 'elm', 'erlang', 'flow', 'fortran', 'f#', 'gherkin', 
      'glsl', 'go', 'graphql', 'groovy', 'haskell', 'html', 'java', 'javascript', 'json', 
      'julia', 'kotlin', 'latex', 'less', 'lisp', 'livescript', 'lua', 'makefile', 'markdown', 
      'markup', 'matlab', 'mermaid', 'nix', 'objective-c', 'ocaml', 'pascal', 'perl', 'php', 
      'plain text', 'powershell', 'prolog', 'protobuf', 'python', 'r', 'reason', 'ruby', 'rust', 
      'sass', 'scala', 'scheme', 'scss', 'shell', 'sql', 'swift', 'typescript', 'vb.net', 
      'verilog', 'vhdl', 'visual basic', 'webassembly', 'xml', 'yaml'
    ];
    if (supported.includes(l)) return l;
    if (l === 'js') return 'javascript';
    if (l === 'ts') return 'typescript';
    if (l === 'py') return 'python';
    if (l === 'sh') return 'shell';
    if (l === 'yml') return 'yaml';
    return 'plain text';
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
