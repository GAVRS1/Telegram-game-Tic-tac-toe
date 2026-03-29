import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

const runtimeClientPath = path.join(root, 'client', 'src', 'main.jsx');
if (!fs.existsSync(runtimeClientPath)) {
  console.error('❌ Runtime client is not found in client/src/main.jsx');
  process.exit(1);
}

const forbiddenLegacyPaths = [
  path.join(root, 'public', 'js'),
  path.join(root, 'public', 'index.html'),
  path.join(root, 'public', 'styles.css'),
];

const found = forbiddenLegacyPaths.filter((target) => fs.existsSync(target));

if (found.length > 0) {
  console.error('❌ Found legacy production client artifacts:');
  found.forEach((target) => {
    console.error(` - ${path.relative(root, target)}`);
  });
  console.error('Keep only React/Vite runtime client in client/.');
  process.exit(1);
}

console.log('✅ Single runtime client check passed: only React/Vite client remains.');
