export interface CliContext {
  filePath: string;
  /** Test hook / embedding override. Defaults to <cwd>/data. */
  dataRoot?: string;
}
