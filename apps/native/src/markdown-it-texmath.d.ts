declare module 'markdown-it-texmath' {
  import type { PluginWithOptions } from 'markdown-it';
  import type { KatexOptions } from 'katex';
  const texmath: PluginWithOptions<{
    engine: typeof import('katex'); delimiters: string[]; katexOptions: KatexOptions;
  }>;
  export default texmath;
}
