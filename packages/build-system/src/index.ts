/**
 * @evavo/build-system
 * Multi-framework build orchestration
 */

export { BuildSystem, createBuildSystem } from './build-system';
export { BuildError, FrameworkDetectionError, BuildExecutionError, ArtifactError } from './errors';
export type {
  FrameworkType,
  FrameworkDetectionResult,
  BuildError as BuildErrorType,
  BuildMetrics,
  BuildResult,
} from './types';
