// scripts/compile-schemas.js
import fs from 'fs';
import path from 'path';
import url from 'url';
import Ajv from 'ajv';
import standaloneCode from 'ajv/dist/standalone/index.js';

console.log('🚀 Running pre-build schema compilation...');

// Since we are running this from the root, we can use process.cwd()
const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const schemaPath = path.join(process.cwd(), 'src', 'schemas.json');

if (!fs.existsSync(schemaPath)) {
  console.log('`schemas.json` not found, skipping AJV compilation.');
  process.exit(0);
}

const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf-8'));

// Use a unique key for the schema, which will become the named export.
const schemaKey = 'kioskConfig';

const ajv = new Ajv({
  code: {
    source: true,
    esm: true,
    dependencies: true // Keep this for other potential dependencies
  },
});
ajv.addSchema(schema, schemaKey); // Add the schema with our key

let moduleCode = standaloneCode(ajv, { [schemaKey]: schemaKey });

// Manual fix for the persistent ajv issue with the ucs2length helper
const requireStatement = `const func2 = require("ajv/dist/runtime/ucs2length").default;`;
const importStatement = `import func2 from "ajv/dist/runtime/ucs2length.js";`;

if (moduleCode.includes(requireStatement)) {
  moduleCode = moduleCode.replace(requireStatement, importStatement);
  console.log('✅ Manually patched require() to import() for ucs2length.');
}

const outputPath = path.join(process.cwd(), 'src', 'utils', 'validators.js');

fs.writeFileSync(outputPath, moduleCode);
console.log('✅ AJV validators compiled successfully to:', outputPath);
