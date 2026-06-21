export interface FileStorageSaveInput {
  userId: string;
  buffer: Buffer;
  mimeType: string;
  originalName: string;
}

export interface StoredFile {
  filename: string;
  mimeType: string;
  size: number;
  relativePath: string;
}

export interface FileStorage {
  saveUserFile(input: FileStorageSaveInput): Promise<StoredFile>;
}
