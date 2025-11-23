const Ajv = require("ajv");
const standaloneCode = require("ajv/dist/standalone").default;
const fs = require("fs");
const path = require("path");

// Add any other schemas you use here
const schemas = {
  "json-schema-secure": require("ajv/lib/refs/json-schema-secure.json"),
};

const ajv = new Ajv({
  schemas: Object.values(schemas),
  code: { source: true }, // Required for standalone code generation
});

const moduleCode = standaloneCode(ajv);

const outputPath = path.join(__dirname, "../src/ajv-validators.js");

fs.writeFileSync(outputPath, moduleCode);

console.log(`✅ AJV validators compiled to ${outputPath}`);