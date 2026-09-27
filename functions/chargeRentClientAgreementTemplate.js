/* eslint-env node */

const {PDFDocument, StandardFonts, rgb} = require("pdf-lib");

const TEMPLATE_ID = "chargerent-revenue-share";
const TEMPLATE_VERSION = "V.11.01.2024";
const STANDARD_PRICING = {
  currency: "USD",
  hourlyRate: 3,
  nonReturnFee: 35,
  returnDeadlineHours: 72,
};

const RECITALS = [
  "This agreement is entered into by and between the company stated above " +
    "(hereinafter referred to as 'Proprietor') and Ocharge LLC (hereinafter " +
    "referred to as 'Operator').",
  "Operator is a company with principal place of business at 17711 W Magnolia " +
    "Blvd, Encino CA 91316. Operator is engaged in the business of installing " +
    "and operating automatic vending machines for renting portable chargers " +
    "(hereinafter referred to as 'Powerbanks') to the public through such " +
    "machines. Proprietor is the operator of the location(s) stated on page one " +
    "of this agreement. Operator desires to install automatic vending machines " +
    "on the premises of Proprietor for the rental of Powerbanks, and Proprietor " +
    "desires to grant Operator a license limited to such purposes on the terms " +
    "and conditions contained in this agreement. Therefore, in consideration " +
    "of the mutual covenants and promises contained herein, it is hereby agreed " +
    "as follows:",
];

