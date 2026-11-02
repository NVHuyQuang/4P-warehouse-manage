#!/usr/bin/env node

/**
 * scripts/guard-price-leak.js
 *
 * Verifies that zero confidential price, cost, tax, or vendor data leak into
 * schema, types, fixtures, or components.
 *
 * Forbidden terms (case-insensitive):
 *  - "Price"
 *  - "Total Tax"
 *  - "Net Tax Amount"
 *  - "Row Total"
 *  - "Gross Total"
 *  - "Vendor Name"
 *  - "Vendor Address"
 *
 * Excludes:
 *  - Raw SAP parser allowlist definitions (e.g., dropping columns in lib/sap, app/api/grpo, tests)
 *  - Documentation (docs/, ui-design/)
 *  - Build/tooling artifacts (.git, node_modules, .next, etc.)
 *  - The guard scripts themselves
 */

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');

const FORBIDDEN_RULES = [
  { name: 'Price', pattern: /(?:(?:\b|_)price[a-z]*(?:\b|_)|[a-z0-9]Price[a-zA-Z]*)/i },
  { name: 'Total Tax', pattern: /(?:total[_\s-]?tax|totalTax)/i },
  { name: 'Net Tax Amount', pattern: /(?:net[_\s-]?tax[_\s-]?amount|netTaxAmount)/i },
  { name: 'Row Total', pattern: /(?:row[_\s-]?total|rowTotal)/i },
  { name: 'Gross Total', pattern: /(?:gross[_\s-]?total|grossTotal)/i },
  { name: 'Vendor Name', pattern: /(?:vendor[_\s-]?name|vendorName)/i },
  { name: 'Vendor Address', pattern: /(?:vendor[_\s-]?address|vendorAddress)/i },
];

const IGNORED_DIRS = new Set([
  '.git',
  '.worktrees',
  'node_modules',
  '.next',
  'dist',
  'out',
  'test-results',
  'playwright-report',
  'blob-report',
  'docs',
  'ui-design',
  '.branches',
  '.temp'
]);

const IGNORED_FILES = new Set([
  'package.json',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'scripts/guard-price-leak.js',
  'scripts/guard-price-leak.sh'
]);

// Directories or patterns where raw SAP parser allowlist definitions reside
const SAP_PARSER_PATHS = [
  /lib[\\\/]sap/,
  /app[\\\/]api[\\\/]grpo/,
  /tests[\\\/]unit[\\\/]sap_parser/
];

// Patterns inside SAP parser files that denote allowlist/drop definitions
const SAP_ALLOWLIST_LINE_PATTERNS = [
  /allowlist/i,
  /sap-raw-allowlist/i,
  /drop(?:ped|ping)?(?:_columns|_headers)?/i,
  /confidential(?:_columns)?/i,
  /forbidden(?:_columns)?/i,
  /banned(?:_columns)?/i,
  /strip/i,
  /omit/i,
  /raw_headers/i,
  /sap_headers/i
];

function isSapParserFile(relPath) {
  return SAP_PARSER_PATHS.some(regex => regex.test(relPath));
}

function isAllowlistLine(line, relPath) {
  // Explicit line directive anywhere in the codebase
  if (/sap-raw-allowlist|@allow-price-leak/i.test(line)) {
    return true;
  }
  // If inside SAP parser file, allow lines matching drop/allowlist semantics
  if (isSapParserFile(relPath)) {
    return SAP_ALLOWLIST_LINE_PATTERNS.some(rx => rx.test(line));
  }
  return false;
}

function scanFile(filePath) {
  const relPath = path.relative(ROOT_DIR, filePath).replace(/\\/g, '/');
  if (IGNORED_FILES.has(relPath) || relPath.startsWith('scripts/')) {
    return [];
  }

  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/);
  const violations = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isAllowlistLine(line, relPath)) {
      continue;
    }

    for (const rule of FORBIDDEN_RULES) {
      if (rule.pattern.test(line)) {
        violations.push({
          file: relPath,
          lineNum: i + 1,
          term: rule.name,
          line: line.trim()
        });
        break; // one violation per line is enough
      }
    }
  }

  return violations;
}

function walkDir(dir) {
  let results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (IGNORED_DIRS.has(entry.name)) {
      continue;
    }

    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results = results.concat(walkDir(fullPath));
    } else if (entry.isFile()) {
      results.push(fullPath);
    }
  }

  return results;
}

function main() {
  console.log('==> Running Price Leak Guard...');
  const allFiles = walkDir(ROOT_DIR);
  const allViolations = [];

  for (const file of allFiles) {
    const violations = scanFile(file);
    if (violations.length > 0) {
      allViolations.push(...violations);
    }
  }

  if (allViolations.length > 0) {
    console.error('\n❌ PRICE LEAK DETECTED: Forbidden words found in codebase:');
    for (const v of allViolations) {
      console.error(`  - ${v.file}:${v.lineNum} [${v.term}] -> ${v.line}`);
    }
    console.error(`\nTotal violations: ${allViolations.length}`);
    process.exit(1);
  }

  console.log('✅ Price Leak Guard passed: 0 forbidden words detected.');
  process.exit(0);
}

main();
