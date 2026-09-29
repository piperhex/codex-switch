// Use highlight.js language identifiers, including languages outside its common bundle.
const LANGUAGES: Record<string, string> = {
  ts: "typescript", tsx: "typescript", mts: "typescript", cts: "typescript",
  js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
  json: "json", jsonc: "json", json5: "json", geojson: "json", ipynb: "json",
  html: "xml", htm: "xml", xhtml: "xml", xml: "xml", svg: "xml", vue: "xml", svelte: "xml",
  xsl: "xml", xslt: "xml", xsd: "xml", plist: "xml", csproj: "xml", props: "xml", targets: "xml",
  css: "css", scss: "scss", sass: "scss", less: "less", styl: "stylus",
  yaml: "yaml", yml: "yaml", toml: "ini", ini: "ini", cfg: "ini", conf: "ini", properties: "properties",
  env: "bash", sh: "bash", bash: "bash", zsh: "bash", fish: "shell", ps1: "powershell",
  psm1: "powershell", psd1: "powershell", bat: "dos", cmd: "dos",
  py: "python", pyi: "python", pyw: "python", r: "r", rmd: "markdown", jl: "julia",
  rs: "rust", go: "go", java: "java", kt: "kotlin", kts: "kotlin", scala: "scala", sc: "scala",
  c: "c", h: "c", cc: "cpp", cpp: "cpp", cxx: "cpp", hpp: "cpp", hh: "cpp", hxx: "cpp",
  ino: "cpp", cu: "cpp", cs: "csharp", fs: "fsharp", fsx: "fsharp", vb: "vbnet",
  swift: "swift", m: "objectivec", mm: "objectivec", dart: "dart", php: "php", phtml: "php",
  rb: "ruby", rake: "ruby", gemspec: "ruby", pl: "perl", pm: "perl", lua: "lua",
  ex: "elixir", exs: "elixir", erl: "erlang", hrl: "erlang", hs: "haskell", lhs: "haskell",
  clj: "clojure", cljs: "clojure", cljc: "clojure", edn: "clojure", lisp: "lisp", el: "lisp",
  scm: "scheme", ss: "scheme", ml: "ocaml", mli: "ocaml", sml: "sml", nim: "nim", v: "verilog",
  sv: "verilog", vhd: "vhdl", vhdl: "vhdl", f: "fortran", f90: "fortran", f95: "fortran",
  pas: "delphi", d: "d", hx: "haxe", groovy: "groovy", gradle: "gradle", coffee: "coffeescript",
  sql: "sql", graphql: "graphql", gql: "graphql", proto: "protobuf", thrift: "thrift",
  md: "markdown", markdown: "markdown", mdown: "markdown", mkd: "markdown", mdx: "markdown",
  tex: "latex", latex: "latex", bib: "bibtex", adoc: "asciidoc", asciidoc: "asciidoc",
  diff: "diff", patch: "diff", cmake: "cmake", mak: "makefile", mk: "makefile",
  dockerfile: "dockerfile", nginx: "nginx", asm: "x86asm", s: "x86asm", wat: "wasm",
  ahk: "autohotkey", au3: "autoit", awk: "awk", tcl: "tcl", tk: "tcl", vbs: "vbscript",
  hbs: "handlebars", handlebars: "handlebars", mustache: "handlebars", twig: "twig", erb: "erb",
  haml: "haml", glsl: "glsl", vert: "glsl", frag: "glsl", cl: "opencl", scad: "openscad",
  ps: "postscript", eps: "postscript", http: "http", rest: "http", feature: "gherkin",
};
const NAMES: Record<string, string> = {
  dockerfile: "dockerfile", containerfile: "dockerfile", makefile: "makefile", gnumakefile: "makefile",
  "cmakelists.txt": "cmake", gemfile: "ruby", rakefile: "ruby", vagrantfile: "ruby",
  jenkinsfile: "groovy", "nginx.conf": "nginx", ".gitignore": "plaintext", ".gitattributes": "plaintext",
  ".npmrc": "ini", ".editorconfig": "ini", ".bashrc": "bash", ".zshrc": "bash", ".profile": "bash",
};

export function fileLanguage(path: string, text = ""): string {
  const name = path.split(/[\\/]/).at(-1)?.toLowerCase() ?? "";
  if (NAMES[name]) return NAMES[name];
  if (/^(dockerfile|containerfile)(\.|$)/.test(name)) return "dockerfile";
  if (/^\.env(\.|$)/.test(name)) return "bash";
  const extension = name.split(".").at(-1) ?? "";
  if (LANGUAGES[extension]) return LANGUAGES[extension];
  const interpreter = text.match(/^#![^\n]*\b(python[\d.]*|node|ruby|perl|bash|sh|zsh|pwsh)\b/)?.[1];
  if (interpreter?.startsWith("python")) return "python";
  return ({ node: "javascript", ruby: "ruby", perl: "perl", bash: "bash", sh: "bash",
    zsh: "bash", pwsh: "powershell" } as Record<string, string>)[interpreter ?? ""] ?? "";
}
