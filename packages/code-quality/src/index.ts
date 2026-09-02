/**
 * @evavo/code-quality
 * TypeScript checking, ESLint, and security scanning
 */

export { CodeQualityService, createCodeQualityService } from './code-quality';
export {
  CodeQualityError,
  TypeCheckError,
  LintError,
  AuditError,
  FormatError,
} from './errors';
export {
  categorizeTypeCheckErrors,
  getTypeCheckFixes,
  summarizeErrors,
  findCommonPatterns,
} from './error-categorizer';
export type {
  TypeCheckError as TypeCheckErrorType,
  TypeCheckResult,
  LintError as LintErrorType,
  LintResult,
  AuditVulnerability,
  AuditResult,
  FormatResult,
  ErrorCategory,
  CodeQualityResult,
} from './types';
