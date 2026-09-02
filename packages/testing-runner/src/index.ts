/**
 * @evavo/testing-runner
 * Test execution, coverage analysis, and flaky test detection
 */

export { TestingRunner, createTestingRunner } from './testing-runner';
export { TestingError, TestRunError, CoverageError, FlakyTestError } from './errors';
export type {
  TestResult,
  TestFile,
  TestRunResult,
  CoverageResult,
  FlakyTest,
  FlakyTestResult,
  CoverageThreshold,
  CoverageReport,
} from './types';
