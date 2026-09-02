/**
 * @evavo/visual-testing
 * Screenshots, accessibility, and performance testing
 */

export { VisualTestingService, createVisualTestingService } from './visual-testing';
export {
  VisualTestingError,
  ScreenshotError,
  ComparisonError,
  A11yError,
  PerformanceError,
} from './errors';
export type {
  ScreenshotOptions,
  ScreenshotResult,
  VisualDiff,
  A11yIssue,
  A11yResult,
  PerformanceMetric,
  PerformanceResult,
  VisualTestReport,
} from './types';
