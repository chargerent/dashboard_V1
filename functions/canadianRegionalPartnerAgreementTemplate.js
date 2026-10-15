/* eslint-env node */

const {PDFDocument, StandardFonts, rgb} = require("pdf-lib");

const TEMPLATE_ID = "chargerent-canada-regional-partner";
const TEMPLATE_VERSION = "CA-EN-2026-10-06";
const COMPANY = "Chargerent Inc";
const COMPANY_ADDRESS =
  "1270 Central Parkway West, Mississauga, ON L5C 4P4, Canada";
const COMPANY_PHONE = "+1 647-556-5323";
const COMPANY_EMAIL = "info@charge.rent";

const ARTICLES = [
  {
    title: "ARTICLE 1 - DEFINITIONS",
    paragraphs: [
      "1. Products means the Company's portable-charger rental kiosks, charging stations, chargers, related software, and approved media placements. 2. Territory means the Canadian province(s), territory or named accounts entered in the Agreement Details. 3. Venue Partner means a business or organization that enters into a written placement, lease, sponsorship, or revenue-share contract with the Company. 4. End User means a person who rents or receives a charger. 5. Contract means an executed written agreement between the Company and a Venue Partner. 6. Qualifying Rental Revenue means rental charges actually received by the Company from completed End User rentals, before payment-processing fees, but excluding GST/HST/QST, deposits, refunds, reversals, chargebacks, and non-rental charges.",
    ],
  },
  {
    title: "ARTICLE 2 - APPOINTMENT",
    paragraphs: [
      "The Company appoints the Regional Representative as a non-exclusive independent contractor to introduce and support approved opportunities within the Territory. The appointment is specific to the Regional Representative named in this Agreement and may not be assigned or delegated without the Company's prior written consent. The Company retains final approval of every Product, price, proposal, Venue Partner, Contract, installation, and support plan.",
    ],
  },
  {
    title: "ARTICLE 3 - RESPONSIBILITIES",
    paragraphs: [
      "1. Regional Representative. The Regional Representative will make lawful introductions, provide accurate venue context, coordinate communications, avoid unauthorized promises, and promptly share material information with the Company. 2. Company. The Company will confirm product suitability, pricing, commercial terms, agreements, deployment, platform access, and technical support. 3. No Maintenance Duty. The Regional Representative is not responsible for stocking, recharging, repairing, servicing, or maintaining Products unless the parties sign a separate written operating addendum.",
    ],
  },
  {
    title: "ARTICLE 4 - COMMISSIONS AND TAXES",
    paragraphs: [
      "1. New Contracts. For each new Contract introduced by the Regional Representative and approved in writing by the Company, the Regional Representative will receive a revenue-share pool equal to 40% of Qualifying Rental Revenue during the Contract term while this Agreement remains in effect. 2. Existing Contracts. The same 40% pool applies only to existing Contracts specifically assigned to the Regional Representative in writing by the Company. 3. Venue Allocation. The Regional Representative may allocate from zero to forty percentage points of the 40% pool to the Venue Partner. If the Venue Partner receives no share, the Regional Representative retains the full 40%. Total combined payouts may not exceed 40% unless the parties agree otherwise in writing. 4. Payment. Statements and commissions are issued in CAD by the 10th day of each calendar month for the prior calendar month's Qualifying Rental Revenue. 5. Taxes. Commissions exclude applicable GST/HST/QST. The Regional Representative is responsible for registrations, invoices, remittances, income taxes, and providing valid tax numbers when required. The Company may make deductions required by law.",
    ],
  },
  {
    title: "ARTICLE 5 - PORTAL ACCESS AND RECORDS",
    paragraphs: [
      "The Company may provide account-scoped portal access showing assigned locations, kiosks, rental activity, and commission information. The Regional Representative will protect all credentials, permit access only to authorized personnel, and notify the Company promptly of suspected misuse. Portal displays are operational information; the Company's finalized monthly statement controls commission payment.",
    ],
  },
  {
    title: "ARTICLE 6 - CONFIDENTIALITY AND PRIVACY",
    paragraphs: [
      "The Regional Representative will use the Company's non-public business, customer, pricing, technical, and portal information only to perform this Agreement and will not disclose it except to authorized personnel who are bound by comparable obligations. These duties continue for three years after termination; trade secrets remain protected while legally qualifying as trade secrets. Each party will handle personal information in accordance with applicable Canadian federal and provincial privacy laws and will report suspected unauthorized access without undue delay.",
    ],
  },
  {
    title: "ARTICLE 7 - CONFLICTS AND AUTHORITY",
    paragraphs: [
      "During the term, the Regional Representative will disclose existing directly competitive portable-charger rental representations and will not promote a directly competing program within the Territory without the Company's written consent. The Regional Representative cannot bind the Company, sign for the Company, change prices or terms, collect customer funds, or make warranties not approved in writing by the Company. This Article does not create a post-termination non-compete.",
    ],
  },
  {
    title: "ARTICLE 8 - EQUIPMENT AND PROTECTED VENUES",
    paragraphs: [
      "1. Ownership and Control. All Products, chargers, software, credentials, signage, media, and related equipment supplied by or for the Company remain the exclusive property of the Company or its designated owner. The Regional Representative acquires no ownership, lien, security interest, or right of disposal. Without the Company's prior written consent, the Regional Representative will not move, remove, decommission, open, alter, rebrand, disable, sell, pledge, transfer, substitute, or permit unauthorized access to any Product.",
      "2. Protected Venue. Protected Venue means a Venue Partner under Contract with the Company and any venue or opportunity introduced, assigned, documented, or materially pursued through the program where the Regional Representative had material contact or received Company Confidential Information. 3. Non-Circumvention. During the term and for twelve (12) months after termination, the Regional Representative will not directly or indirectly solicit, encourage, assist, or arrange for a Protected Venue handled by it during the preceding twelve (12) months to terminate or reduce its Company relationship, replace Company Products, transfer or sell the opportunity to another operator, or enter a competing portable-charger program. General advertising not targeted at a Protected Venue is not prohibited.",
      "4. Competitive Equipment. During the term, the Regional Representative will not market, install, facilitate, finance, or support competing portable-charger equipment or services at a Protected Venue without the Company's prior written consent. 5. Notice and Cooperation. The Regional Representative will notify the Company in writing within two (2) business days after learning of a competitor approach, proposed Product move or removal, venue ownership change, or request to terminate or replace Company Products. 6. Remedies and Survival. A violation of this Article is a material breach. Subject to applicable law, the Company may suspend portal access and new opportunity assignments, terminate this Agreement immediately, recover its Products and reasonable direct recovery or redeployment costs, and seek damages and equitable relief. Accrued undisputed commissions remain payable, but no future unearned commissions accrue after termination.",
    ],
  },
  {
    title: "ARTICLE 9 - INDEPENDENT CONTRACTOR",
    paragraphs: [
      "The parties are independent contractors. Nothing creates a partnership, joint venture, franchise, agency, fiduciary, employment, or exclusivity relationship. The Regional Representative controls its own lawful methods and is responsible for its personnel, expenses, insurance, permits, taxes, withholdings, and statutory obligations.",
    ],
  },
  {
    title: "ARTICLE 10 - TERM AND TERMINATION",
    paragraphs: [
      "This Agreement begins on the Effective Date, continues for one year, and then renews month-to-month unless the Agreement Details state otherwise. Either party may terminate on 30 days' written notice. A party may terminate immediately for material breach not cured within 10 days after written notice, fraud, unlawful conduct, misuse of confidential information or portal access, insolvency, or material reputational harm. Termination does not affect commissions accrued through the effective termination date or provisions intended to survive.",
    ],
  },
  {
    title: "ARTICLE 11 - MUTUAL INDEMNIFICATION",
    paragraphs: [
      "Each party will indemnify and hold the other harmless from third-party claims, losses, damages, and reasonable costs to the extent caused by its breach of this Agreement, negligence, wilful misconduct, or violation of law. The indemnified party must give prompt notice and reasonable cooperation, and the indemnifying party may control the defence subject to the indemnified party's right to participate with its own counsel.",
    ],
  },
  {
    title: "ARTICLE 12 - NOTICES",
    paragraphs: [
      `Notices must be in writing and delivered by recognized courier or email. Company notices are sent to ${COMPANY}, ${COMPANY_ADDRESS}, ${COMPANY_EMAIL}. Regional Representative notices are sent to the address and email in the Regional Representative Information section. Email notice is effective on the next business day if the sender receives no delivery-failure notice; courier notice is effective on documented delivery.`,
    ],
  },
  {
    title: "ARTICLE 13 - GOVERNING LAW",
    paragraphs: [
      "This Agreement is governed by the laws of the Province of Ontario and the federal laws of Canada applicable therein, without regard to conflict-of-law rules. The parties attorn to the exclusive jurisdiction of the courts located in Toronto, Ontario. Before using this English-language template in Quebec, the Company must provide an approved French version and obtain Quebec-specific legal review.",
    ],
  },
  {
    title: "ARTICLE 14 - GENERAL",
    paragraphs: [
      "This Agreement, its completed cover information, and any written schedules form the entire agreement on its subject and replace prior discussions. Amendments and waivers must be written and signed by authorized representatives. If any provision is unenforceable, it will be modified only as necessary and the remainder continues. Headings are for convenience. Counterparts and electronic signatures are effective. Neither party is liable for delay caused by events beyond its reasonable control, except payment obligations already due.",
    ],
  },
];

