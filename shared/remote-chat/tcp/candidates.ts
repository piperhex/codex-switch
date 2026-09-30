import { validTcpAddress, type TcpAddress } from './types';

export const MAX_TCP_CANDIDATES = 6;
const MAX_PER_GROUP = 3;
type Kind = 'local' | 'mapped';

/** Reserve space for both families and public mappings, even on hosts with many virtual adapters. */
export class TcpCandidates {
  private readonly groups = new Map<string, TcpAddress[]>();

  add(address: TcpAddress, kind: Kind) {
    if (!validTcpAddress(address)) return;
    const key = `${kind}:${address.host.includes(':')}`;
    const group = this.groups.get(key) ?? [];
    if (group.length >= MAX_PER_GROUP || group.some(item => item.host === address.host && item.port === address.port)) return;
    group.push(address);
    this.groups.set(key, group);
  }

  values(): TcpAddress[] {
    const result: TcpAddress[] = [];
    const groups = ['mapped:false', 'mapped:true', 'local:false', 'local:true'];
    for (let index = 0; index < MAX_PER_GROUP; index++) {
      for (const key of groups) {
        const address = this.groups.get(key)?.[index];
        if (address && !result.some(item => item.host === address.host && item.port === address.port)) result.push(address);
      }
    }
    return result.slice(0, MAX_TCP_CANDIDATES);
  }
}
