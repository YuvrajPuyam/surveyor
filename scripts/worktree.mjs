#!/usr/bin/env node
// Git worktree helper. Keeps every worktree under .worktrees/ (gitignored),
// copies .env into new worktrees, and installs dependencies so the checkout
// is immediately runnable.
//
//   npm run wt -- add <branch> [base]   create .worktrees/<branch> (new branch off [base], default main)
//   npm run wt -- list                  show all worktrees
//   npm run wt -- remove <branch>       remove the worktree (branch itself is kept)

import { execFileSync, execSync } from 'node:child_process';
import { existsSync, copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

const root = git('rev-parse', '--show-toplevel');
const wtRoot = join(root, '.worktrees');
const [cmd, branch, base] = process.argv.slice(2);

function dirFor(branchName) {
  // feat/foo -> .worktrees/feat-foo (slashes would nest directories)
  return join(wtRoot, branchName.replaceAll('/', '-'));
}

function usage() {
  console.log('usage: npm run wt -- add <branch> [base] | list | remove <branch>');
  process.exit(1);
}

if (cmd === 'list') {
  console.log(git('worktree', 'list'));
} else if (cmd === 'add' && branch) {
  mkdirSync(wtRoot, { recursive: true });
  const dir = dirFor(branch);
  if (existsSync(dir)) {
    console.error(`worktree already exists: ${dir}`);
    process.exit(1);
  }

  const branchExists =
    execFileSync('git', ['branch', '--list', branch], { encoding: 'utf8' }).trim() !== '';
  if (branchExists) {
    git('worktree', 'add', dir, branch);
  } else {
    git('worktree', 'add', '-b', branch, dir, base ?? 'main');
  }
  console.log(`created ${dir} on branch ${branch}`);

  // .env is gitignored, so worktrees don't get it from the checkout.
  const env = join(root, '.env');
  if (existsSync(env)) {
    copyFileSync(env, join(dir, '.env'));
    console.log('copied .env');
  }

  for (const pkgDir of [dir, join(dir, 'app')]) {
    if (existsSync(join(pkgDir, 'package.json'))) {
      console.log(`npm install in ${pkgDir} ...`);
      execSync('npm install', { cwd: pkgDir, stdio: 'inherit' });
    }
  }
  console.log(`\nready: cd ${dir}`);
} else if (cmd === 'remove' && branch) {
  git('worktree', 'remove', dirFor(branch));
  console.log(`removed worktree for ${branch} (branch kept; delete with: git branch -d ${branch})`);
} else {
  usage();
}
