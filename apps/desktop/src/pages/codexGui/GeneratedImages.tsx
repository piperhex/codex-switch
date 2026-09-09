import type { Item } from "./types";
import { generatedImageSource } from "./imageSources";
import { MessageImage } from "./MessageImage";

export function GeneratedImages({ items }: { items: Item[] }) {
  const sources = new Set<string>();
  for (const item of items) {
    if (item.type !== "imageGeneration" || item.status !== "completed" || item.failure) continue;
    const source = generatedImageSource(item);
    if (source) sources.add(source);
  }
  if (!sources.size) return null;
  return <div aria-label="生成的图片">
    {[...sources].map((source, index) => <MessageImage key={source} src={source} alt={`生成的图片 ${index + 1}`} />)}
  </div>;
}
