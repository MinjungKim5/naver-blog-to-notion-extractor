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
  DividerBlock,
  CalloutBlock,
  BulletedListItemBlock,
  NumberedListItemBlock,
  CodeBlock,
  VideoBlock
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

        // 0. Naver Place / Map Component
        if (
          comp.hasClass('se-placesMap') || 
          comp.hasClass('se-component-placesMap') || 
          comp.hasClass('se-component-map') || 
          comp.hasClass('se-module-map') ||
          comp.find('.se-section-placesMap, .se-module-map-image, .se-map-info').length > 0
        ) {
          const mapBlocks = this.parseMapComponent($, comp, i);
          if (mapBlocks.length > 0) {
            blocks.push(...mapBlocks);
            continue;
          }
        }

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
        // 2. Quotation Component (Distinguish box/balloon callouts from quote lines)
        else if (comp.hasClass('se-component-quotation') || comp.hasClass('se-module-quotation')) {
          const quoteElem = comp.find('.se-quote-content, blockquote').first();
          const quoteText = (quoteElem.length > 0 ? quoteElem.text() : comp.text()).trim();
          const citeText = comp.find('.se-cite, cite').text().trim();

          if (quoteText) {
            const richSegments = this.extractRichText($, quoteElem.length > 0 ? quoteElem : comp);
            if (citeText) {
              richSegments.push({ text: `\n— ${citeText}`, annotations: { italic: true, color: 'gray' } });
            }

            // If box/post-it or balloon style, map to Notion Callout!
            if (comp.hasClass('se-l-quotation_box') || comp.hasClass('se-quotation-box')) {
              blocks.push({
                id: `quote_box_${i}`,
                type: 'callout',
                icon: '💡',
                content: richSegments,
              } as CalloutBlock);
            } else if (comp.hasClass('se-l-quotation_balloon') || comp.hasClass('se-quotation-balloon')) {
              blocks.push({
                id: `quote_balloon_${i}`,
                type: 'callout',
                icon: '💬',
                content: richSegments,
              } as CalloutBlock);
            } else {
              blocks.push({
                id: `quote_${i}`,
                type: 'quote',
                content: richSegments,
              } as QuoteBlock);
            }
          }
        }
        // 3. Bulleted or Numbered List Component
        else if (
          comp.hasClass('se-component-list') || 
          comp.hasClass('se-module-list') || 
          comp.find('.se-list-bullet, .se-list-number').length > 0
        ) {
          const listBlocks = this.parseListComponent($, comp, i);
          if (listBlocks.length > 0) {
            blocks.push(...listBlocks);
          }
        }
        // 4. Source Code Block Component
        else if (comp.hasClass('se-component-code') || comp.hasClass('se-module-code')) {
          const codeBlock = this.parseCodeComponent($, comp, i);
          if (codeBlock) {
            blocks.push(codeBlock);
          }
        }
        // 5. Video Component
        else if (comp.hasClass('se-component-video') || comp.hasClass('se-module-video')) {
          const videoBlock = this.parseVideoComponent($, comp, i);
          if (videoBlock) {
            blocks.push(videoBlock);
          }
        }
        // 6. Sticker / Emoticon Component
        else if (comp.hasClass('se-component-sticker') || comp.hasClass('se-module-sticker')) {
          const stickerBlock = this.parseStickerComponent($, comp, i);
          if (stickerBlock) {
            blocks.push(stickerBlock);
          }
        }
        // 7. OG Link / Bookmark Component
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
        // 8. Table Component
        else if (comp.hasClass('se-component-table') || comp.hasClass('se-module-table') || comp.find('table').length > 0) {
          const tableBlock = this.parseTableComponent($, comp, `table_${i}`);
          if (tableBlock) {
            blocks.push(tableBlock);
          }
        }
        // 9. Horizontal Rule (Divider)
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
      const headingType = this.detectHeadingType($, $line);

      if (headingType) {
        result.push({ id: `h_${headingType}_${idx}`, type: headingType, content: richSegments } as HeadingBlock);
      } else {
        result.push({ id: `p_${idx}`, type: 'paragraph', content: richSegments } as ParagraphBlock);
      }
    });

    return result;
  }

  private detectHeadingType($: cheerio.CheerioAPI, $line: cheerio.Cheerio<any>): 'heading_1' | 'heading_2' | 'heading_3' | null {
    const textContent = $line.text().trim();
    if (!textContent) return null;

    // 1. Explicit HTML heading tags or SE heading classes
    if ($line.is('h1') || $line.find('h1').length > 0 || $line.hasClass('se-fs-h1') || $line.find('.se-fs-h1').length > 0) {
      return 'heading_1';
    }
    if ($line.is('h2') || $line.find('h2').length > 0 || $line.hasClass('se-fs-h2') || $line.find('.se-fs-h2').length > 0) {
      return 'heading_2';
    }
    if ($line.is('h3') || $line.find('h3').length > 0 || $line.hasClass('se-fs-h3') || $line.find('.se-fs-h3').length > 0) {
      return 'heading_3';
    }

    // Do not convert long paragraphs (> 150 chars) into headings
    if (textContent.length > 150) {
      return null;
    }

    // 2. Scan class names and inline styles for font size
    let maxFontSizePt = 0;

    const checkElementFontSize = (el: any) => {
      const cls = $(el).attr('class') || '';
      // Matches se-fs-fs36, se-fs28, fs24, se-fs-fs19, etc.
      const fsMatch = cls.match(/(?:se-fs-fs|se-fs-|se-fs|fs-?)(\d+)/i);
      if (fsMatch) {
        const pt = parseInt(fsMatch[1], 10);
        if (pt > maxFontSizePt) maxFontSizePt = pt;
      }

      const style = $(el).attr('style') || '';
      if (style.includes('font-size')) {
        const styleMatch = style.match(/font-size:\s*(\d+(?:\.\d+)?)\s*(pt|px|rem)?/i);
        if (styleMatch) {
          const val = parseFloat(styleMatch[1]);
          const unit = (styleMatch[2] || 'px').toLowerCase();
          const pt = unit === 'pt' ? val : unit === 'rem' ? val * 12 : val * 0.75;
          if (pt > maxFontSizePt) maxFontSizePt = pt;
        }
      }
    };

    $line.each((_, el) => checkElementFontSize(el));
    $line.find('*').each((_, el) => checkElementFontSize(el));

    // Map font sizes:
    // >= 28pt (e.g. 28, 30, 36) -> Heading 1
    // 22pt ~ 27pt (e.g. 24) -> Heading 2
    // 18pt ~ 21pt (e.g. 19) -> Heading 3
    if (maxFontSizePt >= 28) return 'heading_1';
    if (maxFontSizePt >= 22) return 'heading_2';
    if (maxFontSizePt >= 18) return 'heading_3';

    return null;
  }

  private parseMapComponent($: cheerio.CheerioAPI, comp: cheerio.Cheerio<any>, index: number): UnifiedBlock[] {
    const blocks: UnifiedBlock[] = [];

    const mapTitle = comp.find('.se-map-title').text().trim();
    const mapAddress = comp.find('.se-map-address').text().trim();

    let placeId = '';
    let tel = '';
    let bookingUrl = '';
    let lat = '';
    let lng = '';

    const rawLinkData = comp.find('.se-map-info, a[data-linkdata]').attr('data-linkdata') || 
                        comp.find('script[data-module-v2]').attr('data-module-v2') || '';
    if (rawLinkData) {
      try {
        const parsed = JSON.parse(rawLinkData);
        const placeObj = parsed.places ? parsed.places[0] : parsed;
        placeId = placeObj.placeId || '';
        tel = placeObj.tel || '';
        bookingUrl = placeObj.bookingUrl || '';
        lat = placeObj.latitude || placeObj.lat || (placeObj.latlng?.latitude) || '';
        lng = placeObj.longitude || placeObj.lng || (placeObj.latlng?.longitude) || '';
      } catch {}
    }

    // Fallback: extract lat/lng from static map image URL if missing
    if (!lat || !lng) {
      const rawImgSrc = comp.find('.se-map-image, img').attr('src') || '';
      const posMatch = rawImgSrc.match(/pos(?:%3A|:)([\d.]+)(?:%20|\+|\s)([\d.]+)/);
      if (posMatch) {
        lng = posMatch[1];
        lat = posMatch[2];
      }
    }

    const placeName = mapTitle || '위치 안내';
    const placeUrl = placeId 
      ? `https://m.place.naver.com/place/${placeId}?lat=${lat}&lng=${lng}&name=${encodeURIComponent(placeName)}` 
      : `https://map.naver.com/v5/search/${encodeURIComponent(placeName + ' ' + mapAddress)}?lat=${lat}&lng=${lng}`;

    // 1. Callout Block with rich location details & machine-readable coordinates
    const calloutContent: RichTextSegment[] = [
      { text: `📍 ${placeName}`, annotations: { bold: true }, linkUrl: placeUrl },
    ];

    if (mapAddress) {
      calloutContent.push({ text: `\n🏠 주소: ${mapAddress}` });
    }
    if (tel) {
      calloutContent.push({ text: `\n📞 전화: ${tel}` });
    }
    calloutContent.push({ text: `\n👉 ` });
    calloutContent.push({ text: `네이버 지도에서 보기`, annotations: { underline: true }, linkUrl: placeUrl });

    if (bookingUrl) {
      calloutContent.push({ text: ` | ` });
      calloutContent.push({ text: `네이버 예약하기`, annotations: { underline: true }, linkUrl: bookingUrl });
    }

    blocks.push({
      id: `map_callout_${index}`,
      type: 'callout',
      icon: '🗺️',
      content: calloutContent,
    } as CalloutBlock);

    // 2. Static Map Image Preview
    const imgElem = comp.find('.se-map-image, img');
    const rawImgSrc = imgElem.attr('src') || imgElem.attr('data-src') || '';
    if (rawImgSrc && rawImgSrc.startsWith('http')) {
      let safeMapImgUrl = rawImgSrc
        .replace(/&amp;/g, '&')
        .replace(/\|/g, '%7C')
        .replace(/ /g, '%20');

      if (!safeMapImgUrl.includes('#') && !safeMapImgUrl.match(/\.(jpg|jpeg|png|webp)/i)) {
        safeMapImgUrl += '#map.jpg';
      }

      blocks.push({
        id: `map_img_${index}`,
        type: 'image',
        originalUrl: safeMapImgUrl,
        caption: `🗺️ ${placeName} 위치 지도`,
      } as ImageBlock);
    }

    return blocks;
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
        const elemClass = $(elem).attr('class') || '';
        const style = $(elem).attr('style') || '';
        const nextAnnotations = { ...currentAnnotations };
        let nextLink = currentLink;

        if (tagName === 'b' || tagName === 'strong' || elemClass.includes('se-bold')) {
          nextAnnotations.bold = true;
        }
        if (tagName === 'i' || tagName === 'em' || elemClass.includes('se-italic')) {
          nextAnnotations.italic = true;
        }
        if (tagName === 'u' || elemClass.includes('se-underline')) {
          nextAnnotations.underline = true;
        }
        if (tagName === 'strike' || tagName === 's' || elemClass.includes('se-strikethrough')) {
          nextAnnotations.strikethrough = true;
        }
        if (tagName === 'code' || elemClass.includes('se-code')) {
          nextAnnotations.code = true;
        }
        if (tagName === 'a') {
          nextLink = $(elem).attr('href');
        }

        // Highlight (Background Color)
        const highlightMatch = elemClass.match(/se-highlight-([a-z0-9_-]+)/i);
        if (highlightMatch) {
          nextAnnotations.color = `bg:${highlightMatch[1]}`;
        } else if (tagName === 'mark') {
          nextAnnotations.color = 'bg:yellow';
        } else if (style) {
          const bgMatch = style.match(/background(?:-color)?:\s*([^;]+)/i);
          if (bgMatch && !bgMatch[1].includes('transparent') && !bgMatch[1].includes('none')) {
            nextAnnotations.color = `bg:${bgMatch[1].trim()}`;
          }
        }

        // Font Color (if not already set as background)
        if (!nextAnnotations.color) {
          const colorClassMatch = elemClass.match(/se-color-([a-z0-9_-]+)/i);
          if (colorClassMatch) {
            nextAnnotations.color = colorClassMatch[1];
          } else if (style) {
            const fontColorMatch = style.match(/(?:^|;)\s*color:\s*([^;]+)/i);
            if (fontColorMatch) {
              nextAnnotations.color = fontColorMatch[1].trim();
            }
          }
        }

        if (elem.children) {
          elem.children.forEach((child: any) => traverse(child, nextAnnotations, nextLink));
        }
      }
    };

    $parent.contents().each((_: number, child: any) => traverse(child));
    return segments.length > 0 ? segments : [{ text: $parent.text() }];
  }

  private parseListComponent($: cheerio.CheerioAPI, comp: any, index: number): UnifiedBlock[] {
    const blocks: UnifiedBlock[] = [];
    const isNumbered = comp.hasClass('se-list-number') || comp.find('ol, .se-list-number').length > 0;
    const items = comp.find('li, .se-list-item');

    items.each((idx: number, item: any) => {
      const $item = $(item);
      const text = $item.text().trim();
      if (!text) return;

      const segments = this.extractRichText($, $item);
      if (isNumbered) {
        blocks.push({
          id: `ol_${index}_${idx}`,
          type: 'numbered_list_item',
          content: segments,
        } as NumberedListItemBlock);
      } else {
        blocks.push({
          id: `ul_${index}_${idx}`,
          type: 'bulleted_list_item',
          content: segments,
        } as BulletedListItemBlock);
      }
    });

    return blocks;
  }

  private parseCodeComponent($: cheerio.CheerioAPI, comp: any, index: number): UnifiedBlock | null {
    const codeElem = comp.find('code, pre, .se-code-source').first();
    const codeText = codeElem.length > 0 ? codeElem.text() : comp.text();
    if (!codeText.trim()) return null;

    let language = comp.attr('data-language') || codeElem.attr('data-language') || '';
    if (!language) {
      const cls = (comp.attr('class') || '') + ' ' + (codeElem.attr('class') || '');
      const match = cls.match(/language-([a-z0-9_+-]+)/i) || cls.match(/se-code-([a-z0-9_+-]+)/i);
      if (match) language = match[1];
    }

    return {
      id: `code_${index}`,
      type: 'code',
      code: codeText,
      language: language || undefined,
    } as CodeBlock;
  }

  private parseVideoComponent($: cheerio.CheerioAPI, comp: any, index: number): UnifiedBlock | null {
    let videoUrl = comp.find('iframe').attr('src') || '';

    // Check data-module-v2 for Naver Video
    const rawModule = comp.find('script[data-module-v2]').attr('data-module-v2') || '';
    if (rawModule) {
      try {
        const parsed = JSON.parse(rawModule);
        const data = parsed.data || parsed;
        if (data.playUrl) {
          videoUrl = data.playUrl;
        } else if (data.vid && data.inkey) {
          videoUrl = `https://serviceapi.rmcnmv.naver.com/flash/outKeyPlayer.nhn?vid=${data.vid}&outKey=${data.inkey}`;
        }
      } catch {}
    }

    if (!videoUrl) {
      videoUrl = comp.find('a').attr('href') || '';
    }

    if (videoUrl && videoUrl.startsWith('//')) {
      videoUrl = 'https:' + videoUrl;
    }

    if (videoUrl && videoUrl.startsWith('http')) {
      const caption = comp.find('.se-caption, .se-video-title').text().trim();
      return {
        id: `video_${index}`,
        type: 'video',
        url: videoUrl,
        caption: caption || undefined,
      } as VideoBlock;
    }

    return null;
  }

  private parseStickerComponent($: cheerio.CheerioAPI, comp: any, index: number): UnifiedBlock | null {
    const imgElem = comp.find('.se-sticker-image, img').first();
    const src = imgElem.attr('src') || imgElem.attr('data-src') || '';
    if (src && src.startsWith('http')) {
      return {
        id: `sticker_${index}`,
        type: 'image',
        originalUrl: src,
        caption: '스티커',
      } as ImageBlock;
    }
    return null;
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
