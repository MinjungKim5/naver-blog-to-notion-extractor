import { chromium, Browser, BrowserContext, Page } from 'playwright';
import { ConfigService } from '../../config/config.service.js';

export interface NaverRawPostData {
  title: string;
  category: string;
  publishedAt: string;
  author: string;
  sourceUrl: string;
  blogId: string;
  logNo: string;
  tags: string[];
  mainContainerHtml: string;
}

export class NaverCrawlerService {
  private configService: ConfigService;

  constructor() {
    this.configService = ConfigService.getInstance();
  }

  public extractBlogIdAndLogNo(url: string): { blogId: string; logNo: string } {
    const parsed = new URL(url);
    
    // Pattern 1: https://blog.naver.com/{blogId}/{logNo}
    const pathParts = parsed.pathname.split('/').filter(Boolean);
    if (pathParts.length >= 2 && !parsed.pathname.includes('PostView')) {
      return { blogId: pathParts[0], logNo: pathParts[1] };
    }

    // Pattern 2: https://blog.naver.com/PostView.naver?blogId={blogId}&logNo={logNo}
    const blogId = parsed.searchParams.get('blogId') || '';
    const logNo = parsed.searchParams.get('logNo') || '';
    if (blogId && logNo) {
      return { blogId, logNo };
    }

    // Pattern 3: m.blog.naver.com/{blogId}/{logNo}
    if (parsed.hostname.startsWith('m.blog.naver.com') && pathParts.length >= 2) {
      return { blogId: pathParts[0], logNo: pathParts[1] };
    }

    throw new Error(`Invalid Naver Blog URL: ${url}`);
  }

  public async fetchBlogPostList(blogIdOrUrl: string, count: number = 5, pageNum: number = 1): Promise<Array<{ logNo: string; title: string; url: string }>> {
    let blogId = blogIdOrUrl.trim();
    if (blogIdOrUrl.includes('blog.naver.com')) {
      const parts = blogIdOrUrl.split('/').filter(Boolean);
      blogId = parts[parts.length - 1] || parts[parts.length - 2];
      if (blogId.includes('?')) {
        const u = new URL(blogIdOrUrl);
        blogId = u.searchParams.get('blogId') || blogId;
      }
    }

    const listApiUrl = `https://blog.naver.com/PostTitleListAsync.naver?blogId=${blogId}&viewdate=&currentPage=${pageNum}&categoryNo=&parentCategoryNo=&countPerPage=${count}`;

    try {
      const response = await fetch(listApiUrl, {
        headers: {
          'Referer': `https://blog.naver.com/${blogId}`,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        },
      });

      const text = await response.text();
      // Naver returns JSON formatted with single quotes or raw escaped JSON
      const cleanJson = text.replace(/\\'/g, "'");
      const json = JSON.parse(cleanJson);

      const postList = json.postList || [];
      return postList.map((item: any) => ({
        logNo: String(item.logNo),
        title: decodeURIComponent(item.title || '').replace(/\+/g, ' '),
        url: `https://blog.naver.com/${blogId}/${item.logNo}`,
      }));
    } catch (err) {
      console.warn('Failed to fetch post list via API, falling back to Playwright dom scraping');
      return this.fetchBlogPostListFallback(blogId, count);
    }
  }

  private async fetchBlogPostListFallback(blogId: string, count: number): Promise<Array<{ logNo: string; title: string; url: string }>> {
    const config = this.configService.getConfig();
    const browser = await chromium.launch({ headless: config.headless });
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
      await page.goto(`https://blog.naver.com/${blogId}`, { waitUntil: 'domcontentloaded' });
      const mainFrame = page.frame({ name: 'mainFrame' }) || page;

      const links = await mainFrame.locator('a[href*="logNo="], a[href*="/' + blogId + '/"]').all();
      const results: Array<{ logNo: string; title: string; url: string }> = [];
      const seenLogNos = new Set<string>();

      for (const link of links) {
        if (results.length >= count) break;
        const href = await link.getAttribute('href') || '';
        const title = (await link.innerText()).trim();

        const logNoMatch = href.match(/logNo=(\d+)/) || href.match(new RegExp(`${blogId}/(\\d+)`));
        if (logNoMatch && logNoMatch[1] && !seenLogNos.has(logNoMatch[1]) && title) {
          const logNo = logNoMatch[1];
          seenLogNos.add(logNo);
          results.push({
            logNo,
            title,
            url: `https://blog.naver.com/${blogId}/${logNo}`,
          });
        }
      }

      return results;
    } finally {
      await browser.close();
    }
  }


