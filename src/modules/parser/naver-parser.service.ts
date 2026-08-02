import * as cheerio from 'cheerio';
import { NaverRawPostData } from '../crawler/naver-crawler.service.js';
import { ImageDownloaderService } from '../image/image-downloader.service.js';
import { 
  UnifiedDocument, 
  UnifiedBlock, 
  RichTextSegment, 
  TextAnnotations,
  HeadingBlock,
  ParagraphBlock,
  ImageBlock,
  QuoteBlock,
  BookmarkBlock,
  TableBlock,
  TableRow,
  DividerBlock
} from '../../schema/document.schema.js';


export class NaverParserService {
  private imageDownloader: ImageDownloaderService;

  constructor() {
    this.imageDownloader = new ImageDownloaderService();
  }

  public async parseRawDataToUnifiedDocument(rawData: NaverRawPostData): Promise<UnifiedDocument> {
    const $ = cheerio.load(rawData.mainContainerHtml);
    const blocks: UnifiedBlock[] = [];

    let components = $('.se-component');
    
    // Fallback: If no .se-component elements, search for .se-module or content containers
    if (components.length === 0) {
      components = $('.se-module, .se_doc_viewer, #postViewArea');
    }

    if (components.length === 0) {
      // General HTML fallback
      const fallbackBlocks = await this.parseFallbackHtml($, rawData.blogId, rawData.logNo);
      blocks.push(...fallbackBlocks);
    } else {
      let imageIndex = 0;

      for (let i = 0; i < components.length; i++) {
        const comp = $(components[i]);

        // 1. Explicit Image Component / Image Strip / Gallery / Image Module
        if (
          comp.hasClass('se-component-image') || 
          comp.hasClass('se-component-imageStrip') || 
          comp.hasClass('se-component-gallery') || 
          comp.hasClass('se-module-image')
        ) {
          const imgElems = comp.find('img');
          for (let j = 0; j < imgElems.length; j++) {
            const imgElem = $(imgElems[j]);
            const rawSrc = imgElem.attr('data-lazy-src') || imgElem.attr('data-src') || imgElem.attr('data-originalurl') || imgElem.attr('src') || '';
            if (rawSrc && !rawSrc.includes('static.naver') && !rawSrc.includes('blank.gif') && !rawSrc.includes('transparent.gif')) {
              const caption = comp.find('.se-caption').text().trim();
              const cleanOriginalUrl = this.imageDownloader.normalizeNaverImageUrl(rawSrc);

              // Fire & forget local image download so extraction completes instantly
              this.imageDownloader.downloadImage(
                cleanOriginalUrl,
                rawData.blogId,
                rawData.logNo,
                imageIndex++
              ).catch(() => {});

              const imageBlock: ImageBlock = {
                id: `img_${i}_${j}`,
                type: 'image',
                originalUrl: cleanOriginalUrl,
                caption: caption || undefined,
              };
              blocks.push(imageBlock);
            }
          }
        }
        // 2. Quotation Component
        else if (comp.hasClass('se-component-quotation') || comp.hasClass('se-module-quotation')) {
          const quoteText = comp.find('.se-quote-content, blockquote').text().trim();
          if (quoteText) {
            const quoteBlock: QuoteBlock = {
              id: `quote_${i}`,
              type: 'quote',
              content: [{ text: quoteText }],
            };
            blocks.push(quoteBlock);
          }
        }
        // 3. OG Link / Bookmark Component
        else if (comp.hasClass('se-component-oglink') || comp.hasClass('se-module-oglink')) {
          const linkElem = comp.find('a.se-oglink-info').first();
          const url = linkElem.attr('href') || comp.find('a').attr('href') || '';
          if (url) {
            const title = comp.find('.se-oglink-title').text().trim();
            const description = comp.find('.se-oglink-summary').text().trim();
            const thumbSrc = comp.find('.se-oglink-thumbnail img').attr('src');

            const bookmarkBlock: BookmarkBlock = {
              id: `og_${i}`,
              type: 'bookmark',
              url,
              title: title || undefined,
              description: description || undefined,
              thumbnailUrl: thumbSrc || undefined,
            };
            blocks.push(bookmarkBlock);
          }
        }
        // 4. Table Component
        else if (comp.hasClass('se-component-table') || comp.hasClass('se-module-table') || comp.find('table').length > 0) {
          const tableBlock = this.parseTableComponent($, comp, `table_${i}`);
          if (tableBlock) {
            blocks.push(tableBlock);
          }
        }
        // 5. Horizontal Rule (Divider)
        else if (comp.hasClass('se-component-hr') || comp.hasClass('se-module-hr')) {
          const dividerBlock: DividerBlock = {
            id: `hr_${i}`,
            type: 'divider',
          };
          blocks.push(dividerBlock);
        }
        // 6. Text Component or Mixed Component
        else {
          // Extract any embedded images first
          const imgElems = comp.find('img');
          for (let j = 0; j < imgElems.length; j++) {
            const imgElem = $(imgElems[j]);
            const rawSrc = imgElem.attr('data-lazy-src') || imgElem.attr('data-src') || imgElem.attr('data-originalurl') || imgElem.attr('src') || '';
            if (rawSrc && !rawSrc.includes('static.naver') && !rawSrc.includes('blank.gif') && !rawSrc.includes('transparent.gif')) {
              const cleanOriginalUrl = this.imageDownloader.normalizeNaverImageUrl(rawSrc);

              this.imageDownloader.downloadImage(
                cleanOriginalUrl,
                rawData.blogId,
                rawData.logNo,
                imageIndex++
              ).catch(() => {});

              const imageBlock: ImageBlock = {
                id: `img_${i}_${j}`,
                type: 'image',
                originalUrl: cleanOriginalUrl,
              };
              blocks.push(imageBlock);
            }
          }

          // Extract text paragraphs
          if (comp.hasClass('se-component-text') || comp.hasClass('se-module-text') || comp.find('.se-text-paragraph').length > 0) {
            const parsedTextBlocks = this.parseTextComponent($, comp);
            blocks.push(...parsedTextBlocks);
          }
        }
      }
    }


    return {
      title: rawData.title,
      category: rawData.category,
      publishedAt: rawData.publishedAt,
      author: rawData.author,
      sourceUrl: rawData.sourceUrl,
      blogId: rawData.blogId,
      logNo: rawData.logNo,
      tags: rawData.tags,
      blocks,
    };
  }

