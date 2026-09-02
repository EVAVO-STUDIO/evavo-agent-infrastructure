/**
 * @evavo/git-operations
 * Safe git operations with automatic lock file handling
 */

export { GitOperations, createGitOperations } from './git-operations';
export {
  GitOperationError,
  LockFileError,
  NetworkError,
  AuthenticationError,
  ConflictError,
  PushError,
} from './errors';
export {
  getLockFileState,
  waitForLock,
  forceClearLock,
  acquireLock,
  cleanupLock,
} from './lock-handler';
export { parseGitError, categorizeErrors, getRecoverySuggestion, isRecoverable } from './error-parser';
export type {
  GitCommitOptions,
  GitPushOptions,
  GitStatusResult,
  LockFileState,
  GitError,
  GitOperationResult,
} from './types';
