import { expect, it } from "vitest";
import { generatedImageSource, localImageSource } from "./imageSources";

it("recognizes local screenshot paths without allowing application endpoints or network shares", () => {
  for (const source of ["C:/screenshots/page.png", "C:\\screenshots\\page.png", "/tmp/page.png",
    "./output/page.webp", "bird.jpg", "file:///C:/screenshots/page.png"]) {
    expect(localImageSource(source)).toBe(source);
  }
  expect(localImageSource("C:/images/页面%20截图.png")).toBe("C:/images/页面 截图.png");
  for (const source of ["/__codex_switch__/api/test.png", "//host/page.png", "\\\\host\\page.png",
    "https://example.com/page.png", "javascript:alert.png", "file://host/share/page.png",
    "file:///tmp/page.png?query", "data:image/svg+xml,test", "/tmp/page.svg", "%oops.png"]) {
    expect(localImageSource(source)).toBeUndefined();
  }
});

it("resolves native imagegen results and falls back to saved files without treating paths as base64", () => {
  const item = { id: "image", type: "imageGeneration", savedPath: "C:/images/bird.png" };
  expect(generatedImageSource({ ...item, result: "iVBORw0KGgo=" })).toBe("data:image/png;base64,iVBORw0KGgo=");
  expect(generatedImageSource({ ...item, result: "" })).toBe(item.savedPath);
  expect(generatedImageSource({ ...item, result: "/tmp/bird.png" })).toBe("/tmp/bird.png");
  expect(generatedImageSource({ id: "view", type: "imageView", path: "/tmp/page.png" })).toBe("/tmp/page.png");
});
