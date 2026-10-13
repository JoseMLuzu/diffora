export interface Commit {
  hash: string;
  shortHash: string;
  title: string;
  date: string;
  parents: string[];
}
export interface ChangedFile {
  path: string;
  oldPath?: string;
  status: string;
}
export type Category = "unstaged" | "staged" | "untracked";
export type Source = { kind: "commit"; commit: Commit } | { kind: Category };
export interface DiffLine {
  kind: "header" | "context" | "add" | "delete" | "meta";
  text: string;
  old?: number;
  new?: number;
}
export interface Diff {
  lines: DiffLine[];
  binary: boolean;
  truncated: boolean;
  image?: ImageDiff;
}

export interface ImagePreviewData {
  width: number;
  height: number;
  format: string;
  bytes: number;
  previewWidth: number;
  previewHeight: number;
  pixels: Uint8Array;
}
export interface ImageDiff {
  before?: ImagePreviewData;
  after?: ImagePreviewData;
  beforeNotice: string;
  afterNotice: string;
}
