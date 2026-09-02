/**
 * @evavo/code-review
 * Automated code review and architecture validation
 */

export { CodeReviewService, createCodeReviewService } from './code-review';
export { CodeReviewError, AnalysisError, ArchitectureError } from './errors';
export type {
  CodeIssue,
  ArchitectureIssue,
  QualityScore,
  ReviewSuggestion,
  CodeReviewResult,
} from './types';
