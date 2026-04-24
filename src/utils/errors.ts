/**
 * Custom error types for Super-Memory
 * 
 * Provides hierarchical error classes for different subsystems:
 * - MemoryError: General memory operations
 * - ModelError: Model/embedding operations
 * - DatabaseError: Database/storage operations
 * - IndexError: Project indexing operations
 */

export class MemoryError extends Error {
  constructor(
    message: string,
    public code: string = 'MEMORY_ERROR',
    public details?: unknown
  ) {
    super(message);
    this.name = 'MemoryError';
    Error.captureStackTrace(this, this.constructor);
  }

  toJSON(): object {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      details: this.details,
    };
  }
}

export class ModelError extends MemoryError {
  constructor(
    message: string,
    public modelId?: string,
    public operation?: string
  ) {
    super(message, 'MODEL_ERROR', { modelId, operation });
    this.name = 'ModelError';
    Error.captureStackTrace(this, this.constructor);
  }

  toJSON(): object {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      details: {
        modelId: this.modelId,
        operation: this.operation,
      },
    };
  }
}

export class DatabaseError extends MemoryError {
  constructor(
    message: string,
    public operation?: 'read' | 'write' | 'delete' | 'query' | 'initialize',
    public tableName?: string
  ) {
    super(message, 'DATABASE_ERROR', { operation, tableName });
    this.name = 'DatabaseError';
    Error.captureStackTrace(this, this.constructor);
  }

  toJSON(): object {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      details: {
        operation: this.operation,
        tableName: this.tableName,
      },
    };
  }
}

export class IndexError extends MemoryError {
  constructor(
    message: string,
    public filePath?: string,
    public operation?: 'index' | 'chunk' | 'watch' | 'hash'
  ) {
    super(message, 'INDEX_ERROR', { filePath, operation });
    this.name = 'IndexError';
    Error.captureStackTrace(this, this.constructor);
  }

  toJSON(): object {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      details: {
        filePath: this.filePath,
        operation: this.operation,
      },
    };
  }
}

export class ValidationError extends MemoryError {
  constructor(
    message: string,
    public field?: string
  ) {
    super(message, 'VALIDATION_ERROR', { field });
    this.name = 'ValidationError';
    Error.captureStackTrace(this, this.constructor);
  }
}

export class ConfigError extends MemoryError {
  constructor(
    message: string,
    public field?: string
  ) {
    super(message, 'CONFIG_ERROR', { field });
    this.name = 'ConfigError';
    Error.captureStackTrace(this, this.constructor);
  }
}