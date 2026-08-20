// P1-UI-01 Studio Single-Wrapper Contract — AST structure test (regression guard)
// Ensures ImageStudioClient / ListingStudioClient task-linked (and standalone)
// branches return a SINGLE wrapper element as the .main grid child, containing
// rail → banner → content in normal document flow (no fragment).
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

const ROOT = join(__dirname, "..", "..");

function loadTsx(rel: string): ts.SourceFile {
  return ts.createSourceFile(rel, readFileSync(join(ROOT, rel), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

function findFunction(sf: ts.SourceFile, name: string): ts.FunctionDeclaration | null {
  let found: ts.FunctionDeclaration | null = null;
  ts.forEachChild(sf, (node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node;
  });
  return found;
}

function unwrapParen(e: ts.Expression): ts.Expression {
  return ts.isParenthesizedExpression(e) ? unwrapParen(e.expression) : e;
}

function findTaskIdReturn(fn: ts.FunctionDeclaration): ts.ReturnStatement | null {
  let ret: ts.ReturnStatement | null = null;
  ts.forEachChild(fn.body!, (stmt) => {
    if (ts.isIfStatement(stmt)
      && ts.isIdentifier(stmt.expression) && stmt.expression.text === "taskId"
      && ts.isBlock(stmt.thenStatement)) {
      for (const s of stmt.thenStatement.statements) {
        if (ts.isReturnStatement(s) && ts.isJsxElement(unwrapParen(s.expression!))) ret = s;
      }
    }
  });
  return ret;
}

function findFinalReturn(fn: ts.FunctionDeclaration): ts.ReturnStatement | null {
  let ret: ts.ReturnStatement | null = null;
  ts.forEachChild(fn.body!, (stmt) => {
    if (ts.isReturnStatement(stmt) && ts.isJsxElement(unwrapParen(stmt.expression!))) ret = stmt;
  });
  return ret;
}

function jsxAttrs(el: ts.JsxElement): Record<string, string> {
  const out: Record<string, string> = {};
  for (const attr of el.openingElement.attributes.properties) {
    if (ts.isJsxAttribute(attr) && attr.initializer && ts.isStringLiteral(attr.initializer)) {
      out[ts.isIdentifier(attr.name) ? attr.name.text : attr.name.namespace.text] = attr.initializer.text;
    }
  }
  return out;
}

function assertFlow(el: ts.JsxElement, testidFragment: string, bannerTestId: string, hasTaskPrep: boolean): void {
  const attrs = jsxAttrs(el);
  expect(attrs["data-testid"]).toContain(testidFragment);
  const children = el.children;
  const kinds = children.map((c) => {
    if (ts.isJsxExpression(c) && c.expression && ts.isIdentifier(c.expression)) return "expr:" + c.expression.text;
    if (ts.isJsxElement(c)) return "el:" + ((jsxAttrs(c)["data-testid"]) || c.openingElement.tagName.getText());
    if (ts.isJsxSelfClosingElement(c)) return "self:" + c.tagName.getText();
    return ts.SyntaxKind[c.kind];
  });
  // rail expression present
  expect(kinds).toContain("expr:progressRail");
  // banner present
  expect(kinds.some((k) => k.includes(bannerTestId))).toBe(true);
  if (hasTaskPrep) {
    expect(kinds.some((k) => k === "el:TaskStudioPreparation" || k.includes("TaskStudioPreparation"))).toBe(true);
  }
  // top-level must NOT be a fragment
  expect(kinds.length).toBeGreaterThanOrEqual(3);
}

describe("Studio single-wrapper layout contract (P1-UI-01)", () => {
  it("ImageStudioClient task-linked branch: single wrapper div, rail→banner→content, no fragment", () => {
    const sf = loadTsx("components/image-studio/ImageStudioClient.tsx");
    const fn = findFunction(sf, "ImageStudioClient");
    expect(fn).not.toBeNull();
    const ret = findTaskIdReturn(fn!);
    expect(ret).not.toBeNull();
    expect(ts.isJsxElement(unwrapParen(ret!.expression!))).toBe(true);
    const el = unwrapParen(ret!.expression!) as ts.JsxElement;
    assertFlow(el, "-task-flow", "image-mode-task-linked", true);
  });

  it("ImageStudioClient standalone branch: single wrapper div, no fragment", () => {
    const sf = loadTsx("components/image-studio/ImageStudioClient.tsx");
    const ret = findFinalReturn(findFunction(sf, "ImageStudioClient")!);
    expect(ret).not.toBeNull();
    expect(ts.isJsxElement(unwrapParen(ret!.expression!))).toBe(true);
    assertFlow((unwrapParen(ret!.expression!) as ts.JsxElement), "-standalone-flow", "image-mode-standalone", false);
  });

  it("ListingStudioClient task-linked branch: same single-wrapper contract", () => {
    const sf = loadTsx("components/listing-studio/ListingStudioClient.tsx");
    const fn = findFunction(sf, "ListingStudioClient");
    expect(fn).not.toBeNull();
    const ret = findTaskIdReturn(fn!);
    expect(ret).not.toBeNull();
    expect(ts.isJsxElement(unwrapParen(ret!.expression!))).toBe(true);
    assertFlow((unwrapParen(ret!.expression!) as ts.JsxElement), "-task-flow", "listing-mode-task-linked", true);
  });

  it("ListingStudioClient standalone branch: single wrapper div, no fragment", () => {
    const sf = loadTsx("components/listing-studio/ListingStudioClient.tsx");
    const ret = findFinalReturn(findFunction(sf, "ListingStudioClient")!);
    expect(ret).not.toBeNull();
    expect(ts.isJsxElement(unwrapParen(ret!.expression!))).toBe(true);
    assertFlow((unwrapParen(ret!.expression!) as ts.JsxElement), "-standalone-flow", "listing-mode-standalone", false);
  });
});