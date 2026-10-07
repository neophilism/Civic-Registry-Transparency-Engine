import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const forbiddenPaths = [
  "apps/web/app/open-legal-interpretations",
  "apps/web/app/smart-cities-surveillance-registry",
  "examples/open-legal-interpretations",
  "examples/smart-cities-surveillance-registry",
  "docs/OPEN-LEGAL-INTERPRETATIONS.md",
  "docs/SMART-CITIES-SURVEILLANCE-REGISTRY.md",
  "apps/web/lib/compliance-projection.ts",
];

test("core repository does not bundle named downstream applications", () => {
  for (const candidate of forbiddenPaths) {
    assert.equal(
      fs.existsSync(candidate),
      false,
      `Downstream application artifact must not exist in core: ${candidate}`,
    );
  }
});

test("workspace contains only generic apps, packages, and the generic example", () => {
  const workspace = fs.readFileSync(
    "pnpm-workspace.yaml",
    "utf8",
  );

  assert.match(workspace, /apps\/\*/);
  assert.match(workspace, /packages\/\*/);
  assert.doesNotMatch(
    workspace,
    /open-legal|smart-cities|surveillance/i,
  );

  const examples = fs
    .readdirSync("examples", { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  assert.deepEqual(examples, ["generic-registry"]);
});

test("generic engine code cannot import from downstream application directories", () => {
  const roots = ["apps", "packages", "tests"];

  function walk(current) {
    return fs
      .readdirSync(current, { withFileTypes: true })
      .flatMap((entry) => {
        const full = path.join(current, entry.name);
        return entry.isDirectory() ? walk(full) : [full];
      });
  }

  const files = roots
    .flatMap((root) => walk(root))
    .filter((file) => /\.(?:ts|tsx|mjs|js)$/.test(file));

  for (const file of files) {
    const source = fs.readFileSync(file, "utf8");
    assert.doesNotMatch(
      source,
      /examples\/(?:open-legal-interpretations|smart-cities-surveillance-registry)|app\/(?:open-legal-interpretations|smart-cities-surveillance-registry)/,
      `Generic engine code imports a downstream application: ${file}`,
    );
  }
});
