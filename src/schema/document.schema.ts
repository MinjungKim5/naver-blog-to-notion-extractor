export type BlockType = 
  | 'heading_1' 
  | 'heading_2' 
  | 'heading_3' 
  | 'paragraph' 
  | 'image' 
  | 'quote' 
  | 'callout' 
  | 'bookmark' 
  | 'table' 
  | 'divider'
  | 'bulleted_list_item'
  | 'numbered_list_item'
  | 'code'
  | 'video';

export interface TextAnnotations {
  bold?: boolean;
  italic?: boolean;
  strikethrough?: boolean;
  underline?: boolean;
  code?: boolean;
  color?: string;
}

export interface RichTextSegment {
  text: string;
  annotations?: TextAnnotations;
  linkUrl?: string;
}

export interface BaseBlock {
  id: string;
  type: BlockType;
}

export interface HeadingBlock extends BaseBlock {
  type: 'heading_1' | 'heading_2' | 'heading_3';
  content: RichTextSegment[];
}

export interface ParagraphBlock extends BaseBlock {
  type: 'paragraph';
  content: RichTextSegment[];
}

export interface ImageBlock extends BaseBlock {
  type: 'image';
  originalUrl: string;
  localPath?: string;
  caption?: string;
  altText?: string;
}

export interface QuoteBlock extends BaseBlock {
  type: 'quote';
  content: RichTextSegment[];
}

export interface CalloutBlock extends BaseBlock {
  type: 'callout';
  content: RichTextSegment[];
  icon?: string;
}

export interface BookmarkBlock extends BaseBlock {
  type: 'bookmark';
  url: string;
  title?: string;
  description?: string;
  thumbnailUrl?: string;
}

export interface TableRow {
  cells: RichTextSegment[][];
}

export interface TableBlock extends BaseBlock {
  type: 'table';
  hasColumnHeader?: boolean;
  hasRowHeader?: boolean;
  rows: TableRow[];
}

export interface DividerBlock extends BaseBlock {
  type: 'divider';
}

export interface BulletedListItemBlock extends BaseBlock {
  type: 'bulleted_list_item';
  content: RichTextSegment[];
}

export interface NumberedListItemBlock extends BaseBlock {
  type: 'numbered_list_item';
  content: RichTextSegment[];
}

export interface CodeBlock extends BaseBlock {
  type: 'code';
  code: string;
  language?: string;
}

export interface VideoBlock extends BaseBlock {
  type: 'video';
  url: string;
  caption?: string;
}

export type UnifiedBlock = 
  | HeadingBlock 
  | ParagraphBlock 
  | ImageBlock 
  | QuoteBlock 
  | CalloutBlock 
  | BookmarkBlock 
  | TableBlock 
  | DividerBlock
  | BulletedListItemBlock
  | NumberedListItemBlock
  | CodeBlock
  | VideoBlock;

export interface UnifiedDocument {
  title: string;
  category?: string;
  publishedAt?: string;
  author?: string;
  sourceUrl: string;
  blogId?: string;
  logNo?: string;
  tags?: string[];
  blocks: UnifiedBlock[];
}
