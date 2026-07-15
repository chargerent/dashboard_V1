import fs from 'node:fs';

const flowPath = process.argv[2];
if (!flowPath) throw new Error('Usage: node install-kiosk-profile-admin-flow.mjs /path/to/flow.json');

const flow = JSON.parse(fs.readFileSync(flowPath, 'utf8'));
const mustFind = (id, name) => {
  const node = flow.find((candidate) => candidate.id === id);
  if (!node) throw new Error(`Missing Node-RED node: ${name} (${id})`);
  return node;
};

const changeUi = mustFind('1be654ec.c9af3b', 'change UI');
const applyProfile = mustFind('f7d9dbc5396902c8', 'apply dashboard global.languages profile');
const languageResolver = mustFind('ui_global_language_resolver_fn', 'global.languages -> msg.view');
const responseStyleProfile = applyProfile.func.includes('const response = msg.payload');
applyProfile.func = applyProfile.func.replace('/^\\d{5}$/', '/^[1-5]{5}$/');

const passwordRules = [
  {
    t: 'set',
    p: 'kiosk.admin.userpassword',
    pt: 'global',
    to: 'payload.kiosk.admin.userpassword',
    tot: 'msg',
  },
  {
    t: 'set',
    p: 'kiosk.admin.adminpassword',
    pt: 'global',
    to: 'payload.kiosk.admin.adminpassword',
    tot: 'msg',
  },
];

for (const rule of passwordRules.reverse()) {
  if (!changeUi.rules.some((candidate) => candidate.pt === 'global' && candidate.p === rule.p)) {
    const kioskMessageRuleIndex = changeUi.rules.findIndex((candidate) => candidate.pt === 'msg' && candidate.p === 'kiosk');
    changeUi.rules.splice(kioskMessageRuleIndex < 0 ? changeUi.rules.length : kioskMessageRuleIndex, 0, rule);
  }
}

if (!applyProfile.func.includes('const profileAdmin = response.admin')) {
  applyProfile.func = applyProfile.func.replace(
    'const colors = response.colors;',
    'const colors = response.colors;\nconst profileUi = response.ui && typeof response.ui === "object" ? response.ui : {};\nconst profileAdmin = response.admin && typeof response.admin === "object" ? response.admin : {};',
  );
}
if (!applyProfile.func.includes('const profileAdmin =') && applyProfile.func.includes('const incoming =')) {
  applyProfile.func = applyProfile.func.replace(
    'const incoming = msg.payload?.newlanguage || msg.payload?.languages;',
    'const incoming = msg.payload?.newlanguage || msg.payload?.languages;\nconst profileUi = msg.payload?.ui && typeof msg.payload.ui === "object" ? msg.payload.ui : {};\nconst profileAdmin = msg.payload?.admin && typeof msg.payload.admin === "object" ? msg.payload.admin : {};',
  );
}

if (!applyProfile.func.includes('const profileUi =')) {
  applyProfile.func = applyProfile.func.replace(
    'const profileAdmin =',
    `${responseStyleProfile
      ? 'const profileUi = response.ui && typeof response.ui === "object" ? response.ui : {};'
      : 'const profileUi = msg.payload?.ui && typeof msg.payload.ui === "object" ? msg.payload.ui : {};'}\nconst profileAdmin =`,
  );
}

if (!applyProfile.func.includes('function validPin(value)')) {
  applyProfile.func = applyProfile.func.replace(
    'function validColor(value) {\n    return /^#[0-9a-f]{6}$/i.test(String(value || ""));\n}',
    'function validColor(value) {\n    return /^#[0-9a-f]{6}$/i.test(String(value || ""));\n}\n\nfunction validPin(value) {\n    return !value || /^[1-5]{5}$/.test(String(value));\n}',
  );
  if (!applyProfile.func.includes('function validPin(value)')) {
    applyProfile.func = applyProfile.func.replace(
      'function isObject(value) {\n    return Boolean(value) && typeof value === "object" && !Array.isArray(value);\n}',
      'function isObject(value) {\n    return Boolean(value) && typeof value === "object" && !Array.isArray(value);\n}\n\nfunction validPin(value) {\n    return !value || /^[1-5]{5}$/.test(String(value));\n}',
    );
  }
}

