import { terminalApi } from "./api";
import { connectTerminal as connect, type ConnectionOptions } from "../../../../../../shared/terminal/connection";

/** Local callers use native IPC; remote callers provide their selected computer's API. */
export function connectTerminal(options: Omit<ConnectionOptions, 'api'> & Partial<Pick<ConnectionOptions, 'api'>>) {
  return connect({ ...options, api: options.api ?? terminalApi });
}
