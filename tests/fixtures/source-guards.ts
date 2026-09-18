import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

export function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const file = `${directory}/${entry.name}`;
      return entry.isDirectory()
        ? sourceFiles(file)
        : /\.tsx?$/.test(file) && !file.endsWith(".d.ts")
          ? [file]
          : [];
    })
    .sort();
}

export function syntax(
  file: string,
  text = readFileSync(file, "utf8"),
): ts.SourceFile {
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
}

export function deterministicViolations(file: ts.SourceFile): string[] {
  const found = new Set<string>();
  const mathObject = (node: ts.Node): boolean =>
    (ts.isIdentifier(node) && node.text === "Math") ||
    (ts.isPropertyAccessExpression(node) &&
      node.expression.getText(file) === "globalThis" &&
      node.name.text === "Math") ||
    (ts.isElementAccessExpression(node) &&
      node.expression.getText(file) === "globalThis" &&
      ts.isStringLiteralLike(node.argumentExpression) &&
      node.argumentExpression.text === "Math");
  const visit = (node: ts.Node): void => {
    if (mathObject(node)) {
      const parent = node.parent;
      const memberAccess =
        (ts.isPropertyAccessExpression(parent) ||
          ts.isElementAccessExpression(parent)) &&
        parent.expression === node;
      // The identifier in globalThis.Math is the object's name, not a second extraction.
      const objectName =
        ts.isPropertyAccessExpression(parent) &&
        parent.name === node &&
        mathObject(parent);
      if (!memberAccess && !objectName) found.add("Math extraction");
    }
    if (
      ts.isIdentifier(node) &&
      (node.text === "Date" || node.text === "performance")
    )
      found.add(node.text);
    if (
      ts.isBinaryExpression(node) &&
      (node.operatorToken.kind === ts.SyntaxKind.AsteriskAsteriskToken ||
        node.operatorToken.kind === ts.SyntaxKind.AsteriskAsteriskEqualsToken)
    )
      found.add("exponentiation");
    if (
      ts.isPropertyAccessExpression(node) ||
      ts.isElementAccessExpression(node)
    ) {
      const key = ts.isPropertyAccessExpression(node)
        ? node.name.text
        : node.argumentExpression &&
            ts.isStringLiteralLike(node.argumentExpression)
          ? node.argumentExpression.text
          : undefined;
      if (key === "localeCompare") found.add("localeCompare");
      if (mathObject(node.expression)) {
        if (
          key === undefined ||
          /^(sin|cos|tan|atan2?|hypot|pow|exp|log\w*|random)$/.test(key)
        )
          found.add(`Math.${key ?? "[dynamic]"}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return [...found].sort();
}

type Layer = "engine" | "net" | "render" | "app" | "shared" | "external";
// `career-stats`, `elo` and `rating` are the history service's settlement and the account panel's reading of it:
// one authority computes them after a match, no replica folds them, and nothing the simulation owns imports them.
// `combat-stats` is not here: match statistics carry it through every tick, so it stays engine-owned and guarded.
const shared = new Set([
  "avatars",
  "career-stats",
  "elo",
  "rating",
  "duration-text",
  "protocol",
  "firebase-config",
]);
const network = new Set([
  "endpoints",
  "fuse-game",
  "net-stats",
  "room-runtime",
  "telemetry",
]);
/** Ownership by directory, with the files under `src/online/` that are netcode rather than app listed by name. */
export function layer(file: string): Layer {
  if (/^fuse-(network-(fe|be|protocol)|netcode)(\/|$)/.test(file)) return "net";
  const base = path.basename(file, path.extname(file));
  if (file.startsWith("src/engine/")) return "engine";
  // `src/shared/` keeps only what is not simulation. Anything else that turns up there is held to the engine's rules
  // until it is listed above, so a simulation file cannot dodge the guards by being put in the wrong directory.
  if (file.startsWith("src/shared/"))
    return shared.has(base) ? "shared" : "engine";
  if (
    file.startsWith("src/net/") ||
    (file.startsWith("src/online/") && network.has(base)) ||
    file.startsWith("packages/")
  )
    return "net";
  if (file.startsWith("src/render/")) return "render";
  if (file.startsWith("src/")) return "app";
  return "external";
}

export function imports(file: ts.SourceFile): string[] {
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    )
      found.push(node.moduleSpecifier.text);
    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        node.expression.getText(file) === "require") &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0])
    )
      found.push(node.arguments[0].text);
    if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteralLike(node.argument.literal)
    )
      found.push(node.argument.literal.text);
    ts.forEachChild(node, visit);
  };
  visit(file);
  return [...new Set(found)];
}

export function forbiddenEdge(
  source: string,
  specifier: string,
): string | undefined {
  const target = specifier.startsWith(".")
    ? path.posix
        .normalize(path.posix.join(path.posix.dirname(source), specifier))
        .replace(/\.js$/, ".ts")
    : specifier;
  const from = layer(source),
    to = layer(target);
  if (source.startsWith("packages/") && target.startsWith("src/"))
    return `${source} -> ${target}`;
  const violation =
    from === "engine"
      ? to !== "engine" &&
        !(
          source.endsWith("/deterministic-math.ts") &&
          /^@stdlib\/math-base-special-(sin|cos|atan2)\/lib\/main.js$/.test(
            target,
          )
        )
      : from === "net"
        ? to !== "engine" && to !== "net" && to !== "external"
        : from === "render"
          ? to !== "render" &&
            to !== "external" &&
            !/^src\/engine\/view(?:-kit)?\.ts$/.test(target)
          : false;
  return violation ? `${source} -> ${target}` : undefined;
}

/**
 * `src/render/` may take VALUES only from `engine/view-kit.ts`; from `engine/view.ts` it takes types. A value import of
 * the view (`toView`) would pull the tuning and the rules in behind the contract, so every import or re-export of
 * `engine/view.ts` from a render file must be type-only, and a dynamic import of it is refused outright.
 */
export function renderValueImportsOfView(file: ts.SourceFile): string[] {
  const source = file.fileName;
  if (!source.startsWith("src/render/")) return [];
  const isView = (specifier: string): boolean =>
    specifier.startsWith(".") &&
    path.posix
      .normalize(path.posix.join(path.posix.dirname(source), specifier))
      .replace(/\.js$/, ".ts") === "src/engine/view.ts";
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteralLike(node.moduleSpecifier) &&
      isView(node.moduleSpecifier.text)
    ) {
      const clause = node.importClause;
      const typeOnly =
        !!clause &&
        (clause.isTypeOnly ||
          (!clause.name &&
            !!clause.namedBindings &&
            ts.isNamedImports(clause.namedBindings) &&
            clause.namedBindings.elements.every((e) => e.isTypeOnly)));
      if (!typeOnly) found.push(`${source}: ${node.getText(file)}`);
    }
    if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier) &&
      isView(node.moduleSpecifier.text)
    ) {
      const typeOnly =
        node.isTypeOnly ||
        (!!node.exportClause &&
          ts.isNamedExports(node.exportClause) &&
          node.exportClause.elements.every((e) => e.isTypeOnly));
      if (!typeOnly) found.push(`${source}: ${node.getText(file)}`);
    }
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0]) &&
      isView(node.arguments[0].text)
    )
      found.push(`${source}: ${node.getText(file)}`);
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

export function layerViolations(): string[] {
  return [
    ...new Set(
      [...sourceFiles("src"), ...sourceFiles("packages")].flatMap((file) =>
        imports(syntax(file)).flatMap(
          (specifier) => forbiddenEdge(file, specifier) ?? [],
        ),
      ),
    ),
  ].sort();
}
