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
export interface CheckDefinition {
    id: string;
    label: string;
    kind: CheckKind;
    command: string;
    args: string[];
    origin: string;
    executesRepositoryCode: boolean;
    targetRunner?: "node-test" | "pytest" | "unittest";
    targetPattern?: string;
    targetPatterns?: string[];
    targetFiles?: string[];
}
export interface CheckResult extends CheckDefinition {
    status: CheckRunStatus;
    exitCode: number | null;
    durationMs: number;
    output: string;
    outputTruncated: boolean;
    explanation: string;
}
export interface EvidenceItem {
    kind: "passing-check" | "failing-check" | "executed-test" | "related-test" | "static-relationship" | "inference" | "limitation";
    label: string;
    detail: string;
    confidence: Confidence;
    checkId?: string;
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
    now?: () => Date;
}
//# sourceMappingURL=types.d.ts.map