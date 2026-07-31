const fs = require('fs');
const file = process.argv[2];
const r = JSON.parse(fs.readFileSync(file, 'utf8'));
console.log('total:', r.numTotalTests, 'passed:', r.numPassedTests, 'failed:', r.numFailedTests);
r.testResults.forEach(t => t.assertionResults.filter(a => a.status !== 'passed').forEach(a => {
  console.log('FAIL:', a.fullName);
  if (a.failureMessages && a.failureMessages.length) {
    a.failureMessages.forEach(m => console.log('   ', m.split('\n')[0]));
  }
}));
