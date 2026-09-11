import { expect, it } from "vitest";
import { editedMessageDraft } from "./editedMessageDraft";
import { conversation } from "./events";

it("recovers the edited text, earlier steering inputs, and all attached references", () => {
  const source = conversation({ id: "thread", cwd: "", preview: "", updatedAt: 0, turns: [
    { id: "last", status: "interrupted", items: [
      { id: "first", type: "userMessage", content: [{ type: "text", text: "earlier input" }] },
      { id: "edit", type: "userMessage", content: [
        { type: "text", text: "old text" }, { type: "localImage", path: "D:/photo.png" },
        { type: "image", url: "data:image/png;base64,aW1hZ2U=" },
        { type: "skill", name: "check", path: "D:/SKILL.md" },
        { type: "mention", name: "file", path: "D:/file.txt" },
        { type: "mention", name: "plugin", path: "plugin://example" },
      ] },
    ] },
  ] });
  expect(editedMessageDraft(source, { threadId: "thread", turnId: "last", itemId: "edit", text: "new text" }))
    .toEqual({ text: "earlier input\n\nnew text", images: ["D:/photo.png", "data:image/png;base64,aW1hZ2U="],
      skills: [{ name: "check", path: "D:/SKILL.md" }], attachments: [
        { kind: "file", name: "file", path: "D:/file.txt" },
        { kind: "plugin", name: "plugin", path: "plugin://example" },
      ] });
});