  private parseTextComponent($: cheerio.CheerioAPI, comp: any): UnifiedBlock[] {
    const result: UnifiedBlock[] = [];
    const textLines = comp.find('.se-text-paragraph');

    textLines.each((idx: number, lineElem: any) => {
      const $line = $(lineElem);
      const textContent = $line.text().trim();
      if (!textContent) return;

      const richSegments = this.extractRichText($, $line);

      // Check Heading tag (se-fs-h1, h2, h3 or font size class)
      const isH1 = $line.find('.se-fs-h1, h1').length > 0;
      const isH2 = $line.find('.se-fs-h2, h2').length > 0;
      const isH3 = $line.find('.se-fs-h3, h3').length > 0;

      if (isH1) {
        result.push({ id: `h1_${idx}`, type: 'heading_1', content: richSegments } as HeadingBlock);
      } else if (isH2) {
        result.push({ id: `h2_${idx}`, type: 'heading_2', content: richSegments } as HeadingBlock);
      } else if (isH3) {
        result.push({ id: `h3_${idx}`, type: 'heading_3', content: richSegments } as HeadingBlock);
      } else {
        result.push({ id: `p_${idx}`, type: 'paragraph', content: richSegments } as ParagraphBlock);
      }
    });

    return result;
  }

  private extractRichText($: cheerio.CheerioAPI, $parent: any): RichTextSegment[] {
    const segments: RichTextSegment[] = [];

    const traverse = (node: any, currentAnnotations: TextAnnotations = {}, currentLink?: string) => {
      if (node.type === 'text') {
        const text = node.data || '';
        if (text) {
          segments.push({
            text,
            annotations: Object.keys(currentAnnotations).length > 0 ? { ...currentAnnotations } : undefined,
            linkUrl: currentLink,
          });
        }
        return;
      }

      if (node.type === 'tag') {
        const elem = node;
        const tagName = elem.tagName?.toLowerCase() || '';
        const nextAnnotations = { ...currentAnnotations };
        let nextLink = currentLink;

        if (tagName === 'b' || tagName === 'strong' || $(elem).hasClass('se-bold')) {
          nextAnnotations.bold = true;
        }
        if (tagName === 'i' || tagName === 'em' || $(elem).hasClass('se-italic')) {
          nextAnnotations.italic = true;
        }
        if (tagName === 'u' || $(elem).hasClass('se-underline')) {
          nextAnnotations.underline = true;
        }
        if (tagName === 'strike' || tagName === 's' || $(elem).hasClass('se-strikethrough')) {
          nextAnnotations.strikethrough = true;
        }
        if (tagName === 'a') {
          nextLink = $(elem).attr('href');
        }

        const colorStyle = $(elem).css('color') || $(elem).attr('color');
        if (colorStyle) {
          nextAnnotations.color = colorStyle;
        }

        if (elem.children) {
          elem.children.forEach((child: any) => traverse(child, nextAnnotations, nextLink));
        }
      }
    };

    $parent.contents().each((_: number, child: any) => traverse(child));
    return segments.length > 0 ? segments : [{ text: $parent.text() }];
  }

  private parseTableComponent($: cheerio.CheerioAPI, comp: any, id: string): TableBlock | null {
    const rows: TableRow[] = [];
    const tableElem = comp.find('table').first();

    if (tableElem.length === 0) return null;

    tableElem.find('tr').each((_: number, trElem: any) => {
      const cells: RichTextSegment[][] = [];
      $(trElem).find('td, th').each((_: number, tdElem: any) => {
        const cellText = $(tdElem).text().trim();
        cells.push([{ text: cellText }]);
      });
      if (cells.length > 0) {
        rows.push({ cells });
      }
    });

    if (rows.length === 0) return null;

    return {
      id,
      type: 'table',
      hasColumnHeader: tableElem.find('th').length > 0,
      rows,
    };
  }


  private async parseFallbackHtml($: cheerio.CheerioAPI, blogId: string, logNo: string): Promise<UnifiedBlock[]> {
    const blocks: UnifiedBlock[] = [];
    const text = $.text().trim();
    if (text) {
      blocks.push({
        id: 'p_fallback_0',
        type: 'paragraph',
        content: [{ text }],
      });
    }
    return blocks;
  }
}
