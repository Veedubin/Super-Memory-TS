/**
 * Content hashing utilities for Super-Memory
 * 
 * Uses SHA-256 for content verification and deduplication.
 */

import { createHash } from 'crypto';
import { readFile } from 'fs/promises';

/**
 * Hash a string content using SHA-256
 * @param content - The content to hash
 * @returns The SHA-256 hash as a hex string
 */
export function hashContent(content: string): string {
  return createHash('sha256').update(content, 'utf-8').digest('hex');
}

/**
 * Hash a file's content using SHA-256
 * @param filePath - Path to the file to hash
 * @returns Promise resolving to the SHA-256 hash as a hex string
 */
export async function hashFile(filePath: string): Promise<string> {
  const content = await readFile(filePath, 'utf-8');
  return hashContent(content);
}

/**
 * Hash content and return short hash (first 16 characters)
 * Useful for content comparison rather than cryptographic use.
 * @param content - The content to hash
 * @returns Short SHA-256 hash
 */
export function hashContentShort(content: string): string {
  return hashContent(content).slice(0, 16);
}

/**
 * Generate a unique ID based on content hash and timestamp
 * @param prefix - Optional prefix for the ID
 * @param content - Optional content to hash
 * @returns Unique ID string
 */
export function generateUniqueId(prefix: string = '', content?: string): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 8);
  const hashPart = content ? `_${hashContentShort(content)}` : '';
  return `${prefix}${prefix ? '_' : ''}${timestamp}_${random}${hashPart}`;
}