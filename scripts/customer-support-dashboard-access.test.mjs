import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const readSource = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('Customer Service navigation is admin-only and desktop-only', async () => {
  const [app, dashboard] = await Promise.all([
    readSource('../src/App.jsx'),
    readSource('../src/pages/DashboardPage.jsx'),
  ]);

  assert.match(app, /function useCustomerSupportDesktopViewport\(\)/);
  assert.match(app, /window\.matchMedia\('\(min-width: 1024px\)'\)/);
  assert.match(
      app,
      /onNavigateToCustomerSupport=\{clientInfo\?\.isAdmin === true && isCustomerSupportDesktopViewport/,
  );
  assert.match(
      app,
      /const hasCustomerSupportAccess = clientInfo\.isAdmin === true && isCustomerSupportDesktopViewport;/,
  );
  assert.match(
      dashboard,
      /const canUseCustomerSupport = isAdminUser && typeof onNavigateToCustomerSupport === 'function';/,
  );
  assert.match(dashboard, /if \(!canUseCustomerSupport\) \{/);
  assert.match(dashboard, /\}, \[canUseCustomerSupport\]\);/);
  assert.match(dashboard, /\{canUseCustomerSupport && \(/);
  assert.match(dashboard, /data-testid="customer-service-button"/);
  assert.match(dashboard, /hidden items-center justify-center[^"]*lg:inline-flex/);
});

test('Customer Service dashboard button shows the live unresolved count', async () => {
  const dashboard = await readSource('../src/pages/DashboardPage.jsx');

  assert.match(
      dashboard,
      /UNRESOLVED_SUPPORT_STATUSES = Object\.freeze\(\['new', 'in_progress', 'waiting_customer'\]\)/,
  );
  assert.match(dashboard, /collection\(db, 'supportTickets'\)/);
  assert.match(dashboard, /where\('status', 'in', UNRESOLVED_SUPPORT_STATUSES\)/);
  assert.match(dashboard, /setUnresolvedSupportCount\(snapshot\.size\)/);
  assert.match(dashboard, /unresolvedSupportCount > 99 \? '99\+' : unresolvedSupportCount/);
  assert.match(dashboard, /Customer Service, \$\{unresolvedSupportCount\} unresolved cases/);
});

test('Customer Service summary includes a clickable Pending filter', async () => {
  const supportPage = await readSource('../src/pages/CustomerSupportPage.jsx');

  assert.match(
      supportPage,
      /pending: tickets\.filter\(\(ticket\) => ticket\.status === 'waiting_customer'\)\.length/,
  );
  assert.match(
      supportPage,
      /\['Pending', summary\.pending, 'waiting_customer', 'border-violet-200 bg-violet-50 text-violet-900'\]/,
  );
  assert.match(supportPage, /lg:grid-cols-5/);
});

test('Customer Service reply editor can switch templates between English and French', async () => {
  const supportPage = await readSource('../src/pages/CustomerSupportPage.jsx');

  assert.match(supportPage, /const \[replyLanguage, setReplyLanguage\] = useState\('en'\)/);
  assert.match(supportPage, /aria-label="Reply language"/);
  assert.match(supportPage, /\{ value: 'en', label: 'EN'/);
  assert.match(supportPage, /\{ value: 'fr', label: 'FR'/);
  assert.match(supportPage, /handleReplyLanguageChange\(language\.value\)/);
  assert.match(supportPage, /replySender\.value,\s*nextLanguage,/);
});

test('Customer Service can identify and filter chatbot cases', async () => {
  const supportPage = await readSource('../src/pages/CustomerSupportPage.jsx');
  const supportBackend = await readSource('../functions/supportTickets.js');
  const functionExports = await readSource('../functions/index.js');

  assert.match(supportPage, /\{ value: 'chatbot', label: 'Chatbot' \}/);
  assert.match(supportBackend, /"website", "email", "chatbot", "sms"/);
  assert.match(supportBackend, /async function importChatbotEvent\(payload\)/);
  assert.match(functionExports, /exports\.support_chatbotEvent/);
  assert.match(functionExports, /CHATBOT_SUPPORT_WEBHOOK_TOKEN/);
  assert.match(supportPage, /label="Issue" value=\{details\.chatbotReasonLabel/);
  assert.match(supportPage, /label="Station ID" value=\{details\.chatbotStationId\}/);
  assert.match(supportPage, /label="Payment method" value=\{paymentMethodLabel/);
  assert.match(supportPage, /label="Requested amount" value=\{requestedAmountLabel/);
  assert.match(supportPage, /label="Submitted language"/);
  assert.match(supportPage, /label="Chat session"/);
});

test('Customer Service supports Twilio SMS replies and editable call routing', async () => {
  const [supportPage, routingModal, telephonyBackend, functionExports] = await Promise.all([
    readSource('../src/pages/CustomerSupportPage.jsx'),
    readSource('../src/components/Support/TelephonyRoutingModal.jsx'),
    readSource('../functions/supportTelephony.js'),
    readSource('../functions/index.js'),
  ]);

  assert.match(supportPage, /aria-label="Reply channel"/);
  assert.match(supportPage, /support_sendSmsReply/);
  assert.match(supportPage, /Call routing/);
  assert.match(routingModal, /supportTelephonyStaff/);
  assert.match(routingModal, /support_upsertTelephonyStaff/);
  assert.match(routingModal, /Primary group/);
  assert.match(routingModal, /Backup group/);
  assert.match(routingModal, /Incoming support number\(s\)/);
  assert.match(routingModal, /Calls, call history, and call cases are limited to these lines/);
  assert.match(telephonyBackend, /function splitRoutingStaff/);
  assert.match(telephonyBackend, /function staffSupportNumbers/);
  assert.match(telephonyBackend, /async function listActiveCases\(requestedLimit = 100, supportNumbers = undefined\)/);
  assert.match(functionExports, /staffSupportNumbers\(member, twilioSecretValue\(TWILIO_SUPPORT_NUMBER\)\)/);
  assert.match(functionExports, /exports\.support_twilioSms/);
  assert.match(functionExports, /exports\.support_twilioVoice/);
  assert.match(functionExports, /exports\.support_sendSmsReply/);
  assert.match(functionExports, /exports\.support_upsertTelephonyStaff/);
});

test('Customer Service includes a linked inbound and outbound call log with callback cases', async () => {
  const [supportPage, callLog, telephonyBackend, voicePromptsBackend, functionExports, rules] = await Promise.all([
    readSource('../src/pages/CustomerSupportPage.jsx'),
    readSource('../src/components/Support/CallLogModal.jsx'),
    readSource('../functions/supportTelephony.js'),
    readSource('../functions/supportVoicePrompts.js'),
    readSource('../functions/index.js'),
    readSource('../firestore.rules'),
  ]);

  assert.match(supportPage, /Call log/);
  assert.match(supportPage, /Customer requested a callback/);
  assert.match(callLog, /collection\(db, 'supportCallLogs'\)/);
  assert.match(callLog, /Inbound/);
  assert.match(callLog, /Outbound/);
  assert.match(callLog, /Callback requested/);
  assert.match(callLog, /Open case/);
  assert.match(telephonyBackend, /async function importOutboundCall/);
  assert.match(telephonyBackend, /async function requestCallback/);
  assert.match(voicePromptsBackend, /Press 1 if you would like a Chargerent support specialist to call you back/);
  assert.match(functionExports, /phase === "callback-choice"/);
  assert.match(rules, /match \/supportCallLogs\/\{callId\}/);
});

test('Customer Service accepts managed MP3 prompts with spoken fallbacks', async () => {
  const [routingModal, voicePromptsBackend, functionExports, rules] = await Promise.all([
    readSource('../src/components/Support/TelephonyRoutingModal.jsx'),
    readSource('../functions/supportVoicePrompts.js'),
    readSource('../functions/index.js'),
    readSource('../firestore.rules'),
  ]);

  assert.match(routingModal, /supportVoicePrompts/);
  assert.match(routingModal, /support_uploadVoicePrompt/);
  assert.match(routingModal, /accept="\.mp3,audio\/mpeg,audio\/mp3"/);
  assert.match(routingModal, /Voice prompts must be 8 MB or smaller/);
  assert.match(voicePromptsBackend, /MAX_VOICE_PROMPT_BYTES = 8 \* 1024 \* 1024/);
  assert.match(voicePromptsBackend, /The uploaded file does not contain valid MP3 audio/);
  assert.match(functionExports, /async function appendVoicePrompt/);
  assert.match(functionExports, /exports\.support_voicePromptMedia/);
  assert.match(functionExports, /exports\.support_uploadVoicePrompt/);
  assert.match(rules, /match \/supportVoicePrompts\/\{promptId\}/);
});