const ARTICLES = [
  {
    title: "ARTICLE 1 - INSTALLATION OF MACHINES",
    paragraphs: [
      "Operator shall install the vending machines to rent Powerbanks on the " +
        "premises of the Proprietor at such locations as are mutually agreed " +
        "upon by the parties.",
    ],
  },
  {
    title: "ARTICLE 2 - REMOVAL AND REPLACEMENT OF MACHINES",
    paragraphs: [
      "Operator shall have the right, with 24 hour courtesy notice to " +
        "Proprietor, to remove any of the machines installed on the premises " +
        "of the Proprietor under this Agreement and to replace any such " +
        "machine with a vending machine of similar type, quality, and appearance.",
    ],
  },
  {
    title: "ARTICLE 3 - COMPENSATION",
    paragraphs: [
      "Proprietor shall authorize Operator to operate the equipment stated on " +
        "page 1 to provide Powerbanks for the rental period and fees stated on " +
        "page 1.",
      "Proprietor shall receive the profit share percentage stated on page 1 " +
        "of all Gross Revenues (after all transaction costs associated with " +
        "credit card processing are deducted) from the vending machine(s) at " +
        "the Proprietor's location. Gross Revenues include all daily rental " +
        "fees and all additional overages collected from late returns and no " +
        "returns.",
    ],
  },
  {
    title: "ARTICLE 4 - TERM",
    paragraphs: [
      "This Agreement shall commence on start date stated on page 1.",
    ],
  },
  {
    title: "ARTICLE 5 - OWNERSHIP OF MACHINES",
    paragraphs: [
      "It is understood and agreed by and between the parties that the vending " +
        "machines installed on the premises of Proprietor by Operator are and " +
        "shall remain the property of Operator. Upon termination of this " +
        "Agreement by any means, Operator shall have the right without further " +
        "notice to Proprietor to remove any and all vending machines belonging " +
        "to Operator which have been installed on the premises of Proprietor.",
    ],
  },
  {
    title: "ARTICLE 6 - SELECTION AND PRICING",
    paragraphs: [
      "Operator shall keep the machines stocked at all times with sufficient " +
        "Powerbanks to insure continuous service to patrons of Proprietor. " +
        "Operator shall have sole control over the selection of Powerbanks to " +
        "be offered through the vending machines. Pricing shall be as stated " +
        "on page one.",
      "PATRON PAYMENT METHOD",
      "Operator will provide vending machines that accept major debit and " +
        "credit cards. Cash will not be accepted as a form of payment. " +
        "Operator my enable to patrons the use of other cashless payments methods.",
    ],
  },
  {
    title: "ARTICLE 7 - RISK OF DAMAGE TO MACHINES",
    paragraphs: [
      "Except as may be attributable to Proprietor by reason of the negligence " +
        "of its officers, agents, or employees, Operator assumes full risk and " +
        "responsibility for any loss, theft, destruction, or damage occurring " +
        "to the vending machines or Powerbanks. Operator reserves the right of " +
        "compensation from Proprietor from losses incurred as the result of " +
        "damage to machines by those employed by Proprietor.",
    ],
  },
  {
    title: "ARTICLE 8 - INDEMNIFICATION",
    paragraphs: [
      "Operator agrees to indemnify and hold Proprietor and its officers, " +
        "directors, agents and employees harmless from against and all " +
        "liabilities, losses, claims, damages, costs and expenses incurred by " +
        "Operator because of negligence or other misconduct by Operator, its " +
        "employees, contract personnel, or agents relating to the performance " +
        "of the services herein.",
    ],
  },
  {
    title: "ARTICLE 9 - INSURANCE REQUIREMENTS",
    paragraphs: [
      "At all times during the term of this Agreement and any extension, " +
        "Operator agrees to carry liability insurance. The limits of insurance " +
        "policies of Operator shall not limit its liability nor relieve it of " +
        "any obligations under this Agreement. Operator agrees to provide a " +
        "certificate(s) of all insurance required by this Agreement to " +
        "Proprietor prior to the start of any work or installation. The " +
        "certificate(s) to include the policy number, policy periods, limits, " +
        "name of the carriers, phone numbers and addresses. The Certificate(s) " +
        "shall evidence the obligation of the insurance carrier not to cancel " +
        "or materially amend such policies without thirty (30) days prior " +
        "written notice to Proprietor. These certificates shall be incorporated " +
        "and made part of this Agreement.",
    ],
  },
  {
    title: "ARTICLE 10 - MAINTENANCE AND SERVICE",
    paragraphs: [
      "Operator shall regularly inspect, service, clean, and maintain the " +
        "described vending machines and shall keep them operating and in good " +
        "working order, at all times promptly maintaining them in a clean and " +
        "sanitary condition in accordance with all applicable federal, state " +
        "and local laws.",
    ],
  },
  {
    title: "ARTICLE 11 - NOTIFICATION OF MACHINE FAILURE",
    paragraphs: [
      "Proprietor agrees to notify Operator promptly of any failure of the " +
        "vending machines to function properly and further agrees to permit " +
        "only authorized agents of Operator to remove, open, or in any way " +
        "tamper with the machines.",
    ],
  },
  {
    title: "ARTICLE 12 - UTILITIES",
    paragraphs: [
      "Proprietor shall furnish and bear the cost of all utilities necessary " +
        "for the operation of the vending machines installed under this " +
        "Agreement and shall furnish suitable utility outlets for use by such " +
        "machines. Proprietor shall provide continuous service to the machines " +
        "and machine areas and shall not cause or permit the interruption of " +
        "such service except in the event of an emergency. Operator shall " +
        "coordinate with Proprietor for all Operator's power requirements.",
    ],
  },
  {
    title: "ARTICLE 13 - FEES AND TAXES",
    paragraphs: [
      "Operator, if applicable, shall be responsible for and shall pay all " +
        "state, county, and city license fees and sales or other merchandising " +
        "taxes that may be imposed on the sales of merchandise through its " +
        "vending machines.",
    ],
  },
  {
    title: "ARTICLE 14 - INDEPENDENT CONTRACTOR STATUS",
    paragraphs: [
      "Neither Operator nor Operator's employees or contract personnel, if " +
        "any, are Proprietor's employees. In its capacity as an independent " +
        "contractor, Operator agrees and represents, and Proprietor agrees " +
        "that (a) Operator has the right to perform services for others during " +
        "the term of this Agreement; (b) Operator has the right to control and " +
        "direct the means, manner, and method by which the services required by " +
        "this Agreement will be performed; (c) Operator shall not be required " +
        "to wear any uniforms provided by Proprietor; (d) the services required " +
        "by this Agreement shall be performed by Operator and Proprietor shall " +
        "not hire, supervise, or pay any assistants or personnel to help " +
        "Operator; (e) Operator shall not receive any training from Proprietor " +
        "in the professional skills necessary to perform the services required " +
        "by this Agreement; and (f) Operator shall not be required by " +
        "Proprietor to devote full time to the performance of the services " +
        "required by this Agreement.",
    ],
  },
  {
    title: "ARTICLE 15 - GOVERNING LAW",
    paragraphs: [
      "This Agreement will be governed by California law, without giving " +
        "effect to conflict of laws principles.",
    ],
  },
  {
    title: "ARTICLE 16 - TERMINATION OF AGREEMENT",
    paragraphs: [
      "This Agreement may be terminated by either party if the other party " +
        "defaults in the performance of an obligation or materially breaches " +
        "any of the terms or conditions of this Agreement and fails to cure " +
        "such default or breach within 30 days after service of written notice " +
        "upon him of such default or breach. Notwithstanding the above, either " +
        "party may immediately terminate this Agreement at any time by giving " +
        "five (5) business days' written notice to the other party of the " +
        "intent to terminate. In the event of termination, payment is due only " +
        "for services performed and invoiced up through the effective date of " +
        "termination.",
    ],
  },
  {
    title: "ARTICLE 17 - ASSIGNMENT",
    paragraphs: [
      "This Agreement shall not be assignable by either party without the " +
        "prior written consent of the other party. Subject to the forgoing " +
        "limitation, this Agreement shall endure to the benefit of and be " +
        "binding upon the successors and assigns of the respective parties.",
    ],
  },
  {
    title: "ARTICLE 18 - ENTIRE AGREEMENT",
    paragraphs: [
      "This Agreement constitutes the entire Agreement of the parties with " +
        "respect to the subject matter hereof and supersedes any and all " +
        "agreements, understandings, statements, or representations either " +
        "oral or in writing. This Agreement is executed on the day and year " +
        "indicated beneath the signature of each party.",
    ],
  },
];

