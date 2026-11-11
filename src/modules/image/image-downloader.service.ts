import fs from 'fs';
import path from 'path';
import { ConfigService } from '../../config/config.service.js';

export class ImageDownloaderService {
  private configService: ConfigService;

  constructor() {
    this.configService = ConfigService.getInstance();
  }

  public normalizeNaverImageUrl(url: string): string {
    if (!url) return '';

    // If it's a Naver Static Map API URL, preserve query params and ensure proper URI encoding
    if (url.includes('staticmap.bin') || url.includes('static.map')) {
      return url
        .replace(/&amp;/g, '&')
        .replace(/\|/g, '%7C')
        .replace(/ /g, '%20');
    }

    // Decode escaped characters if any
    let cleanUrl = decodeURIComponent(url);
    
    // Naver CDN images (postfiles, pstatic, blogfiles)
    if (
      cleanUrl.includes('postfiles.pstatic.net') || 
      cleanUrl.includes('postfiles.naver.net') || 
      cleanUrl.includes('blogfiles.naver.net')
    ) {
      // Strip any thumbnail / blur / low-res parameters like ?type=w80_blur
      const baseUrl = cleanUrl.split('?')[0];
      
      // Append ?type=w966 to guarantee full-width, crisp high-resolution image
      return `${baseUrl}?type=w966`;
    }
    
    return cleanUrl;
  }



  public async downloadImage(imageUrl: string, blogId: string, logNo: string, index: number): Promise<string> {
    const config = this.configService.getConfig();
    const targetDir = path.resolve(process.cwd(), config.storageDir, 'images', `${blogId}_${logNo}`);

    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const cleanUrl = this.normalizeNaverImageUrl(imageUrl);
    const extMatch = cleanUrl.match(/\.(png|jpg|jpeg|gif|webp)/i);
    const ext = extMatch ? extMatch[0] : '.jpg';
    const filename = `image_${index + 1}${ext}`;
    const filePath = path.join(targetDir, filename);

    try {
      const response = await fetch(cleanUrl, {
        signal: AbortSignal.timeout(5000),
        headers: {
          'Referer': 'https://blog.naver.com/',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        },
      });

      if (!response.ok) {
        console.warn(`Failed to download image ${cleanUrl}: ${response.statusText}`);
        return cleanUrl; // Fallback to URL if download fails
      }

      const buffer = await response.arrayBuffer();
      fs.writeFileSync(filePath, Buffer.from(buffer));
      return filePath;
    } catch (error) {
      console.error(`Error downloading image ${cleanUrl}:`, error);
      return cleanUrl;
    }
  }
}
