import type { GitCommit } from './gitTypes';

export const GRAPH_ROW_HEIGHT = 76;
export const GRAPH_LANE_WIDTH = 18;
const COLORS = ['#0b8065', '#6274d7', '#c47728', '#b858a1', '#278ca1', '#bd5c54'];
export interface GraphLine { x1: number; y1: number; x2: number; y2: number; color: string }
export interface GraphRow { commit: GitCommit; x: number; color: string; lines: GraphLine[] }
interface Lane { hash: string; color: string }
const x = (lane: number) => lane * GRAPH_LANE_WIDTH + GRAPH_LANE_WIDTH / 2;

/** Parent hashes, including both parents of a merge, determine the lanes across page boundaries. */
export function gitGraph(commits: GitCommit[]) {
  let lanes: Lane[] = [];
  let colorIndex = 0;
  let width = GRAPH_LANE_WIDTH;
  const rows = commits.map(commit => {
    let lane = lanes.findIndex(entry => entry.hash === commit.hash);
    if (lane < 0) {
      lane = lanes.length;
      lanes.push({ hash: commit.hash, color: COLORS[colorIndex++ % COLORS.length] });
    }
    const before = [...lanes];
    const node = lanes[lane];
    const next = lanes.filter((_, index) => index !== lane);
    commit.parents.forEach((hash, index) => {
      if (!next.some(entry => entry.hash === hash)) next.splice(Math.min(lane + index, next.length), 0,
        { hash, color: index === 0 ? node.color : COLORS[colorIndex++ % COLORS.length] });
    });
    const lines: GraphLine[] = [];
    before.forEach((entry, index) => {
      lines.push({ x1: x(index), y1: 0, x2: x(index), y2: GRAPH_ROW_HEIGHT / 2, color: entry.color });
      if (index !== lane) lines.push({ x1: x(index), y1: GRAPH_ROW_HEIGHT / 2,
        x2: x(next.findIndex(value => value.hash === entry.hash)), y2: GRAPH_ROW_HEIGHT, color: entry.color });
    });
    commit.parents.forEach(hash => {
      const parent = next.findIndex(entry => entry.hash === hash);
      lines.push({ x1: x(lane), y1: GRAPH_ROW_HEIGHT / 2, x2: x(parent), y2: GRAPH_ROW_HEIGHT,
        color: next[parent].color });
    });
    width = Math.max(width, Math.max(before.length, next.length) * GRAPH_LANE_WIDTH);
    lanes = next;
    return { commit, x: x(lane), color: node.color, lines };
  });
  return { rows, width: width + GRAPH_LANE_WIDTH };
}
