import test from 'node:test';
import assert from 'node:assert/strict';
import { versionar } from '../src/versao.js';

test('versiona imports relativos e src/href, sem mexer em links externos', () => {
  const js = "import { a } from './comum.js';\nimport {b} from \"./tse.js\";\nconst m = await import('./x.js');\nimport z from 'https://cdn/x.js';";
  assert.equal(versionar(js, '.js', 'abc'),
    "import { a } from './comum.js?v=abc';\nimport {b} from \"./tse.js?v=abc\";\nconst m = await import('./x.js?v=abc');\nimport z from 'https://cdn/x.js';");
  const html = '<link rel="stylesheet" href="style.css"><script src="tema.js"></script><a href="https://x.org/a.js">x</a><script type="module" src="logs.js"></script><a href="brancos.html">b</a>';
  assert.equal(versionar(html, '.html', '9'),
    '<link rel="stylesheet" href="style.css?v=9"><script src="tema.js?v=9"></script><a href="https://x.org/a.js">x</a><script type="module" src="logs.js?v=9"></script><a href="brancos.html">b</a>');
});
