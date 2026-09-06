/**
 * Structured validation errors shared by the content pipeline.
 *
 * Every issue carries the file it came from and a JSON-pointer-style field
 * path so command output stays actionable (`file -> path -> reason`).
 */

export interface ContentIssue {
  /** Repository-relative file the issue was found in. */
  file: string;
  /** JSON-pointer-style field path, e.g. "/camera/position/0". "" for file-level errors. */
  path: string;
  /** Human-readable reason. */
  message: string;
}

export class ContentValidationError extends Error {
  readonly issues: readonly ContentIssue[];

  constructor(issues: readonly ContentIssue[]) {
    super(formatIssues(issues));
    this.name = "ContentValidationError";
    this.issues = issues;
  }
}

export function formatIssues(issues: readonly ContentIssue[]): string {
  return issues.map((issue) => formatIssue(issue)).join("\n");
}

export function formatIssue(issue: ContentIssue): string {
  const location = issue.path === "" ? issue.file : `${issue.file} ${issue.path}`;
  return `${location}: ${issue.message}`;
}

/** Converts a Zod issue path (array of keys/indices) into a pointer-style string. */
export function formatZodPath(path: readonly (string | number)[]): string {
  if (path.length === 0) {
    return "";
  }
  return `/${path.map((segment) => String(segment)).join("/")}`;
}
