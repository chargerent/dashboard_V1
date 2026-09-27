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
