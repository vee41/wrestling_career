export interface CliContext {
  filePath: string;
  /** Test hook / embedding override. Defaults to <cwd>/data. */
  dataRoot?: string;
  /** Test hook / embedding override. Defaults to <cwd>/artifacts/slice-reports. */
  sliceReportDirectory?: string;
}