function clean(value, maxLength = 500) {
  return String(value || "").trim().slice(0, maxLength);
}

function splitLines(font, value, size, maxWidth) {
  const words = clean(value, 20000).split(/\s+/).filter(Boolean);
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
  return lines.length ? lines : [""];
}

function createPageRenderer(pdf, regular, bold) {
  const dark = rgb(0.06, 0.09, 0.16);
  const gray = rgb(0.38, 0.43, 0.5);
  const indigo = rgb(0.25, 0.29, 0.82);
  let page;
  let y;
  let pageNumber = 0;

  function addPage() {
    page = pdf.addPage([612, 792]);
    pageNumber += 1;
    y = 728;
    page.drawText("Ocharge LLC", {x: 44, y, size: 15, font: bold, color: dark});
    const headerTitle = "CHARGERENT REVENUE SHARE AGREEMENT";
    page.drawText(headerTitle, {
      x: 568 - bold.widthOfTextAtSize(headerTitle, 8),
      y,
      size: 8,
      font: bold,
      color: indigo,
      maxWidth: 260,
    });
    page.drawLine({
      start: {x: 44, y: 712},
      end: {x: 568, y: 712},
      thickness: 0.8,
      color: rgb(0.78, 0.81, 0.86),
    });
    page.drawText(`Page ${pageNumber}`, {
      x: 44,
      y: 28,
      size: 8,
      font: regular,
      color: gray,
    });
    y = 686;
  }

  function ensureSpace(height) {
    if (!page || y - height < 54) addPage();
  }

  function heading(value, size = 11) {
    ensureSpace(size + 22);
    page.drawText(clean(value, 500), {x: 44, y, size, font: bold, color: dark});
    y -= size + 10;
  }

  function paragraph(value, options = {}) {
    const size = options.size || 9.2;
    const font = options.bold ? bold : regular;
    const lines = splitLines(font, value, size, 524);
    ensureSpace((lines.length * (size + 3)) + 12);
    lines.forEach((line) => {
      page.drawText(line, {x: 44, y, size, font, color: dark});
      y -= size + 3;
    });
    y -= options.gap ?? 9;
  }

  function detail(label, value) {
    const size = 9.5;
    const lines = splitLines(regular, value || "Not provided", size, 360);
    ensureSpace(Math.max(25, (lines.length * 13) + 8));
    page.drawText(label, {x: 54, y, size: 9, font: bold, color: gray});
    lines.forEach((line, index) => {
      page.drawText(line, {
        x: 200,
        y: y - (index * 13),
        size,
        font: regular,
        color: dark,
      });
    });
    y -= Math.max(25, (lines.length * 13) + 8);
  }

  function divider() {
    ensureSpace(16);
    page.drawLine({
      start: {x: 44, y},
      end: {x: 568, y},
      thickness: 0.6,
      color: rgb(0.84, 0.86, 0.9),
    });
    y -= 16;
  }

  return {
    addPage,
    detail,
    divider,
    ensureSpace,
    getPage: () => page,
    getY: () => y,
    heading,
    paragraph,
    setY: (value) => { y = value; },
  };
}

