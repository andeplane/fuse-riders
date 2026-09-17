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
  const visit = (node: ts.Node): void => {
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
      const receiver = node.expression.getText(file);
      if (key === "localeCompare") found.add("localeCompare");
      if (receiver === "Math" || receiver === "globalThis.Math") {
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
const shared = new Set([
  "avatars",
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
  "prediction",
  "rollback",
  "room-runtime",
  "snapshot",
  "stream",
  "telemetry",
]);
const rendering = new Set([
  "arena-wall",
  "blast-animation",
  "bomb-preview",
  "ink-renderer",
  "portal-palettes",
  "reload-ring",
  "render-snapshot",
  "themes",
  "trail-debris",
]);

/** Today's ownership, plus the target directories, so moving files cannot disable the guard. */
export function layer(file: string): Layer {
  const base = path.basename(file, path.extname(file));
  if (file.startsWith("src/engine/") || file === "src/online/checkpoint.ts")
    return "engine";
  if (file.startsWith("src/shared/"))
    return shared.has(base) ? "shared" : "engine";
  if (
    file.startsWith("src/net/") ||
    (file.startsWith("src/online/") && network.has(base)) ||
    ["src/client/socket-client.ts", "src/client/snapshot-stream.ts"].includes(
      file,
    ) ||
    file.startsWith("packages/")
  )
    return "net";
  if (
    file.startsWith("src/render/") ||
    file.startsWith("src/client/phaser/") ||
    (file.startsWith("src/client/") && rendering.has(base))
  )
    return "render";
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
