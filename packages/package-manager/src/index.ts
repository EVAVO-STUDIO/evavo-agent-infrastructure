/**
 * @evavo/package-manager
 * Dependency analysis, vulnerability detection, and compatibility checking
 */

export { PackageManager, createPackageManager } from './package-manager';
export { PackageManagerError, AnalysisError, VulnerabilityError, CompatibilityError } from './errors';
export type {
  PackageInfo,
  AnalysisResult,
  Vulnerability,
  VulnerabilityResult,
  UpgradeRecommendation,
  UpgradeResult,
  CompatibilityIssue,
  CompatibilityResult,
} from './types';
