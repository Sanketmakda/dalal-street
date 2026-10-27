'use strict';
// Syntax-check every inline <script> in index.html (a syntax error here blanks the whole game).
const fs = require('node:fs'), path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
if (!scripts.length) throw new Error('no inline scripts found');
scripts.forEach((m, i) => { new Function(m[1]); console.log(`index.html script ${i}: syntax OK`); });
