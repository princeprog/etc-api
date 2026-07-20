export interface FileStorageSaveInput {
  userId: string;
  buffer: Buffer;
  mimeType: string;
  originalName: string;
  folder?: string;
  resourceType?: 'auto' | 'image' | 'raw';
}

export interface StoredFile {
  filename: string;
  mimeType: string;
  size: number;
  relativePath: string;
  url?: string;
  publicId?: string;
  width?: number;
  height?: number;
  format?: string;
  optimizedUrl?: string;
}

export interface FileStorage {
  saveUserFile(input: FileStorageSaveInput): Promise<StoredFile>;
  deleteFiles?(relativePathsOrUrls: string[]): Promise<void>;
}
