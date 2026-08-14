export type ChangeKind = "added" | "modified" | "deleted" | "renamed" | "copied" | "unknown";
export type LanguageId = "typescript" | "javascript" | "python" | "unknown";
export type Confidence = "high" | "medium" | "low";
export type VerificationStatus = "verified" | "partially-verified" | "unverified" | "unknown" | "verification-failed";
export interface LineRange {
    start: number;
    end: number;
}
export interface DiffHunk {
    oldRange: LineRange;
    newRange: LineRange;
}
export interface ChangedFile {
    path: string;
    previousPath?: string;
    change: ChangeKind;
    language: LanguageId;
    additions: number;
    deletions: number;
    binary: boolean;
    hunks: DiffHunk[];
    deletedSymbolHints: string[];
}
export interface SymbolInfo {
    name: string;
    kind: "function" | "method" | "class" | "variable" | "module";
    range: LineRange;
    exported: boolean;
    confidence: Confidence;
}
export interface ImportInfo {
    source: string;
    names: string[];
    kind: "static" | "dynamic";
    line: number;
    confidence: Confidence;
}
export interface CallInfo {
    name: string;
    line: number;
    confidence: Confidence;
}
export interface SourceAnalysis {
    language: LanguageId;
    parser: string;
    symbols: SymbolInfo[];
    imports: ImportInfo[];
    calls: string[];
    callSites?: CallInfo[];
    diagnostics: string[];
    confidence: Confidence;
}
export type CheckKind = "test" | "typecheck" | "lint" | "other";
export type CheckRunStatus = "passed" | "failed" | "error" | "timed-out" | "not-run";
export interface TestTargetQualification {
    path: string;
    runnerPath: string;
    basis: "runner-default-pattern" | "runner-config-pattern" | "runner-explicit-path" | "compiled-source-map";
    confidence: Confidence;
    detail: string;
    limitation: string;
}
export interface TestTargetObservation {
    path: string;
    runnerPath: string;
    outcome: "passed" | "failed" | "zero-tests" | "skipped" | "not-observed";
    testsObserved: number;
    detail: string;
}
export interface CheckDefinition {
    id: string;
    label: string;
    kind: CheckKind;
    command: string;
    args: string[];
    origin: string;
    executesRepositoryCode: boolean;
    targetRunner?: "node-test" | "jest" | "vitest" | "pytest" | "unittest";
    targetRunnerArgs?: string[];
    targetPattern?: string;
    targetPatterns?: string[];
    targetFiles?: string[];
    targetQualifications?: TestTargetQualification[];
}
export interface CheckResult extends CheckDefinition {
    status: CheckRunStatus;
    exitCode: number | null;
    durationMs: number;
    output: string;
    outputTruncated: boolean;
    explanation: string;
    targetObservations?: TestTargetObservation[];
}
export interface EvidenceItem {
    kind: "passing-check" | "failing-check" | "executed-test" | "coverage-artifact" | "related-test" | "static-relationship" | "inference" | "limitation";
    label: string;
    detail: string;
    confidence: Confidence;
    checkId?: string;
}
export type StrongestEvidence = "change-observed" | "static-relationship" | "passing-check" | "related-test-file-passed" | "verification-failure";
export type EvidenceBoundaryStage = "static-relationship" | "runner-qualification" | "target-invocation" | "runtime-observation" | "failure-attribution" | "changed-code-execution" | "changed-line-coverage" | "relevant-assertion";
export type EvidenceStopReason = "no-related-test" | "unsupported-semantics" | "runner-unqualified" | "checks-not-run" | "target-not-invoked" | "no-applicable-check" | "opaque-passing-check" | "zero-tests" | "all-skipped" | "observer-inconclusive" | "failure-unattributed" | "target-failed" | "check-failed" | "changed-code-execution-unobserved";
export type EvidenceNextActionKind = "inspect-static-limitations" | "review-run-checks" | "add-supported-check" | "qualify-related-test" | "inspect-target-selection" | "inspect-observer" | "inspect-failure";
export interface EvidenceNextAction {
    kind: EvidenceNextActionKind;
    detail: string;
    requiresRepositoryCodeExecution: boolean;
}
export interface EvidenceBoundary {
    strongestEvidence: StrongestEvidence;
    stage: EvidenceBoundaryStage;
    reason: EvidenceStopReason;
    detail: string;
    proofdiffFailClosed: boolean;
    nextAction: EvidenceNextAction | null;
}
export type CoverageState = "all-covered" | "partially-covered" | "uncovered" | "unmeasured" | "not-applicable";
export interface CoverageFileEvidence {
    state: CoverageState;
    changedLines: number;
    measuredChangedLines: number;
    coveredChangedLines: number;
    uncoveredChangedLines: number;
    unmeasuredChangedLines: number;
    uncoveredLineNumbers: number[];
    unmeasuredLineNumbers: number[];
    detail: string;
}
export interface CoverageArtifactSummary {
    format: "lcov";
    artifact: string;
    suppliedCommit: string;
    resolvedCommit: string;
    targetCommit: string | null;
    commitBinding: "declared-commit-matched" | "commit-mismatch" | "uncommitted-selection";
    accepted: boolean;
    filesParsed: number;
    lineRecords: number;
    detail: string;
}
export type RiskLevel = "critical" | "high" | "medium" | "low";
export interface FileAssessment {
    file: ChangedFile;
    changedSymbols: SymbolInfo[];
    changedCalls: CallInfo[];
    impactedFiles: string[];
    relatedTests: string[];
    executedTests: string[];
    testExecutions: Array<{
        path: string;
        status: Exclude<CheckRunStatus, "not-run">;
        checkId: string;
    }>;
    status: VerificationStatus;
    evidenceBoundary?: EvidenceBoundary;
    coverage?: CoverageFileEvidence;
    risk: RiskLevel;
    riskScore: number;
    reasons: string[];
    evidence: EvidenceItem[];
    limitations: string[];
}
export interface RepositoryInfo {
    root: string;
    name: string;
    head: string | null;
    branch: string | null;
    dirty: boolean;
}
export interface DiffSelection {
    mode: "working-tree" | "staged" | "base" | "range";
    value?: string;
    description: string;
}
export interface AnalysisSummary {
    filesChanged: number;
    symbolsChanged: number;
    checksDiscovered: number;
    checksRun: number;
    counts: Record<VerificationStatus, number>;
    overallStatus: VerificationStatus;
    highestRisk: RiskLevel | null;
}
export interface AnalysisReport {
    schemaVersion: "1.0";
    proofdiffVersion: string;
    generatedAt: string;
    repository: RepositoryInfo;
    selection: DiffSelection;
    summary: AnalysisSummary;
    assessments: FileAssessment[];
    checks: CheckResult[];
    discoveredChecks: CheckDefinition[];
    notes: string[];
    coverage?: CoverageArtifactSummary;
    trust: {
        repositoryCodeExecuted: boolean;
        statement: string;
    };
}
export interface AnalyzeOptions {
    repo: string;
    base?: string;
    range?: string;
    staged?: boolean;
    runChecks?: boolean;
    selectedChecks?: string[];
    timeoutMs?: number;
    maxOutputBytes?: number;
    coverageLcov?: string;
    coverageCommit?: string;
    now?: () => Date;
}
//# sourceMappingURL=types.d.ts.map