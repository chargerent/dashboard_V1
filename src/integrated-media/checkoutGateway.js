const normalize = value => typeof value === 'string' ? value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_') : '';

export function checkoutGatewayKind(...sources) {
  for (const gateway of sources.map(normalize).filter(Boolean)) {
    if (/^(phone|phone_number|mobile|sms)$/.test(gateway) || /(^|_)(phone|mobile|sms)(_|$)/.test(gateway)) return 'phone';
    if (/^(scan|scanner|barcode|qrscanner|qr_scanner)$/.test(gateway) || /(^|_)(scanner|barcode)(_|$)/.test(gateway)) return 'scanner';
    if (/^(p68|payterp68|payter_p68|stripe|apo|apollo)$/.test(gateway) || /(^|_)(p68|stripe|apollo|card|reader|m2|wisepad|s700|bbpos)(_|$)/.test(gateway)) return 'card';
  }
  return 'rent';
}

export function checkoutGatewayStep(checkout = {}) {
  const presentation=checkout.checkoutPresentation;
  const gateway=presentation?.gateway || checkout.gateway || checkout.offer?.gateway || checkout.offer?.hardware?.gateway;
  const scannerOnly=presentation?presentation.scannerOnly===true:checkout.scannerOnly===true || checkout.offer?.scannerOnly===true || checkout.offer?.hardware?.scannerOnly===true;
  if(scannerOnly && /^(apo|apollo)$/.test(normalize(gateway)))return 'scanner';
  return checkoutGatewayKind(
    presentation?.gateway,
    checkout.gateway,
    checkout.offer?.gateway,
    checkout.offer?.hardware?.gateway,
    checkout.offer?.paymentGateway,
    checkout.offer?.reader?.gateway,
    checkout.offer?.reader?.type,
  );
}
