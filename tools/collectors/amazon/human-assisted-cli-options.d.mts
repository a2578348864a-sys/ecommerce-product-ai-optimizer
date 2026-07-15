export type HumanAssistedCliOptions = {
  outputFile: string;
  maxSamples: number;
};

export function parseHumanAssistedCliArguments(
  argv: string[],
  cwd?: string,
): HumanAssistedCliOptions;

export type HumanAssistedRuntimeCommand = {
  executable: string;
  args: string[];
};

export function buildHumanAssistedRuntimeCommand(
  cwd?: string,
  nodeExecutable?: string,
): HumanAssistedRuntimeCommand;
