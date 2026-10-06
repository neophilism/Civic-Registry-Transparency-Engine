import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("workspace declares the expected application and package roots", async () => {
  const workspace = await readFile("pnpm-workspace.yaml", "utf8");

  assert.match(workspace, /apps\/\*/);
  assert.match(workspace, /packages\/\*/);
});

test("root package pins pnpm and requires a supported Node runtime", async () => {
  const packageJson = JSON.parse(await readFile("package.json", "utf8"));

  assert.equal(packageJson.packageManager, "pnpm@12.7.0");
  assert.equal(packageJson.engines.node, ">=24.0.0");
});

test("continuous integration exercises all foundation quality gates", async () => {
  const workflow = await readFile(".github/workflows/ci.yml", "utf8");

  for (const command of ["pnpm lint", "pnpm typecheck", "pnpm test", "pnpm build"]) {
    assert.match(workflow, new RegExp(command.replace(" ", "\\s+")));
  }
});