if (!applyProfile.func.includes('text: "invalid profile PIN"')) {
  applyProfile.func = applyProfile.func.replace(
    '// Apply the profile atomically.',
    'if (!validPin(profileAdmin.userpassword) || !validPin(profileAdmin.adminpassword)) {\n    node.status({ fill: "red", shape: "ring", text: "invalid profile PIN" });\n    return [null, null];\n}\n\n// Apply the profile atomically.',
  );
}

if (!applyProfile.func.includes('kiosk.admin = Object.assign')) {
  applyProfile.func = applyProfile.func.replace(
    'global.set("kiosk", kiosk);',
    'kiosk.admin = Object.assign({}, kiosk.admin || {});\nif (profileAdmin.userpassword) kiosk.admin.userpassword = String(profileAdmin.userpassword);\nif (profileAdmin.adminpassword) kiosk.admin.adminpassword = String(profileAdmin.adminpassword);\n\nglobal.set("kiosk", kiosk);',
  );
  if (!applyProfile.func.includes('kiosk.admin = Object.assign')) {
    applyProfile.func = applyProfile.func.replace(
      'global.set("languages", merged);',
      'const kiosk = global.get("kiosk") || {};\nkiosk.admin = Object.assign({}, kiosk.admin || {});\nif (validPin(profileAdmin.userpassword) && profileAdmin.userpassword) kiosk.admin.userpassword = String(profileAdmin.userpassword);\nif (validPin(profileAdmin.adminpassword) && profileAdmin.adminpassword) kiosk.admin.adminpassword = String(profileAdmin.adminpassword);\nglobal.set("kiosk", kiosk);\n\nglobal.set("languages", merged);',
    );
  }
}

if (!applyProfile.func.includes('const profileButtonKeys =')) {
  const languageActiveExpression = responseStyleProfile ? 'languages.active' : 'incoming.active';
  applyProfile.func = applyProfile.func.replace(
    'kiosk.admin = Object.assign({}, kiosk.admin || {});',
    `kiosk.ui = Object.assign({}, kiosk.ui || {});\nconst profileButtonKeys = ["map", "terms", "languages", "information", "receipt"];\nfor (const key of profileButtonKeys) {\n    const configured = key === "languages" && typeof ${languageActiveExpression} === "boolean"\n        ? ${languageActiveExpression}\n        : profileUi[key]?.active;\n    if (typeof configured === "boolean") {\n        kiosk.ui[key] = Object.assign({}, kiosk.ui[key] || {}, { active: configured });\n    }\n}\n\nkiosk.admin = Object.assign({}, kiosk.admin || {});`,
  );
}

languageResolver.func = languageResolver.func.replace(
  'languageButton: enabled(featureConfig.languageButton, supportedLocales.length > 1),',
  'languageButton: enabled(ui.languages?.active, enabled(featureConfig.languageButton, supportedLocales.length > 1)),',
);

if (!languageResolver.func.includes('rental_thank_you_page') || !languageResolver.func.includes('msg.enabled = features.receipt')) {
  languageResolver.func = languageResolver.func.replace(
    'node.status({ fill: "green", shape: "dot", text: code + " / " + market });',
    'const resolvedScreen = clean(env.get("SCREEN")) || clean(msg.uiScreen) || clean(msg.pricingTarget);\nif (resolvedScreen === "rental_thank_you_page") {\n    msg.enabled = features.receipt;\n}\n\nnode.status({ fill: "green", shape: "dot", text: code + " / " + market });',
  );
}

fs.writeFileSync(flowPath, `${JSON.stringify(flow)}\n`);
console.log(`Updated kiosk profile admin flow: ${flowPath}`);
