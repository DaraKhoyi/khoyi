import fs from 'fs'; import cp from 'child_process';
const read = f => { try { return fs.readFileSync(f,'utf8'); } catch { return ''; } };
const app = read('src/App.js');
const lines = app.split('\n').length;
// component defs in App.js (function Foo( / const Foo = ( ... => with Capital name)
const comps = (app.match(/(?:^|\n)\s*(?:function [A-Z]\w+\s*\(|const [A-Z]\w+\s*=\s*(?:React\.memo\()?\s*(?:function\s*)?\()/g)||[]).length;
// inline style objects across src
const grep = (pat,glob='src') => { try { return parseInt(cp.execSync(`grep -rEo "${pat}" ${glob} 2>/dev/null | wc -l`).toString().trim())||0; } catch { return 0; } };
const inlineStyles = grep('style=\\{\\{');
const viewFiles = fs.existsSync('src/views') ? fs.readdirSync('src/views').filter(f=>/\.jsx?$/.test(f)).length : 0;
// db calls + error checks
const rpc = grep('\\.rpc\\(');
const from = grep('\\.from\\(');
const dbCalls = rpc + from;
const errChecks = grep('error\\b','src') && grep('\\{\\s*data\\s*,\\s*error','src');
const errDestructure = grep('data\\s*,\\s*error');
// theme duplication: files hardcoding the hero gold
const goldFiles = (()=>{ try { return parseInt(cp.execSync(`grep -rlE "C5A95E|CBA35C" src 2>/dev/null | wc -l`).toString().trim())||0; } catch { return 0; } })();
const wwPrism = grep('ww-prism');
console.log(JSON.stringify({
  appjs_lines: lines, appjs_components: comps, view_files_extracted: viewFiles,
  inline_style_blocks: inlineStyles, db_calls_rpc: rpc, db_calls_from: from, db_calls_total: dbCalls,
  db_calls_with_error_destructure: errDestructure, files_hardcoding_gold: goldFiles, ww_prism_refs: wwPrism,
}, null, 2));
