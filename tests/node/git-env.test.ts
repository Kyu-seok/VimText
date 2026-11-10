import { expect, it } from "vitest";

it("a Node test starts with no GIT_* variable in its environment", () => {
  expect(Object.keys(process.env).filter((key) => key.startsWith("GIT_"))).toEqual([]);
});
