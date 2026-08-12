import path from "node:path";
import { parse } from "@babel/parser";
function nodeName(node) {
    if (!node)
        return null;
    if (node.type === "Identifier" && typeof node.name === "string")
        return node.name;
    if (node.type === "StringLiteral" && typeof node.value === "string")
        return node.value;
    if (node.type === "PrivateName")
        return `#${nodeName(node.id) ?? "private"}`;
    if (node.type === "MemberExpression" || node.type === "OptionalMemberExpression") {
        const object = nodeName(node.object);
        const property = nodeName(node.property);
        return object && property ? `${object}.${property}` : property;
    }
    if (node.type === "TSQualifiedName") {
        const left = nodeName(node.left);
        const right = nodeName(node.right);
        return left && right ? `${left}.${right}` : right;
    }
    return null;
}
function range(node) {
    return { start: node.loc?.start.line ?? 1, end: node.loc?.end.line ?? node.loc?.start.line ?? 1 };
}
function isExported(parent) {
    return parent?.type === "ExportNamedDeclaration" || parent?.type === "ExportDefaultDeclaration";
}
function collectImportNames(specifiers) {
    if (!Array.isArray(specifiers))
        return [];
    const names = [];
    for (const item of specifiers) {
        const specifier = item;
        const imported = nodeName(specifier.imported);
        const local = nodeName(specifier.local);
        if (imported)
            names.push(imported);
        else if (local)
            names.push(local);
    }
    return names;
}
function analyzeAst(ast, language) {
    const symbols = [];
    const imports = [];
    const calls = new Set();
    const callSites = [];
    const seen = new Set();
    function visit(node, parent, grandparent) {
        if (!node || typeof node !== "object" || Array.isArray(node) || seen.has(node))
            return;
        seen.add(node);
        const current = node;
        const line = current.loc?.start.line ?? 1;
        if (current.type === "ImportDeclaration" || current.type === "ExportNamedDeclaration" || current.type === "ExportAllDeclaration") {
            const source = current.source;
            if (source && typeof source.value === "string") {
                imports.push({
                    source: source.value,
                    names: collectImportNames(current.specifiers),
                    kind: "static",
                    line,
                    confidence: "high",
                });
            }
        }
        if (current.type === "CallExpression" || current.type === "OptionalCallExpression") {
            const callee = current.callee;
            const name = nodeName(callee);
            if (name) {
                calls.add(name);
                if (!callSites.some((site) => site.name === name && site.line === line))
                    callSites.push({ name, line, confidence: "high" });
            }
            const args = current.arguments;
            const first = Array.isArray(args) ? args[0] : undefined;
            if ((name === "require" || callee?.type === "Import") && first && typeof first.value === "string") {
                imports.push({
                    source: first.value,
                    names: [],
                    kind: callee.type === "Import" ? "dynamic" : "static",
                    line,
                    confidence: "high",
                });
            }
        }
        if (current.type === "FunctionDeclaration") {
            symbols.push({
                name: nodeName(current.id) ?? "default",
                kind: "function",
                range: range(current),
                exported: isExported(parent),
                confidence: "high",
            });
        }
        else if (current.type === "ClassDeclaration") {
            symbols.push({
                name: nodeName(current.id) ?? "default",
                kind: "class",
                range: range(current),
                exported: isExported(parent),
                confidence: "high",
            });
        }
        else if (["ClassMethod", "ClassPrivateMethod", "ObjectMethod"].includes(current.type ?? "")) {
            symbols.push({
                name: nodeName(current.key) ?? "anonymous",
                kind: "method",
                range: range(current),
                exported: false,
                confidence: "high",
            });
        }
        else if (current.type === "VariableDeclarator") {
            const initializer = current.init;
            if (initializer && ["ArrowFunctionExpression", "FunctionExpression"].includes(initializer.type ?? "")) {
                symbols.push({
                    name: nodeName(current.id) ?? "anonymous",
                    kind: "function",
                    range: range(current),
                    exported: parent?.type === "VariableDeclaration" && isExported(grandparent),
                    confidence: "high",
                });
            }
        }
        for (const [key, value] of Object.entries(current)) {
            if (["loc", "start", "end", "errors", "tokens", "comments"].includes(key))
                continue;
            if (Array.isArray(value)) {
                for (const child of value)
                    visit(child, current, parent);
            }
            else if (value && typeof value === "object") {
                visit(value, current, parent);
            }
        }
    }
    visit(ast);
    return {
        language,
        parser: "@babel/parser",
        symbols,
        imports,
        calls: [...calls].sort(),
        callSites: callSites.sort((a, b) => a.line - b.line || a.name.localeCompare(b.name)),
        diagnostics: [],
        confidence: "high",
    };
}
export class JavaScriptAdapter {
    id;
    extensions;
    constructor(language) {
        this.id = language;
        this.extensions = language === "typescript" ? [".ts", ".tsx", ".mts", ".cts"] : [".js", ".jsx", ".mjs", ".cjs"];
    }
    async analyze(file, source, _root) {
        const extension = path.extname(file).toLowerCase();
        const plugins = ["jsx", "decorators-legacy", "importAttributes", "explicitResourceManagement"];
        if (this.id === "typescript")
            plugins.push("typescript");
        try {
            const ast = parse(source, {
                sourceType: "unambiguous",
                errorRecovery: true,
                allowAwaitOutsideFunction: true,
                allowReturnOutsideFunction: extension === ".cjs",
                plugins,
            });
            const analysis = analyzeAst(ast, this.id);
            const parseErrors = ast.errors ?? [];
            if (parseErrors.length > 0) {
                analysis.diagnostics.push(...parseErrors.slice(0, 5).map((error) => `Parser recovered: ${error.message}`));
                analysis.confidence = "medium";
                for (const site of analysis.callSites ?? [])
                    site.confidence = "medium";
            }
            return analysis;
        }
        catch (error) {
            return lexicalFallback(source, this.id, error instanceof Error ? error.message : String(error));
        }
    }
}
function lexicalFallback(source, language, diagnostic) {
    const symbols = [];
    const imports = [];
    const lines = source.split("\n");
    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index] ?? "";
        const symbol = line.match(/^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function|class)\s+([\w$]+)/);
        if (symbol?.[1]) {
            symbols.push({ name: symbol[1], kind: /\bclass\b/.test(line) ? "class" : "function", range: { start: index + 1, end: index + 1 }, exported: /\bexport\b/.test(line), confidence: "low" });
        }
        const imported = line.match(/(?:\bfrom\s+|\brequire\s*\(|\bimport\s*\()\s*["']([^"']+)/);
        if (imported?.[1])
            imports.push({ source: imported[1], names: [], kind: "static", line: index + 1, confidence: "low" });
    }
    return { language, parser: "lexical fallback", symbols, imports, calls: [], callSites: [], diagnostics: [`AST parsing failed: ${diagnostic}`], confidence: "low" };
}
//# sourceMappingURL=javascript.js.map