const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SOURCE_DIRECTORIES = ['lib', 'routes'];

const sourceFiles = () => {
  const files = [];
  SOURCE_DIRECTORIES.forEach(directory => {
    fs.readdirSync(path.join(ROOT, directory))
      .filter(x => x.endsWith('.js'))
      .forEach(x => files.push(path.join(directory, x)));
  });
  files.push('server.js');
  return files;
};

const aliasesOf = (source, directory) => {
  const aliases = {};
  const pattern = /const\s+(\w+)\s*=\s*require\('([^']+)'\)/g;
  let found = pattern.exec(source);
  while (found != null) {
    if (found[2].startsWith('.')) {
      aliases[found[1]] = path.resolve(directory, found[2]);
    }
    found = pattern.exec(source);
  }
  return aliases;
};

const membersOf = (source, alias) => {
  const pattern = new RegExp(`(?:^|[^\\w.'"\`/])${alias}\\.(\\w+)`, 'g');
  const members = new Set();
  let found = pattern.exec(source);
  while (found != null) {
    members.add(found[1]);
    found = pattern.exec(source);
  }
  return Array.from(members);
};

test('каждый вызов чужого модуля попадает в существующий экспорт', () => {
  const problems = [];
  sourceFiles().forEach(file => {
    const full = path.join(ROOT, file);
    const source = fs.readFileSync(full, 'utf8');
    const aliases = aliasesOf(source, path.dirname(full));
    Object.keys(aliases).forEach(alias => {
      const target = require(aliases[alias]);
      const exported = Object.keys(target);
      membersOf(source, alias).forEach(member => {
        if (exported.indexOf(member) < 0) {
          problems.push(`${file}: ${alias}.${member} нет в ${path.relative(ROOT, aliases[alias])}`);
        }
      });
    });
  });
  assert.deepEqual(problems, [], `вызовы несуществующих функций:\n${problems.join('\n')}`);
});

test('шаблоны не обращаются к локалам, которых им не передают', () => {
  const templates = [];
  const walk = directory => {
    fs.readdirSync(directory).forEach(entry => {
      const full = path.join(directory, entry);
      if (fs.statSync(full).isDirectory()) {
        walk(full);
        return;
      }
      if (full.endsWith('.ejs')) {
        templates.push(full);
      }
    });
  };
  walk(path.join(ROOT, 'views'));
  const ejs = require('ejs');
  templates.forEach(file => {
    const source = fs.readFileSync(file, 'utf8');
    assert.doesNotThrow(
      () => ejs.compile(source, { filename: file }),
      `шаблон ${path.relative(ROOT, file)} не компилируется`,
    );
  });
});