  public async fetchPostRawData(targetUrl: string): Promise<NaverRawPostData> {
    const { blogId, logNo } = this.extractBlogIdAndLogNo(targetUrl);
    const directViewUrl = `https://m.blog.naver.com/${blogId}/${logNo}`;

    const config = this.configService.getConfig();
    const browser: Browser = await chromium.launch({
      headless: config.headless,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
      ],
    });

    const context: BrowserContext = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 900 },
      extraHTTPHeaders: {
        'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
      },
    });

    // Inject Naver Login Cookies if provided
    const cookies = this.configService.getNaverCookies();
    if (cookies.length > 0) {
      await context.addCookies(cookies);
    }

    const page: Page = await context.newPage();

    // Anti-bot stealth init script
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined,
      });
    });

    try {
      await page.goto(directViewUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 15000,
      });

      // Wait for actual SmartEditor ONE content components to render
      await page.waitForSelector(
        '.se-main-container .se-component, .se-main-container .se-module, .se-text-paragraph, #postViewArea', 
        { timeout: 15000 }
      ).catch(() => {
        console.warn('SmartEditor components timeout, proceeding with current DOM state');
      });

      // Brief wait to allow image lazy-loading & JS text mounting
      await page.waitForTimeout(1000);

      // Extract metadata
      const title = await page.title().then(t => t.replace(' : 네이버 블로그', '').trim()).catch(() => '');
      
      const category = await page.locator('.blog2_series, .category_name, .category').first().innerText().catch(() => '');
      const publishedAt = await page.locator('.se_publishDate, .blog_date, .date').first().innerText().catch(() => '');
      const author = await page.locator('.nick_name, .link_author').first().innerText().catch(() => '');

      // Comprehensive Naver Blog Tags Extraction across Desktop/Mobile/SmartEditor
      const rawTagTexts = await page.locator(
        '.wrap_tag a, .tag_area a, .post_tag a, .se-tag a, .item_tag, .tag_item, a[href*="BlogTagList.naver"], a[href*="tag.naver.com"], #tagList a, .se-component-tag a, .tag_list a'
      ).allInnerTexts().catch(() => []);

      const tags = Array.from(
        new Set(
          rawTagTexts
            .map(t => t.replace(/^#/, '').trim())
            .filter(t => t.length > 0 && !t.includes('네이버') && !t.includes('이웃추가') && !t.includes('취소') && !t.includes('확인') && !t.includes('화면'))
        )
      );

      // Get main post content HTML
      let mainContainerHtml = '';
      const seContainer = page.locator('.se-main-container').first();
      if (await seContainer.count() > 0 && (await seContainer.innerHTML()).length > 100) {
        mainContainerHtml = await seContainer.innerHTML();
      } else {
        const bodyContent = page.locator('#postViewArea, .se_doc_viewer, body').first();
        mainContainerHtml = await bodyContent.innerHTML();
      }

      return {
        title,
        category: category.trim(),
        publishedAt: publishedAt.trim(),
        author: author.trim(),
        sourceUrl: targetUrl,
        blogId,
        logNo,
        tags: tags.map(t => t.replace('#', '').trim()).filter(Boolean),
        mainContainerHtml,
      };

    } finally {
      await context.close();
      await browser.close();
    }

  }
}
