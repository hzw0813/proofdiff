import type { ChangedFile, CheckResult, FileAssessment } from "./types.js";
import type { RepositoryGraph } from "./graph.js";
export declare function assessFile(file: ChangedFile, graph: RepositoryGraph, checks: CheckResult[], declaredTests?: string[]): FileAssessment;
//# sourceMappingURL=evidence.d.ts.map