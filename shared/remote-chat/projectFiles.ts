export interface ProjectFile {
  name: string;
  path: string;
  directory: boolean;
}
export interface ProjectFilesRequest {
  threadId?: string;
  cwd?: string;
  directory?: string;
  imagesOnly?: boolean;
}
export interface ProjectFilesResponse {
  directory: string;
  parent: string | null;
  entries: ProjectFile[];
  truncated: boolean;
}
