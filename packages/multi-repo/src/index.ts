/**
 * @evavo/multi-repo
 * Cross-repository coordination and dependency management
 */

export { MultiRepoService, createMultiRepoService } from './multi-repo';
export { MultiRepoError, DependencyMappingError, ExecutionError, SyncError } from './errors';
export type {
  RepositoryInfo,
  DependencyGraph,
  ExecutionResult,
  SyncResult,
  CrossDepCompatibility,
  DependencyMap,
} from './types';
