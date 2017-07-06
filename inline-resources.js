'use strict';

const fs = require('fs');
const path = require('path');
const glob = require('glob');
const less = require('less');
const NpmImportPlugin = require("less-plugin-npm-import");

const readFile = promiseify(fs.readFile);
const writeFile = promiseify(fs.writeFile);

/**
 * Inline resources in a tsc/ngc compilation.
 * @param projectPath {string} Path to the project.
 */
function inlineResources(projectPath) {
  // Match only TypeScript files in projectPath.
  const files = glob.sync('**/*.ts', {cwd: projectPath});

  // For each file, inline the templates and styles under it and write the new file.
  return Promise.all(files.map(filePath => {
    const fullFilePath = path.join(projectPath, filePath);

    return readFile(fullFilePath, 'utf-8')
      .then(content => {
        const resolver = url => path.join(path.dirname(fullFilePath), url);
        return inlineResourcesFromString(content, resolver);
      })
      .then(content => writeFile(fullFilePath, content))
      .catch(err => {
        console.error('An error occured: ', err);
      });
  }));
}

/**
 * Inline resources from a string content.
 * @param content {string} The source file's content.
 * @param urlResolver {Function} A resolver that takes a URL and return a path.
 * @returns {string} The content with resources inlined.
 */
function inlineResourcesFromString(content, urlResolver) {
  // Curry through the inlining functions.
  return [
    inlineTemplate,
    inlineStyle
  ].reduce(
    (c, fn) => c.then(cn => fn(cn, urlResolver)),
    Promise.resolve(content)
  );
}

/**
 * Inline the templates for a source file. Simply search for instances of `templateUrl: ...` and
 * replace with `template: ...` (with the content of the file included).
 * @param content {string} The source file's content.
 * @param urlResolver {Function} A resolver that takes a URL and return a path.
 * @return {string} The content with all templates inlined.
 */
function inlineTemplate(content, urlResolver) {
  return content.replace(/templateUrl:\s*'([^']+?\.html)'/g, function (m, templateUrl) {
    const templateFile = urlResolver(templateUrl);
    const templateContent = fs.readFileSync(templateFile, 'utf-8');
    const shortenedTemplate = templateContent
      .replace(/([\n\r]\s*)+/gm, ' ')
      .replace(/"/g, '\\"');
    return `template: "${shortenedTemplate}"`;
  });
}


/**
 * Inline the styles for a source file. Simply search for instances of `styleUrls: [...]` and
 * replace with `styles: [...]` (with the content of the file included).
 * @param urlResolver {Function} A resolver that takes a URL and return a path.
 * @param content {string} The source file's content.
 * @return {string} The content with all styles inlined.
 */
function inlineStyle(content, urlResolver) {
  const stylesRegEx = /styleUrls:\s*(\[[\s\S]*?\])/gm;

  const result = stylesRegEx.exec(content);

  if (result !== null) {
    const contents = eval(result[1])
      .map(urlResolver)
      .map(u =>
        readFile(u, 'utf-8')
          .then(c => u.endsWith('.less') ? renderLess(c, u) : c)
          .then(c => c.replace(/([\n\r]\s*)+/gm, ' ').replace(/"/g, '\\"'))
      );

    return Promise.all(contents)
      .then(c => c.join(',\n'))
      .then(c => `styles: ['${c}']`)
      .then(c => content.replace(stylesRegEx, c))
  }

  return content;
}

module.exports = inlineResources;
module.exports.inlineResourcesFromString = inlineResourcesFromString;

// Run inlineResources if module is being called directly from the CLI with arguments.
if (require.main === module && process.argv.length > 2) {
  console.log('Inlining resources from project:', process.argv[2]);
  return inlineResources(process.argv[2]);
}

/**
 * Simple Promiseify function that takes a Node API and return a version that supports promises.
 * We use promises instead of synchronized functions to make the process less I/O bound and
 * faster. It also simplifies the code.
 */
function promiseify(fn) {
  return function () {
    const args = [].slice.call(arguments, 0);
    return new Promise((resolve, reject) => {
      fn.apply(this, args.concat([function (err, value) {
        if (err) {
          reject(err);
        } else {
          resolve(value);
        }
      }]));
    });
  };
}

function renderLess(content, filename) {
  const render = promiseify(less.render.bind(less));

  const plugins = [new NpmImportPlugin({prefix: '~'})];

  return render(content, { plugins, filename }).then(x => x.css);
}
