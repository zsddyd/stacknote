"use strict";
(function () {
  const SN = window.SN;
  const K = (s) => s.split(/\s+/).filter(Boolean);

  const LANGS = {
    txt: { name: "TXT", ext: ["txt", "text", "log", "nfo", "md5"], kw: "" },
    c: { name: "C", ext: ["c", "h"], line: "//", block: ["/*", "*/"],
      kw: "auto break case char const continue default do double else enum extern float for goto if int long register return short signed sizeof static struct switch typedef union unsigned void volatile while inline restrict _Bool _Complex" },
    cpp: { name: "C++", ext: ["cpp", "cc", "cxx", "hpp", "hh", "hxx", "h", "c"], line: "//", block: ["/*", "*/"], heredoc: "R\"",
      kw: "alignas alignof and and_eq asm auto bitand bitor bool break case catch char class compl const constexpr const_cast continue decltype default delete do double dynamic_cast else enum explicit export extern false float for friend goto if inline int long mutable namespace new noexcept not not_eq nullptr operator or or_eq private protected public register reinterpret_cast return short signed sizeof static static_assert static_cast struct switch template this thread_local throw true try typedef typeid typename union unsigned using virtual void volatile wchar_t while xor xor_eq final override" },
    csharp: { name: "C#", ext: ["cs"], line: "//", block: ["/*", "*/"],
      kw: "abstract as base bool break byte case catch char checked class const continue decimal default delegate do double else enum event explicit extern false finally fixed float for foreach goto if implicit in int interface internal is lock long namespace new null object operator out override params private protected public readonly ref return sbyte sealed short sizeof stackalloc static string struct switch this throw true try typeof uint ulong unchecked unsafe ushort using virtual void volatile while var async await get set value where yield record init required" },
    java: { name: "Java", ext: ["java"], line: "//", block: ["/*", "*/"],
      kw: "abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for goto if implements import instanceof int interface long native new package private protected public return short static strictfp super switch synchronized this throw throws transient try void volatile while true false null var" },
    javascript: { name: "JavaScript", ext: ["js", "mjs", "cjs", "jsx"], line: "//", block: ["/*", "*/"],
      kw: "break case catch class const continue debugger default delete do else export extends false finally for function if import in instanceof let new null return static super switch this throw true try typeof var void while with yield async await of get set" },
    typescript: { name: "TypeScript", ext: ["ts", "tsx", "mts", "cts"], line: "//", block: ["/*", "*/"],
      kw: "break case catch class const continue debugger declare default delete do else enum export extends false finally for function if import in instanceof interface let namespace new null number object private protected public return string static super switch this throw true try type typeof undefined var void while with yield async await abstract readonly implements keyof never any unknown" },
    python: { name: "Python", ext: ["py", "pyw"], line: "#", block: ["'''", "'''"], tri: true,
      kw: "and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return True try while with yield match case" },
    ruby: { name: "Ruby", ext: ["rb", "rake"], line: "#", block: ["=begin", "=end"],
      kw: "alias and begin break case class def defined do else elsif end ensure false for if in module next nil not or redo rescue retry return self super then true undef unless until when while yield require require_relative attr_reader attr_writer attr_accessor" },
    php: { name: "PHP", ext: ["php", "php3", "php4", "php5", "phtml"], line: "//", block: ["/*", "*/"], alsoLine: "#",
      kw: "abstract and array as break callable case catch class clone const continue declare default die do echo else elseif empty enddeclare endfor endforeach endif endswitch endwhile eval exit extends final finally fn for foreach function global goto if implements include include_once instanceof insteadof interface isset list namespace new or print private protected public readonly require require_once return static switch throw trait try unset use var while xor yield match enum" },
    go: { name: "Go", ext: ["go"], line: "//", block: ["/*", "*/"],
      kw: "break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var" },
    rust: { name: "Rust", ext: ["rs"], line: "//", block: ["/*", "*/"],
      kw: "as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while" },
    swift: { name: "Swift", ext: ["swift"], line: "//", block: ["/*", "*/"],
      kw: "associatedtype class deinit enum extension fileprivate func import init inout internal let open operator private protocol public rethrows static struct subscript typealias var break case continue default defer do else fallthrough for guard if in repeat return switch where while as any catch false is nil self Self super throw throws true try" },
    shell: { name: "Shell", ext: ["sh", "bash", "zsh"], line: "#",
      kw: "if then else elif fi case esac for while until do done function in select time coproc return exit break continue local readonly export unset set shift trap source alias declare echo printf cd pwd mkdir rm cp mv test true false null" },
    batch: { name: "Batch", ext: ["bat", "cmd"], line: "REM", ci: true,
      kw: "echo if else goto call set for in do not exist defined errorlevel pause rem cd md rd copy del move cls exit pushd popd shift start title color type find findstr where choice timeout" },
    powershell: { name: "PowerShell", ext: ["ps1", "psm1"], line: "#",
      kw: "begin break catch class continue data define do dynamicparam else elseif end exit filter finally for foreach from function if in param process return switch throw trap try until using var while workflow parallel sequence" },
    css: { name: "CSS", ext: ["css", "scss", "less", "sass"], block: ["/*", "*/"],
      kw: "position absolute relative fixed static sticky display block inline inline-block flex grid none table visible hidden auto margin padding border color background font text width height min-width max-width min-height max-height top right bottom left z-index overflow float clear opacity transform transition animation box-sizing content flex-direction justify-content align-items cursor" },
    html: { name: "HTML", ext: ["html", "htm", "xhtml"], tag: true, block: ["<!--", "-->"],
      kw: "html head body title meta link script style div span p a img ul ol li table tr td th thead tbody form input button textarea select option label h1 h2 h3 h4 h5 h6 br hr section article nav header footer main aside canvas video audio iframe em strong small code pre blockquote" },
    xml: { name: "XML", ext: ["xml", "xsl", "xslt", "svg", "ui", "qrc", "plist", "svgz", "xaml", "csproj", "proj", "vcxproj"], tag: true, block: ["<!--", "-->"], kw: "" },
    json: { name: "JSON", ext: ["json", "geojson", "webmanifest"], block: [], kw: "" },
    yaml: { name: "YAML", ext: ["yaml", "yml"], line: "#", kw: "true false null yes no on off" },
    ini: { name: "INI", ext: ["ini", "cfg", "conf", "inf", "reg"], line: [";", "#"], kw: "" },
    properties: { name: "Properties", ext: ["properties", "env"], line: ["#", "!"], kw: "" },
    makefile: { name: "Makefile", ext: ["mak", "mk"], line: "#", kw: "ifeq ifneq else endif include -include define endef export unexport override private vpath" },
    sql: { name: "SQL", ext: ["sql"], line: "--", block: ["/*", "*/"], ci: true,
      kw: "select from where insert into values update delete create table index view drop alter add column primary key foreign references not null unique default constraint check join inner left right full outer on group by order having limit offset union all distinct as asc desc between like in exists and or is case when then else end begin commit rollback transaction database use" },
    lua: { name: "Lua", ext: ["lua"], line: "--", block: ["--[[", "]]"],
      kw: "and break do else elseif end false for function goto if in local nil not or repeat return then true until while" },
    r: { name: "R", ext: ["r", "R"], line: "#", kw: "if else repeat while function for in next break TRUE FALSE NULL Inf NaN NA library require return" },
    diff: { name: "Diff", ext: ["diff", "patch"], line: "", kw: "", diff: true },
    markdown: { name: "MarkDown", ext: ["md", "markdown", "mkd"], line: "", kw: "", md: true },
    cmake: { name: "CMake", ext: ["cmake", "CMakeLists.txt"], line: "#", kw: "cmake_minimum_required project add_executable add_library add_subdirectory target_link_libraries include_directories set if else elseif endif foreach endforeach while endwhile function endfunction macro endmacro option message find_package install" },
    verilog: { name: "Verilog", ext: ["v", "sv", "svh"], line: "//", block: ["/*", "*/"],
      kw: "module endmodule input output inout wire reg assign always if else begin end case endcase parameter localparam genvar generate endgenerate initial posedge negedge or and not function endfunction task endtask integer real time for while" },
    vhdl: { name: "VHDL", ext: ["vhd", "vhdl"], line: "--", kw: "entity architecture begin end signal port process if then else elsif case when is library use all and or not in out buffer std_logic std_logic_vector integer boolean" },
    ruby_dup: {}
  };
  delete LANGS.ruby_dup;

  // 每个语言规整为 kw 数组 + 小写集合（用于快速匹配）
  function normalize(l) {
    l.kw = K(l.kw || "");
    if (l.ci) l.kwSet = {}; else l.kwSet = undefined;
    if (l.ci) { l.kw.forEach(w => l.kwSet[w.toLowerCase()] = 1); }
    return l;
  }
  Object.keys(LANGS).forEach(k => normalize(LANGS[k]));

  const EXT_MAP = {};
  Object.keys(LANGS).forEach(id => {
    const l = LANGS[id];
    (l.ext || []).forEach(ext => {
      const key = ext.toLowerCase();
      if (!EXT_MAP[key]) EXT_MAP[key] = id;
    });
  });
  // 精确映射处理 CMakeLists.txt
  EXT_MAP["cmakelists.txt"] = "cmake";

  function detectLangByName(name) {
    if (!name) return "txt";
    const n = name.toLowerCase();
    if (n === "cmakelists.txt" || n === "makefile") return n === "makefile" ? "makefile" : "cmake";
    if (n.endsWith(".mk")) return "makefile";
    const dot = n.lastIndexOf(".");
    if (dot < 0) return "txt";
    return EXT_MAP[n.slice(dot + 1)] || "txt";
  }

  function registerUserLang(cfg) { // {id,name,ext,kw,mother}
    const l = { name: cfg.name, ext: cfg.ext, line: cfg.line || "//", block: cfg.block || null, kw: cfg.kw || "", ci: !!cfg.ci };
    normalize(l);
    LANGS[cfg.id] = l;
    (l.ext || []).forEach(e => { if (!EXT_MAP[e.toLowerCase()]) EXT_MAP[e.toLowerCase()] = cfg.id; });
    return l;
  }

  SN.LANGS = LANGS;
  SN.detectLangByName = detectLangByName;
  SN.registerUserLang = registerUserLang;
  SN.langById = (id) => LANGS[id] || LANGS.txt;
  SN.langList = () => Object.keys(LANGS).map(id => ({ id, ...LANGS[id] }));
})();
