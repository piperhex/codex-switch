import { all, createLowlight } from "lowlight";

const highlighter = createLowlight(all);
self.onmessage = ({ data }: MessageEvent<{ text: string; language: string }>) => {
  try {
    const nodes = highlighter.registered(data.language)
      ? highlighter.highlight(data.language, data.text).children : null;
    self.postMessage(nodes);
  } catch {
    self.postMessage(null);
  }
};