function clean(value, maxLength = 500) {
  return String(value || "").trim().slice(0, maxLength);
}

function splitLines(font, value, size, maxWidth) {
  const words = clean(value, 10000).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      line = candidate;
    } else {
      if (line) lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function groupedHash(value) {
  return String(value || "").match(/.{1,32}/g)?.join(" ") || "";
}

function validate(input) {
  const partnerType = clean(input?.partnerType || "company", 20).toLowerCase();
  if (!["company", "individual"].includes(partnerType)) {
    throw new Error("The Canadian partner agreement has an invalid partner type.");
  }
  const details = {
    partnerType,
    legalName: clean(input?.legalName, 180),
    businessAddress: clean(input?.businessAddress, 300),
    telephone: clean(input?.telephone, 80),
    email: clean(input?.email, 254).toLowerCase(),
    taxNumber: clean(input?.taxNumber, 80),
    effectiveDate: clean(input?.effectiveDate, 40),
    territory: clean(input?.territory, 240),
  };
  if (!details.legalName || !details.businessAddress || !details.email ||
      !details.effectiveDate || !details.territory) {
    throw new Error("The Canadian partner agreement is missing required details.");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(details.effectiveDate)) {
    throw new Error("The agreement effective date must use YYYY-MM-DD format.");
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(details.email)) {
    throw new Error("The agreement email address is invalid.");
  }
  return details;
}

function createRenderer(pdf, regular, bold) {
  const navy = rgb(0.055, 0.114, 0.204);
  const slate = rgb(0.322, 0.38, 0.478);
  const purple = rgb(0.631, 0.435, 0.69);
  let page;
  let y;
  let pageNumber = 0;

  function addPage() {
    page = pdf.addPage([612, 792]);
    pageNumber += 1;
    page.drawText(COMPANY, {x: 48, y: 752, size: 12, font: bold, color: navy});
    page.drawText("CANADIAN REGIONAL REPRESENTATIVE AGREEMENT", {
      x: 262, y: 752, size: 8, font: regular, color: slate,
    });
    page.drawLine({start: {x: 48, y: 740}, end: {x: 564, y: 740}, thickness: 1, color: purple});
    page.drawText(`Page ${pageNumber}`, {x: 48, y: 28, size: 8, font: regular, color: slate});
    page.drawText("CANADA - ENGLISH", {
      x: 481, y: 28, size: 7.5, font: bold, color: slate,
    });
    y = 716;
  }

  function ensure(height) {
    if (!page || y - height < 54) addPage();
  }

  function heading(value, size = 11) {
    ensure(size + 20);
    page.drawText(clean(value), {x: 48, y, size, font: bold, color: navy});
    y -= size + 9;
  }

  function paragraph(value, options = {}) {
    const size = options.size || 9;
    const font = options.bold ? bold : regular;
    const lines = splitLines(font, value, size, 516);
    ensure((lines.length * (size + 3)) + 12);
    for (const line of lines) {
      page.drawText(line, {x: 48, y, size, font, color: navy});
      y -= size + 3;
    }
    y -= options.gap ?? 8;
  }

  function detail(label, value) {
    const size = 9;
    const lines = splitLines(regular, value || "Not provided", size, 340);
    ensure(Math.max(24, lines.length * 12 + 8));
    page.drawText(label, {x: 56, y, size: 8.5, font: bold, color: slate});
    lines.forEach((line, index) => page.drawText(line, {
      x: 208, y: y - (index * 12), size, font: regular, color: navy,
    }));
    y -= Math.max(24, lines.length * 12 + 8);
  }

  return {addPage, detail, ensure, heading, paragraph, page: () => page, y: () => y, setY: (value) => { y = value; }};
}

async function generateCanadianRegionalPartnerAgreement(input) {
  const details = validate(input);
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${COMPANY} Canadian Regional Representative Agreement`);
  pdf.setAuthor(COMPANY);
  pdf.setSubject("Canadian regional representative agreement");
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const renderer = createRenderer(pdf, regular, bold);
  renderer.addPage();

  const isIndividual = details.partnerType === "individual";
  renderer.heading(
      isIndividual ?
        "INDIVIDUAL REGIONAL REPRESENTATIVE INFORMATION" :
        "COMPANY REGIONAL REPRESENTATIVE INFORMATION",
      15,
  );
  renderer.detail(isIndividual ? "Full legal name" : "Legal company name", details.legalName);
  renderer.detail(isIndividual ? "Mailing address" : "Business address", details.businessAddress);
  renderer.detail("Telephone", details.telephone || "Not provided");
  renderer.detail("Email", details.email);
  renderer.detail("GST/HST/QST number", details.taxNumber || "Not provided");
  renderer.heading("AGREEMENT DETAILS", 13);
  renderer.detail("Partner type", isIndividual ? "Individual" : "Company or organization");
  renderer.detail("Effective date", details.effectiveDate);
  renderer.detail("Canadian territory", details.territory);
  renderer.detail("Contracting entity", COMPANY);
  renderer.detail("Governing law", "Ontario and applicable federal laws of Canada");
  renderer.detail("Currency", "Canadian dollars (CAD)");
  renderer.heading("COMMISSION TERMS", 13);
  renderer.detail("New contracts", "40% partner-controlled revenue-share pool");
  renderer.detail("Approved existing contracts", "40% partner-controlled revenue-share pool");
  renderer.detail("Commission payment day", "10th day of each calendar month");
  renderer.detail("Sales taxes", "Excluded from commission calculations");
  renderer.addPage();
  renderer.heading("REGIONAL REPRESENTATIVE AGREEMENT", 16);
  const representativeDescription = isIndividual ?
    "an individual" :
    "a company or organization";
  renderer.paragraph(
      `THIS REGIONAL REPRESENTATIVE AGREEMENT is effective as of ${details.effectiveDate} between ${COMPANY}, with an address at ${COMPANY_ADDRESS} (the Company), and ${details.legalName}, ${representativeDescription}, with an address at ${details.businessAddress} (the Regional Representative).`,
  );
  renderer.paragraph(
      "WHEREAS, the Company supplies and operates automated kiosks and charging stations that rent or provide portable chargers to members of the public; and WHEREAS, the Regional Representative wishes to introduce and support approved venue opportunities within the Territory; NOW, THEREFORE, the parties agree as follows:",
  );
  for (const article of ARTICLES) {
    const firstParagraphLines = splitLines(
        regular,
        article.paragraphs[0] || "",
        9,
        516,
    );
    renderer.ensure(34 + (firstParagraphLines.length * 12));
    renderer.heading(article.title);
    for (const paragraph of article.paragraphs) renderer.paragraph(paragraph);
  }

  renderer.ensure(176);
  renderer.heading("SIGNATURES", 13);
  const page = renderer.page();
  let y = renderer.y() - 12;
  page.drawText(`COMPANY: ${COMPANY}`, {x: 48, y, size: 9, font: bold});
  page.drawText(
      isIndividual ? "REGIONAL REPRESENTATIVE (INDIVIDUAL)" : "REGIONAL REPRESENTATIVE (COMPANY)",
      {x: 316, y, size: 9, font: bold},
  );
  y -= 42;
  for (const label of ["Signature", "Printed name", "Title", "Date"]) {
    page.drawText(`${label}: __________________________`, {x: 48, y, size: 8.5, font: regular});
    page.drawText(`${label}: __________________________`, {x: 316, y, size: 8.5, font: regular});
    y -= 24;
  }

  return {
    buffer: Buffer.from(await pdf.save({useObjectStreams: false})),
    templateId: TEMPLATE_ID,
    version: TEMPLATE_VERSION,
    details,
    company: {
      name: COMPANY,
      address: COMPANY_ADDRESS,
      phone: COMPANY_PHONE,
      email: COMPANY_EMAIL,
    },
  };
}

async function appendCanadianPartnerSignatureCertificate(sourcePdf, certificate = {}) {
  const pdf = await PDFDocument.load(sourcePdf, {ignoreEncryption: false});
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const navy = rgb(0.055, 0.114, 0.204);
  const slate = rgb(0.322, 0.38, 0.478);
  const purple = rgb(0.631, 0.435, 0.69);
  const page = pdf.addPage([612, 792]);
  let y = 742;

  page.drawText(COMPANY, {x: 48, y, size: 15, font: bold, color: navy});
  page.drawText("CANADIAN REGIONAL REPRESENTATIVE AGREEMENT", {
    x: 278, y: y + 2, size: 8, font: regular, color: slate,
  });
  y -= 17;
  page.drawLine({
    start: {x: 48, y}, end: {x: 564, y}, thickness: 1, color: purple,
  });
  y -= 42;
  page.drawText("Certificate of Electronic Signature", {
    x: 48, y, size: 18, font: bold, color: navy,
  });
  y -= 24;
  page.drawText(
      "This certificate is attached to and forms part of the agreement identified below.",
      {x: 48, y, size: 10, font: regular, color: slate},
  );
  y -= 36;

  const rows = [
    ["Agreement", certificate.title],
    ["Version", certificate.version],
    ["Agreement ID", certificate.agreementId],
    ["Partner ID", certificate.clientId],
    ["Canadian territory", certificate.venueName],
    ["Partner type", certificate.partnerType === "individual" ?
      "Individual" : "Company or organization"],
    ["Signer", certificate.signerName],
    ["Signer title", certificate.signerTitle],
    ["Signer email", certificate.signerEmail],
    ["Signed at", certificate.signedAt],
    ["Authentication", "Secure invitation link plus emailed one-time code"],
    ["Source document SHA-256", groupedHash(certificate.sourceHash)],
  ];

  for (const [label, value] of rows) {
    page.drawText(label, {x: 48, y, size: 9, font: bold, color: slate});
    const lines = splitLines(regular, value || "Not provided", 10, 330);
    lines.forEach((line, index) => page.drawText(line, {
      x: 208,
      y: y - (index * 13),
      size: 10,
      font: regular,
      color: navy,
    }));
    y -= Math.max(27, (lines.length * 13) + 8);
  }

  y -= 4;
  page.drawLine({
    start: {x: 48, y}, end: {x: 420, y}, thickness: 1, color: navy,
  });
  y -= 24;
  page.drawText(clean(certificate.signerName || "Electronic signer", 160), {
    x: 48, y, size: 18, font: bold, color: navy,
  });
  y -= 18;
  page.drawText("Electronic signature", {
    x: 48, y, size: 9, font: regular, color: slate,
  });
  y -= 32;

  const statement =
    "The signer consented to receive and sign this agreement electronically, " +
    "confirmed review of the complete agreement, and adopted the electronic " +
    "signature above with the intent to be legally bound.";
  splitLines(regular, statement, 10, 510).forEach((line, index) => {
    page.drawText(line, {
      x: 48,
      y: y - (index * 14),
      size: 10,
      font: regular,
      color: navy,
    });
  });

  page.drawText("CANADA - ENGLISH", {
    x: 481, y: 28, size: 7.5, font: bold, color: slate,
  });

  return Buffer.from(await pdf.save({useObjectStreams: false}));
}

module.exports = {
  COMPANY,
  COMPANY_ADDRESS,
  COMPANY_EMAIL,
  COMPANY_PHONE,
  TEMPLATE_ID,
  TEMPLATE_VERSION,
  appendCanadianPartnerSignatureCertificate,
  generateCanadianRegionalPartnerAgreement,
  validateCanadianPartnerAgreementInput: validate,
};
