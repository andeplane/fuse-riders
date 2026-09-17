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
  "uuid",
  "rider-name",
  "firebase-config",
]);
const network = new Set([
  "clock",
  "endpoints",
  "net-stats",
  "packet",
  "rollback",
  "room-runtime",
  "snapshot",
  "stream",
  "telemetry",
]);
/** Ownership by directory, with the files under `src/online/` that are netcode rather than app listed by name. */
export function layer(file: string): Layer {
  if (/^fuse-network-(fe|be|protocol)(\/|$)/.test(file)) return "net";
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