function validateAgreementInput(input) {
  const normalized = {
    legalBusinessName: clean(input?.legalBusinessName, 180),
    venueName: clean(input?.venueName, 180),
    address: clean(input?.address, 300),
    contactName: clean(input?.contactName, 160),
    contactEmail: clean(input?.contactEmail, 254),
    contactPhone: clean(input?.contactPhone, 80),
    effectiveDate: clean(input?.effectiveDate, 40),
    assetsDeployed: clean(input?.assetsDeployed, 500),
    revenueShare: Number(input?.revenueShare),
    paymentSchedule: clean(input?.paymentSchedule, 80),
  };
  if (!normalized.legalBusinessName || !normalized.venueName ||
      !normalized.address || !normalized.effectiveDate ||
      !normalized.assetsDeployed || !normalized.contactEmail) {
    throw new Error("The agreement is missing required client or deployment details.");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized.effectiveDate)) {
    throw new Error("The agreement start date must use YYYY-MM-DD format.");
  }
  if (!Number.isFinite(normalized.revenueShare) ||
      normalized.revenueShare < 0 || normalized.revenueShare > 100) {
    throw new Error("The agreement revenue share must be between 0 and 100.");
  }
  return normalized;
}

async function generateChargeRentClientAgreement(input) {
  const details = validateAgreementInput(input);
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const renderer = createPageRenderer(pdf, regular, bold);
  renderer.addPage();

  renderer.heading("REVENUE SHARE AGREEMENT", 20);
  renderer.paragraph(TEMPLATE_VERSION, {size: 9, bold: true, gap: 18});
  renderer.heading("PROPRIETOR INFORMATION");
  renderer.detail("Legal business name", details.legalBusinessName);
  renderer.detail("Contact", details.contactName);
  renderer.detail("Email", details.contactEmail);
  renderer.detail("Telephone", details.contactPhone || "Not provided");
  renderer.divider();

  renderer.heading("LOCATION DETAILS");
  renderer.detail("Location name", details.venueName);
  renderer.detail("Installation address", details.address);
  renderer.detail("Agreement/start date", details.effectiveDate);
  renderer.detail("Assets deployed", details.assetsDeployed);
  renderer.divider();

  renderer.heading("CHARGER RENTAL DETAILS");
  renderer.detail(
      "Rental price",
      `$${STANDARD_PRICING.hourlyRate.toFixed(2)} per hour`,
  );
  renderer.detail(
      "Non-return fee",
      `$${STANDARD_PRICING.nonReturnFee.toFixed(2)} after ` +
        `${STANDARD_PRICING.returnDeadlineHours} hours`,
  );
  renderer.divider();

  renderer.heading("REVENUE SHARE TERMS");
  renderer.detail("Proprietor percentage", `${details.revenueShare}%`);
  renderer.detail("Payment schedule", details.paymentSchedule || "Monthly");
  renderer.paragraph(
      "The legal terms on the following pages form part of this agreement.",
      {size: 8.5, gap: 0},
  );

  renderer.addPage();
  renderer.heading("RECITALS");
  RECITALS.forEach((paragraph) => renderer.paragraph(paragraph));
  ARTICLES.forEach((article) => {
    const firstParagraphLines = splitLines(
        regular,
        article.paragraphs[0] || "",
        9.2,
        524,
    );
    renderer.ensureSpace(43 + (firstParagraphLines.length * 12.2));
    renderer.heading(article.title);
    article.paragraphs.forEach((paragraph) => {
      renderer.paragraph(paragraph, {
        bold: paragraph === "PATRON PAYMENT METHOD",
      });
    });
  });

  renderer.ensureSpace(150);
  const page = renderer.getPage();
  let y = renderer.getY() - 18;
  page.drawText(`Proprietor: ${details.legalBusinessName}`, {
    x: 44, y, size: 10, font: bold, color: rgb(0.06, 0.09, 0.16),
  });
  page.drawText("Operator: Ocharge LLC", {
    x: 330, y, size: 10, font: bold, color: rgb(0.06, 0.09, 0.16),
  });
  y -= 46;
  page.drawLine({start: {x: 44, y}, end: {x: 260, y}, thickness: 0.7});
  page.drawLine({start: {x: 330, y}, end: {x: 546, y}, thickness: 0.7});
  page.drawText("Electronic signature appended upon signing", {
    x: 44, y: y - 14, size: 7.5, font: regular,
  });
  page.drawText("Authorized signature", {
    x: 330, y: y - 14, size: 7.5, font: regular,
  });

  return {
    buffer: Buffer.from(await pdf.save({useObjectStreams: false})),
    templateId: TEMPLATE_ID,
    version: TEMPLATE_VERSION,
    pricing: {...STANDARD_PRICING},
    details,
  };
}

module.exports = {
  ARTICLES,
  STANDARD_PRICING,
  TEMPLATE_ID,
  TEMPLATE_VERSION,
  generateChargeRentClientAgreement,
};
