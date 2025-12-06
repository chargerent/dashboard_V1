import React, { useState, useEffect, useMemo } from "react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { FormMultiSwitch } from "../components/forms/FormFields.jsx";

const EventLegalText = ({ t }) => (
  <>
    <p>
      This agreement is entered into by and between the company stated above
      (hereinafter referred to as ‘Proprietor’) and OCHARGE LLC (hereinafter
      referred to as 'Operator’).
    </p>
    <h3 className="font-bold text-sm">RECITALS</h3>
    <p>
      Operator is a Limited Liability Corporation with principal place of
      business at 17711 Magnolia Blvd, Encino, CA 91316, USA. Operator is
      engaged in the business of installing and operating automatic vending
      machines for renting portable chargers (hereinafter referred to as
      ‘Powerbanks’) to the public through such machines. Proprietor is a US
      Legal Entity with principal place of business stated above. Proprietor is
      the organizer and operator of the following event stated above.Operator
      desires to install automatic vending machines on the premises of
      Proprietor for the rental of Powerbanks, and Proprietor desires to grant
      Operator a license for such purposes on the terms and conditions contained
      in this agreement. Therefore, in consideration of the mutual covenants and
      promises contained herein, it is hereby agreed as follows:
    </p>

    <h3 className="font-bold text-sm pt-2">ARTICLE 1 - INSTALLATION OF MACHINES</h3>
    <p>
      Operator shall install the vending machines to rent Powerbanks on the
      premises of the Event at such locations as are mutually agreed upon by the
      parties. Event locations must be adequately protected from wind and rain
      and must have continuous and adequate AC power supply. Operator may also
      require adequate WIFI availability at each of the locations where a unit
      will be placed.
    </p>

    <h3 className="font-bold text-sm pt-2">ARTICLE 2 - REMOVAL AND REPLACEMENT OF MACHINES</h3>
    <p>
      Operator shall have the right to remove any of the machines installed on
      the premises of the Event under this Agreement and to replace any such
      machine with a machine of similar type, quality, and appearance.
    </p>

    <h3 className="font-bold text-sm pt-2">ARTICLE 3 – COST OF SERVICE</h3>
    <p>
      Proprietor shall pay a total fee stated to Operator upon signing this
      Agreement for providing the services and equipment listed in the quote
      referenced on Page 1. Operator shall allow Proprietor’s patrons to borrow
      Powerbanks from all vending machine(s) as per the rental fees stated on
      Page 1. If a patron keeps a Powerbank past the end of the Event, the
      patron’s payment card will be charged a total fee as stated on Page 1.
      Proprietor will not be financially held liable for any non-returned
      Powerbanks.
    </p>

    <h3 className="font-bold text-sm pt-2">ARTICLE 4 - TERM</h3>
    <p>
      This Agreement shall commence on load-in date stated on Page 1 and end on
      the load-out date stated on Page 1. Event dates are as stated on Page 1.
    </p>

    <h3 className="font-bold text-sm pt-2">ARTICLE 5 - OWNERSHIP OF MACHINES</h3>
    <p>
      It is understood and agreed by and between the parties that the vending
      machines installed on the premises of Proprietor by Operator are and shall
      remain the property of Operator. Upon termination of this Agreement by any
      means, Operator shall have the right without further notice to Proprietor
      to remove any and all vending machines belonging to Operator which have
      been installed on the premises of Proprietor.
    </p>

    <h3 className="font-bold text-sm pt-2">ARTICLE 6 - PRODUCT SELECTION AND PRICING</h3>
    <p>
      Operator shall have the sole control over the selection of Powerbanks to
      be offered through the vending machines. Typically, a single type of
      Powerbank will be offered with built-in cables (micro-USB, USB C, and
      lightning). Operator shall keep the machines stocked at all times with
      sufficient Powerbanks to insure continuous service to patrons of
      Proprietor. Product pricing shall be per quote referenced on Page 1.
      Operator will provide vending machines that only accept major debit and
      credit cards. Cash will not be accepted as a form of payment.
    </p>

    <h3 className="font-bold text-sm pt-2">ARTICLE 7 - RISK OF DAMAGE TO MACHINES</h3>
    <p>
      Except as may be attributable to Proprietor by reason of the gross
      negligence or willful misconducts of its officers, agents, or employees,
      Operator assumes partial risk and responsibility for any loss,
      destruction, or damage occurring to the vending machines. Operator
      reserves the right of compensation from Proprietor from losses incurred as
      the result of damage to machines by those employed by Proprietor.
    </p>

    <h3 className="font-bold text-sm pt-2">ARTICLE 8 - MAINTENANCE AND SERVICE</h3>
    <p>
      Operator shall regularly inspect, service, clean, and maintain the
      described vending machines and shall keep them operating and in good
      working order, at all times promptly maintaining them in a clean and
      sanitary condition in accordance with all applicable federal, state and
      local laws. Operator shall be granted full access to all Event sites for
      up to 2 technicians at least 2 days prior to the commencement of the event
      and at least 2 days after the end of the event. Operator shall coordinate
      with Proprietor for delivery, installation, and removal of all machines to
      and from Event sites. Operator shall be granted all access passes from
      Proprietor for up to 2 technicians in order to have unrestricted and full
      access to all Event sites for the purpose of maintenance and servicing of
      the machines during the entire Event.
    </p>

    <h3 className="font-bold text-sm pt-2">ARTICLE 9 - NOTIFICATION OF MACHINE FAILURE</h3>
    <p>
      Proprietor agrees to notify Operator promptly of any failure of the
      vending machines to function properly and further agrees to permit only
      authorized agents of Operator to remove, open, or in any way tamper with
      the machines. Operator shall clearly post a contact phone number on each
      vending machine for patrons to use in the event of machine failure or
      malfunction during transactions or for customer service.
    </p>

    <h3 className="font-bold text-sm pt-2">ARTICLE 10 - UTILITIES</h3>
    <p>
      Proprietor shall furnish and bear the cost of all utilities necessary for
      the operation of the vending machines installed under this Agreement and
      shall furnish suitable utility outlets for use by such machines. Proprietor
      shall provide continuous service to the machines and machine areas and
      shall not cause or permit the interruption of such service except in the
      event of an emergency. Operator shall coordinate with Proprietor for all
      Operator’s power requirements at each Event site.
    </p>

    <h3 className="font-bold text-sm pt-2">ARTICLE 11 - FEES AND TAXES</h3>
    <p>
      Operator shall be responsible for and shall pay all state, county, and
      city license fees and sales or other merchandising taxes that may be
      imposed on the sales of merchandise through its vending machines.
    </p>

    <h3 className="font-bold text-sm pt-2">ARTICLE 12 – RELATIONS OF PARTIES</h3>
    <p>
      It is the intention of the parties that Operator be an independent
      contractor hereunder, and that no agency or employment relationship be
      created by this Agreement.
    </p>

    <h3 className="font-bold text-sm pt-2">ARTICLE 13 – INDEMNIFICATION</h3>
    <p>
      Operator shall defend, indemnify and hold harmless Proprietor from and
      against any and all actions, suits, proceedings, claims, demands, losses,
      costs and expenses, including legal costs and attorneys' fees, for injury
      to or death of person(s), for damage to property (including property of
      Proprietor) or the loss of use thereof, and for errors and omissions,
      negligence and willful misconduct caused by Operator, its officers,
      agents, permitted subcontractors and employees, anyone directly or
      indirectly employed by any of them, and anyone for whose acts any of them
      may be liable, arising out of or related to Operator's performance under
      this Agreement or breach of any representation herein, except to the
      extent of such loss as may be caused by Proprietor's negligence or willful
      misconduct or that of its officers, agents or employees. The provisions of
      this section shall survive any termination or expiration of this
      Agreement.
    </p>

    <h3 className="font-bold text-sm pt-2">ARTICLE 14 – COMPLIANCE WITH LAWS</h3>
    <p>
      Each party shall comply with all federal, state, local, or other laws or
      regulations applicable to the sale of merchandise through vending machines
    </p>

    <h3 className="font-bold text-sm pt-2">ARTICLE 15 - ASSIGNMENT</h3>
    <p>
      This Agreement shall not be assignable by either party without the prior
      written consent of the other party. Subject to the forgoing limitation,
      this Agreement shall endure to the benefit of and be binding upon the
      successors and assigns of the respective parties.
    </p>

    <h3 className="font-bold text-sm pt-2">ARTICLE 16 - ENTIRE AGREEMENT</h3>
    <p>
      This Agreement constitutes the entire Agreement of the parties with
      respect to the subject matter hereof and supersedes any and all
      agreements, understandings, statements, or representations either oral or
      in writing.
    </p>

    <h3 className="font-bold text-sm pt-2">ARTICLE 17 – ATTORNEYS’ FEES</h3>
    <p>
      Should any litigation be commenced between the parties hereto or their
      personal representative concerning any provisions of these Articles, or
      the rights and duties of any person in relation thereto, the party or
      parties prevailing in such litigation shall be entitled, in addition too
      such other relief as may be granted, to a reasonable sum as and for their
      or his attorneys 'fee in such litigation, which shall be determined by the
      court in such litigation, or in a separate action brought for that
      purpose.
    </p>

    <h3 className="font-bold text-sm pt-2">ARTICLE 18 – GOVERNING LAW AND SIGNATURES</h3>
    <p>
      The validity of this Agreement and of any of its terms or provisions as
      well as the rights and duties of the parties hereunder shall be
      interpreted and construed pursuant to and in accordance with the laws of
      the State of California Executed in Los Angeles, California on the day and
      year indicated above the signature of each party .
    </p>
  </>
);

const GenesisLegalText = ({ t }) => (
  <>
    <p>
      This agreement is entered into by and between the company stated above
      (hereinafter referred to as ‘Company') and OCHARGE LLC (hereinafter
      referred to as 'Operator’).
    </p>
    <h3 className="font-bold text-sm">RECITALS</h3>
    <p>
      Operator is a Limited Liability Corporation with principal place of
      business at 17711 Magnolia Blvd, Encino, CA 91316, USA. Operator is
      engaged in the business of installing and operating automatic vending
      machines for renting portable chargers (hereinafter referred to as
      ‘Powerbanks’) to the public through such machines. Proprietor is a US
      Legal Entity with principal place of business stated above. Proprietor is
      the organizer and operator of the following event stated above.Operator
      desires to install automatic vending machines on the premises of
      Proprietor for the rental of Powerbanks, and Proprietor desires to grant
      Operator a license for such purposes on the terms and conditions contained
      in this agreement. Therefore, in consideration of the mutual covenants and
      promises contained herein, it is hereby agreed as follows:
    </p>

    <h3 className="font-bold text-sm pt-2">ARTICLE 1 - INSTALLATION OF MACHINES</h3>
    <p>
      Operator shall install the vending machines to rent Powerbanks on the
      premises of the Event at such locations as are mutually agreed upon by the
      parties. Event locations must be adequately protected from wind and rain
      and must have continuous and adequate AC power supply. Operator may also
      require adequate WIFI availability at each of the locations where a unit
      will be placed.
    </p>

    <h3 className="font-bold text-sm pt-2">ARTICLE 2 - REMOVAL AND REPLACEMENT OF MACHINES</h3>
    <p>
      Operator shall have the right to remove any of the machines installed on
      the premises of the Event under this Agreement and to replace any such
      machine with a machine of similar type, quality, and appearance.
    </p>

    <h3 className="font-bold text-sm pt-2">ARTICLE 3 – COST OF SERVICE</h3>
    <p>
      Proprietor shall pay a total fee stated to Operator upon signing this
      Agreement for providing the services and equipment listed in the quote
      referenced on Page 1. Operator shall allow Proprietor’s patrons to borrow
      Powerbanks from all vending machine(s) as per the rental fees stated on
      Page 1. If a patron keeps a Powerbank past the end of the Event, the
      patron’s payment card will be charged a total fee as stated on Page 1.
      Proprietor will not be financially held liable for any non-returned
      Powerbanks.
    </p>

    <h3 className="font-bold text-sm pt-2">ARTICLE 4 - TERM</h3>
    <p>
      This Agreement shall commence on load-in date stated on Page 1 and end on
      the load-out date stated on Page 1. Event dates are as stated on Page 1.
    </p>

    <h3 className="font-bold text-sm pt-2">ARTICLE 5 - OWNERSHIP OF MACHINES</h3>
    <p>
      It is understood and agreed by and between the parties that the vending
      machines installed on the premises of Proprietor by Operator are and shall
      remain the property of Operator. Upon termination of this Agreement by any
      means, Operator shall have the right without further notice to Proprietor
      to remove any and all vending machines belonging to Operator which have
      been installed on the premises of Proprietor.
    </p>

    <h3 className="font-bold text-sm pt-2">ARTICLE 6 - PRODUCT SELECTION AND PRICING</h3>
    <p>
      Operator shall have sole control over the selection of Powerbanks to be
      offered through the vending machines. Typically, a single type of
      Powerbank will be offered with built-in cables (micro-USB, USB C, and
      lightning). Operator shall keep the machines stocked at all times with
      sufficient Powerbanks to insure continuous service to patrons of
      Proprietor. Product pricing shall be per quote referenced on Page 1.
      Operator will provide vending machines that only accept major debit and
      credit cards. Cash will not be accepted as a form of payment.
    </p>

    <h3 className="font-bold text-sm pt-2">ARTICLE 7 - RISK OF DAMAGE TO MACHINES</h3>
    <p>
      Except as may be attributable to Proprietor by reason of the gross
      negligence or willful misconducts of its officers, agents, or employees,
      Operator assumes partial risk and responsibility for any loss,
      destruction, or damage occurring to the vending machines. Operator
      reserves the right of compensation from Proprietor from losses incurred as
      the result of damage to machines by those employed by Proprietor.
    </p>

    <h3 className="font-bold text-sm pt-2">ARTICLE 8 - MAINTENANCE AND SERVICE</h3>
    <p>
      Operator shall regularly inspect, service, clean, and maintain the
      described vending machines and shall keep them operating and in good
      working order, at all times promptly maintaining them in a clean and
      sanitary condition in accordance with all applicable federal, state and
      local laws. Operator shall be granted full access to all Event sites for
      up to 2 technicians at least 2 days prior to the commencement of the event
      and at least 2 days after the end of the event. Operator shall coordinate
      with Proprietor for delivery, installation, and removal of all machines to
      and from Event sites. Operator shall be granted all access passes from
      Proprietor for up to 2 technicians in order to have unrestricted and full
      access to all Event sites for the purpose of maintenance and servicing of
      the machines during the entire Event.
    </p>

    <h3 className="font-bold text-sm pt-2">ARTICLE 9 - NOTIFICATION OF MACHINE FAILURE</h3>
    <p>
      Proprietor agrees to notify Operator promptly of any failure of the
      vending machines to function properly and further agrees to permit only
      authorized agents of Operator to remove, open, or in any way tamper with
      the machines. Operator shall clearly post a contact phone number on each
      vending machine for patrons to use in the event of machine failure or
      malfunction during transactions or for customer service.
    </p>

    <h3 className="font-bold text-sm pt-2">ARTICLE 10 - UTILITIES</h3>
    <p>
      Proprietor shall furnish and bear the cost of all utilities necessary for
      the operation of the vending machines installed under this Agreement and
      shall furnish suitable utility outlets for use by such machines. Proprietor
      shall provide continuous service to the machines and machine areas and
      shall not cause or permit the interruption of such service except in the
      event of an emergency. Operator shall coordinate with Proprietor for all
      Operator’s power requirements at each Event site.
    </p>

    <h3 className="font-bold text-sm pt-2">ARTICLE 11 - FEES AND TAXES</h3>
    <p>
      Operator shall be responsible for and shall pay all state, county, and
      city license fees and sales or other merchandising taxes that may be
      imposed on the sales of merchandise through its vending machines.
    </p>

    <h3 className="font-bold text-sm pt-2">ARTICLE 12 – RELATIONS OF PARTIES</h3>
    <p>
      It is the intention of the parties that Operator be an independent
      contractor hereunder, and that no agency or employment relationship be
      created by this Agreement.
    </p>

    <h3 className="font-bold text-sm pt-2">ARTICLE 13– INDEMNIFICATION</h3>
    <p>
      Operator shall defend, indemnify and hold harmless Proprietor, Hyundai
      Motor America, and Genesis Motor America, and their respective parent
      company, subsidiaries, officers, agents and employees, from and against
      any and all actions, suits, proceedings, claims, demands, losses, costs
      and expenses, including legal costs and attorneys' fees, for injury to or
      death of person(s), for damage to property (including property of
      Proprietor) or the loss of use thereof, and for errors and omissions,
      negligence and willful misconduct caused by Operator, its officers,
      agents, permitted subcontractors and employees, anyone directly or
      indirectly employed by any of them, and anyone for whose acts any of them
      may be liable, arising out of or related to Operator's performance under
      this Agreement or breach of any representation herein, except to the
      extent of such loss as may be caused by Proprietor's negligence or willful
      misconduct or that of its officers, agents or employees. The provisions of
      this section shall survive any termination or expiration of this
      Agreement.
    </p>

    <h3 className="font-bold text-sm pt-2">ARTICLE 14 – COMPLIANCE WITH LAWS</h3>
    <p>
      Each party shall comply with all federal, state, local, or other laws or
      regulations applicable to the sale of merchandise through vending machines
    </p>

    <h3 className="font-bold text-sm pt-2">ARTICLE 15 - ASSIGNMENT</h3>
    <p>
      This Agreement shall not be assignable by either party without the prior
      written consent of the other party. Subject to the forgoing limitation,
      this Agreement shall endure to the benefit of and be binding upon the
      successors and assigns of the respective parties.
    </p>

    <h3 className="font-bold text-sm pt-2">ARTICLE 16 - ENTIRE AGREEMENT</h3>
    <p>
      This Agreement constitutes the entire Agreement of the parties with
      respect to the subject matter hereof and supersedes any and all
      agreements, understandings, statements, or representations either oral or
      in writing.
    </p>

    <h3 className="font-bold text-sm pt-2">ARTICLE 17 – ATTORNEYS’ FEES</h3>
    <p>
      Should any litigation be commenced between the parties hereto or their
      personal representative concerning any provisions of these Articles, or
      the rights and duties of any person in relation thereto, the party or
      parties prevailing in such litigation shall be entitled, in addition too
      such other relief as may be granted, to a reasonable sum as and for their
      or his attorneys 'fee in such litigation, which shall be determined by the
      court in such litigation, or in a separate action brought for that
      purpose.
    </p>

    <h3 className="font-bold text-sm pt-2">ARTICLE 18 – GOVERNING LAW AND SIGNATURES</h3>
    <p>
      The validity of this Agreement and of any of its terms or provisions as
      well as the rights and duties of the parties hereunder shall be
      interpreted and construed pursuant to and in accordance with the laws of
      the State of California Executed in Los Angeles, California on the day and
      year indicated above the signature of each party .
    </p>
  </>
);

const RevShareLegalText = ({ t }) => (
  <>
    <p>{t("recitals_intro")}</p>
    <h3 className="font-bold text-sm">{t("recitals")}</h3>
    <p>{t("recitals_content")}</p>
    {Array.from({ length: 18 }, (_, i) => i + 1).map((i) => (
      <React.Fragment key={i}>
        <h3 className="font-bold text-sm pt-2">
          {t(`article_${i}_title`)}
        </h3>
        {i === 3 ? (
          <>
            <p>
              Proprietor shall authorize Operator to operate the equipment
              stated on page 1 to provide Powerbanks for the rental period and
              fees stated on page 1.
            </p>
            <p>
              Proprietor shall receive the profit share percentage stated on
              page 1 of all Gross Revenues (after all transaction costs
              associated with credit card processing are deducted) from the
              vending machine(s) at the Proprietor’s location. Gross Revenues
              include all daily rental fees and all additional overages
              collected from late returns and no returns.
            </p>
          </>
        ) : i === 6 ? (
          <>
            <p>{t("article_6_content_1")}</p>
            <h3 className="font-bold text-sm pt-2">
              {t("article_6_patron_payment")}
            </h3>
            <p>{t("article_6_content_2")}</p>
          </>
        ) : (
          <p>{t(`article_${i}_content`)}</p>
        )}
      </React.Fragment>
    ))}
  </>
);

const LeaseLegalText = ({ t }) => (
  <>
    <p>{t("recitals_intro")}</p>
    <h3 className="font-bold text-sm">{t("recitals")}</h3>
    <p>{t("recitals_content")}</p>
    {Array.from({ length: 18 }, (_, i) => i + 1).map((i) => (
      <React.Fragment key={i}>
        <h3 className="font-bold text-sm pt-2">
          {t(`article_${i}_title`)}
        </h3>
        {i !== 6 && <p>{t(`article_${i}_content`)}</p>}
        {i === 6 && (
          <>
            <p>{t("article_6_content_1")}</p>
            <h3 className="font-bold text-sm pt-2">
              {t("article_6_patron_payment")}
            </h3>
            <p>{t("article_6_content_2")}</p>
          </>
        )}
      </React.Fragment>
    ))}
  </>
);

export default function ProfessionalAgreementPDF({
  t,
  language,
  setLanguage,
  onNavigateToDashboard,
  onLogout,
}) {
  const [agreementType, setAgreementType] = useState("Lease");
  const [form, setForm] = useState({
    companyName: "",
    proprietorAddress: "",
    proprietorCity: "",
    proprietorState: "",
    proprietorZip: "",
    contactName: "",
    telephone: "",
    email: "",
    locationName: "",
    leaseStartDate: "",
    loadInDate: "",
    eventDates: "",
    loadOutDate: "",
    eventAddress: "",
    installAddress: "",
    sameAsProprietor: false,
    ct10Price: "",
    ct10Qty: "",
    ck20Price: "",
    ck20Qty: "",
    ck30Price: "",
    ck30Qty: "",
    ck50Price: "",
    ck50Qty: "",
    freePeriod: "",
    chargePerAdditionalPeriod: "",
    feeIfNotReturned: "",
    taxRate: "",
    authamount: "",
    buyprice: "",
    duration: "",
    quoteNumber: "",
    assetsDeployed: "",
    totalPrice: "",
    paymentTerms: "On Receipt",
    leaseAgreementVersion: "V.11.01.2024",
    info: {
      accountpercent: "",
      reppercent: "",
    },
    jurisdiction: "California",
    preparedBy: "George",
  });

  const formatLabel = (str) => {
    if (!str) return "";
    const withSpaces = str.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ");
    return withSpaces.replace(/\b\w/g, (char) => char.toUpperCase());
  };

  const agreementTitle = useMemo(() => {
    const titles = {
      Lease: t("lease_agreement"),
      "Rev. Share": t("rev_share_agreement"),
      Event: t("event_agreement"),
      Genesis: t("genesis_agreement"),
    };
    return formatLabel(titles[agreementType] || t("lease_agreement"));
  }, [agreementType, t]);

  useEffect(() => {
    const ct10Total =
      (parseFloat(form.ct10Qty) || 0) * (parseFloat(form.ct10Price) || 0);
    const ck20Total =
      (parseFloat(form.ck20Qty) || 0) * (parseFloat(form.ck20Price) || 0);
    const ck30Total =
      (parseFloat(form.ck30Qty) || 0) * (parseFloat(form.ck30Price) || 0);
    const ck50Total =
      (parseFloat(form.ck50Qty) || 0) * (parseFloat(form.ck50Price) || 0);
    const taxRate = parseFloat(form.taxRate) || 0;
    const subtotal = ct10Total + ck20Total + ck30Total + ck50Total;
    const total = subtotal * (1 + taxRate / 100);
    setForm((prev) => ({ ...prev, totalPrice: total.toFixed(2) }));
  }, [
    form.ct10Qty,
    form.ct10Price,
    form.ck20Qty,
    form.ck20Price,
    form.ck30Qty,
    form.ck30Price,
    form.ck50Qty,
    form.ck50Price,
    form.taxRate,
  ]);

  useEffect(() => {
    if (agreementType === "Genesis") {
      setForm((prev) => ({
        ...prev,
        companyName: "Innocean",
        proprietorAddress: "180 5TH ST SUITE 200",
        proprietorCity: "PACIFIC PALISADES",
        proprietorState: "CA",
        proprietorZip: "90272",
        locationName: "GENESIS INVITATIONAL TOURNAMENT",
      }));
    }
  }, [agreementType]);

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    const newValue = type === "checkbox" ? checked : value;

    if (name.includes(".")) {
      const [section, field] = name.split(".");
      setForm((prev) => ({
        ...prev,
        [section]: { ...prev[section], [field]: newValue },
      }));
    } else {
      setForm((prev) => ({ ...prev, [name]: newValue }));
    }
  };

  const handleCheckbox = () => {
    if (!form.sameAsProprietor) {
      setForm((prev) => ({
        ...prev,
        installAddress: `${prev.proprietorAddress}, ${prev.proprietorCity}, ${prev.proprietorState} ${prev.proprietorZip}`,
        sameAsProprietor: true,
      }));
    } else {
      setForm((prev) => ({
        ...prev,
        installAddress: "",
        sameAsProprietor: false,
      }));
    }
  };

  const generatePDF = async () => {
    const doc = new jsPDF("p", "pt", "a4");
    const pageWidth = doc.internal.pageSize.getWidth();

    const addHeader = (data) => {
      if (data.pageNumber === 1) {
        doc.addImage("/logo.png", "PNG", 40, 20, 60, 0);
        doc.setFontSize(22);
        doc.setTextColor(40);
        doc.setFont("helvetica", "bold");
        doc.text("Ocharge LLC", pageWidth - 40, 55, { align: "right" });
        doc.setFontSize(12);
        doc.setTextColor(128, 128, 128);
        doc.text(agreementTitle.toUpperCase(), pageWidth - 40, 70, {
          align: "right",
        });
        doc.setFontSize(8);
        doc.setTextColor(100);
        doc.text(
          "P.O. Box 570673, Tarzana, CA 91357 | P: 844.624.2743",
          pageWidth - 40,
          80,
          { align: "right" }
        );
        doc.setTextColor(150);
        doc.setFont("helvetica", "normal");
        doc.text(form.leaseAgreementVersion, pageWidth - 40, 90, {
          align: "right",
        });
        doc.setDrawColor(180, 180, 180);
        doc.line(40, 105, pageWidth - 40, 105);
      }
    };

    const addFooter = (data) => {
      const pageCount = doc.internal.getNumberOfPages();
      doc.setFontSize(8);
      const marginLeft = data.settings?.margin?.left ?? 40;
      doc.text(
        `Page ${data.pageNumber} of ${pageCount}`,
        marginLeft,
        doc.internal.pageSize.height - 10
      );
    };

    const didDrawPage = (data) => {
      addHeader(data);
      addFooter(data);
    };

    const proprietorData = [
      [formatLabel(t("company_name")), form.companyName],
      [
        formatLabel(t("address")),
        `${form.proprietorAddress} ${form.proprietorCity}, ${form.proprietorState} ${form.proprietorZip}`,
      ],
      [formatLabel(t("contact_name")), form.contactName],
      [formatLabel(t("telephone")), form.telephone],
      [formatLabel(t("email")), form.email],
    ];

    const locationData = [
      [t("location_name"), form.locationName],
      [
        t("lease_start_date"),
        form.leaseStartDate
          ? new Date(form.leaseStartDate).toLocaleDateString()
          : "",
      ],
      [t("installation_address"), form.installAddress],
    ];

    const eventDetailsData = [
      [t("event_name"), form.locationName],
      [t("event_address"), form.eventAddress],
      [
        t("load_in_date"),
        form.loadInDate ? new Date(form.loadInDate).toLocaleDateString() : "",
      ],
      [t("event_dates"), form.eventDates],
      [
        t("load_out_date"),
        form.loadOutDate ? new Date(form.loadOutDate).toLocaleDateString() : "",
      ],
    ];

    const rentalDetailsData = [
      [formatLabel(t("rental period")), form.freePeriod ? `${form.freePeriod} hours` : ""],
      [
        formatLabel(t("Charge per rental period")),
        form.chargePerAdditionalPeriod ? `$${form.chargePerAdditionalPeriod}` : "",
      ],
      [
        formatLabel(t("fee if not returned")),
        form.feeIfNotReturned ? `$${form.feeIfNotReturned}` : "",
      ],
    ];

    const pricingBody = [
      [
        "CT10",
        form.ct10Qty,
        form.ct10Price ? `$${form.ct10Price}` : "",
        form.ct10Qty && form.ct10Price
          ? `$${(form.ct10Qty * form.ct10Price).toFixed(2)}`
          : "",
      ],
      [
        "CK20",
        form.ck20Qty,
        form.ck20Price ? `$${form.ck20Price}` : "",
        form.ck20Qty && form.ck20Price
          ? `$${(form.ck20Qty * form.ck20Price).toFixed(2)}`
          : "",
      ],
      [
        "CK30",
        form.ck30Qty,
        form.ck30Price ? `$${form.ck30Price}` : "",
        form.ck30Qty && form.ck30Price
          ? `$${(form.ck30Qty * form.ck30Price).toFixed(2)}`
          : "",
      ],
      [
        "CK50",
        form.ck50Qty,
        form.ck50Price ? `$${form.ck50Price}` : "",
        form.ck50Qty && form.ck50Price
          ? `$${(form.ck50Qty * form.ck50Price).toFixed(2)}`
          : "",
      ],
    ];

    const pricingTotals = [
      [
        {
          content: t("payment terms"),
          colSpan: 3,
          styles: { fontStyle: "bold" },
        },
        t(form.paymentTerms),
      ],
      [
        {
          content: t("lease duration"),
          colSpan: 3,
          styles: { fontStyle: "bold" },
        },
        form.duration ? `${form.duration} ${t("months")}` : "",
      ],
      [
        {
          content: t("tax rate"),
          colSpan: 3,
          styles: { fontStyle: "bold" },
        },
        form.taxRate ? `${form.taxRate}%` : "",
      ],
      [
        {
          content: t("total price"),
          colSpan: 3,
          styles: { fontStyle: "bold", fillColor: [255, 255, 224] },
        },
        {
          content: form.totalPrice ? `$${form.totalPrice}` : "",
          styles: { fillColor: [255, 255, 224] },
        },
      ],
    ];

    const tableOptions = {
      theme: "grid",
      styles: {
        font: "helvetica",
        cellPadding: 3,
        fontSize: 10,
        valign: "middle",
      },
      headStyles: {
        fillColor: [230, 230, 230],
        textColor: 20,
        fontStyle: "bold",
        fontSize: 11,
      },
      columnStyles: { 0: { fontStyle: "bold" } },
    };

    autoTable(doc, {
      ...tableOptions,
      head: [
        [
          {
            content: t("proprietor_information"),
            colSpan: 2,
            styles: {
              fillColor: [225, 239, 255],
              textColor: [28, 100, 242],
            },
          },
        ],
      ],
      body: proprietorData,
      startY: 120,
      didDrawPage: didDrawPage,
    });

    if (agreementType === "Event" || agreementType === "Genesis") {
      autoTable(doc, {
        ...tableOptions,
        head: [
          [
            {
              content: formatLabel(t("event_details")),
              colSpan: 2,
              styles: {
                fillColor: [222, 247, 232],
                textColor: [22, 163, 74],
              },
            },
          ],
        ],
        body: eventDetailsData,
        didDrawPage: didDrawPage,
      });
    } else {
      autoTable(doc, {
        ...tableOptions,
        head: [
          [
            {
              content: t("location_details"),
              colSpan: 2,
              styles: {
                fillColor: [222, 247, 232],
                textColor: [22, 163, 74],
              },
            },
          ],
        ],
        body: locationData,
        didDrawPage: didDrawPage,
      });
    }

    autoTable(doc, {
      ...tableOptions,
      head: [
        [
          {
            content: t("charger_rental_details"),
            colSpan: 2,
            styles: {
              fillColor: [243, 232, 255],
              textColor: [126, 34, 206],
            },
          },
        ],
      ],
      body: rentalDetailsData,
      didDrawPage: didDrawPage,
    });

    if (agreementType === "Event" || agreementType === "Genesis") {
      autoTable(doc, {
        ...tableOptions,
        head: [
          [
            {
              content: formatLabel(t("quote_number")),
              colSpan: 2,
              styles: {
                fillColor: [255, 251, 235],
                textColor: [217, 119, 6],
              },
            },
          ],
        ],
        body: [
          [t("quote_number"), `#${form.quoteNumber}`],
          [t("assets_deployed"), form.assetsDeployed],
        ],
        didDrawPage: didDrawPage,
      });
    } else if (agreementType === "Lease") {
      autoTable(doc, {
        ...tableOptions,
        head: [
          [
            {
              content: t("pricing_and_totals"),
              colSpan: 4,
              styles: {
                fillColor: [255, 251, 235],
                textColor: [217, 119, 6],
              },
            },
          ],
        ],
        body: [
          [t("model"), t("qty"), t("rate"), t("subtotal")],
          ...pricingBody,
          ...pricingTotals,
        ],
        didParseCell: (data) => {
          if (
            data.row.section === "body" &&
            data.row.index > 0 &&
            data.row.index <= pricingBody.length
          ) {
            if (data.column.index > 0) data.cell.styles.halign = "center";
            if (data.column.index > 1) data.cell.styles.halign = "right";
          }
          if (data.row.section === "body" && data.row.index > pricingBody.length) {
            if (data.column.index === 1) data.cell.styles.halign = "right";
          }
        },
        didDrawPage: didDrawPage,
      });
    } else if (agreementType === "Rev. Share") {
      autoTable(doc, {
        ...tableOptions,
        head: [
          [
            {
              content: formatLabel(t("assets_deployed")),
              colSpan: 2,
              styles: {
                fillColor: [255, 251, 235],
                textColor: [217, 119, 6],
              },
            },
          ],
        ],
        body: [
          ["CT10", form.ct10Qty],
          ["CK20", form.ck20Qty],
          ["CK30", form.ck30Qty],
          ["CK50", form.ck50Qty],
        ],
        didDrawPage: didDrawPage,
      });
      autoTable(doc, {
        ...tableOptions,
        head: [
          [
            {
              content: formatLabel(t("revenue_share_terms")),
              colSpan: 2,
              styles: {
                fillColor: [255, 224, 224],
                textColor: [190, 24, 93],
              },
            },
          ],
        ],
        body: [[formatLabel(t("proprietor_percentage")), `${form.info.accountpercent || 0}%`]],
      });
    }

    const legalTextElement = document.getElementById("legal-text-content");
    if (legalTextElement) {
      doc.addPage();
      didDrawPage({ pageNumber: doc.internal.getNumberOfPages() });

      let yPos = 80;
      const legalTextNodes = Array.from(legalTextElement.children[0].children);
      legalTextNodes.forEach((node) => {
        const text = doc.splitTextToSize(node.innerText, 500);
        doc.setFont("helvetica", node.tagName === "H3" ? "bold" : "normal");
        doc.text(text, 40, yPos);
        yPos +=
          doc.getTextDimensions(text).h + (node.tagName === "H3" ? 8 : 12);
        if (yPos > 750) {
          doc.addPage();
          didDrawPage({ pageNumber: doc.internal.getNumberOfPages() });
          yPos = 80;
        }
      });

      const finalYAfterText = yPos;

      doc.setFontSize(12);
      doc.text(
        `${t("Proprietor")}: ${form.companyName}`,
        40,
        finalYAfterText + 60
      );
      doc.line(40, finalYAfterText + 100, 160, finalYAfterText + 100);
      doc.text(t("signature"), 40, finalYAfterText + 115);
      doc.line(180, finalYAfterText + 100, 260, finalYAfterText + 100);
      doc.text(t("date"), 180, finalYAfterText + 115);

      doc.text("Lessor: Ocharge LLC", 350, finalYAfterText + 60);
      doc.line(350, finalYAfterText + 100, 470, finalYAfterText + 100);
      doc.text(t("signature"), 350, finalYAfterText + 115);
      doc.line(490, finalYAfterText + 100, 570, finalYAfterText + 100);
      doc.text(t("date"), 490, finalYAfterText + 115);
    }

    doc.save(`${form.companyName || "Lease_Agreement"}.pdf`);
    const getFilename = () => {
      const company = form.companyName || "Agreement";
      switch (agreementType) {
        case "Lease":
          return `${company}_Lease_Agreement.pdf`;
        case "Rev. Share":
          return `${company}_Rev_Share_Agreement.pdf`;
        case "Event":
          return `${company}_Event_Agreement.pdf`;
        case "Genesis":
          return `${company}_Genesis_Agreement.pdf`;
        default:
          return `${company}_Agreement.pdf`;
      }
    };

    doc.save(getFilename());
  };

  return (
    <div className="min-h-screen bg-gray-100">
      <header className="bg-white shadow-sm">
        <div className="max-w-screen-xl mx-auto py-4 px-4 sm:px-6 lg:px-8 flex justify-between items-center">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setLanguage("en")}
              className={`px-2 py-1 text-sm font-bold rounded-md ${
                language === "en"
                  ? "bg-blue-600 text-white"
                  : "bg-gray-200 text-gray-700"
              }`}
            >
              EN
            </button>
            <button
              onClick={() => setLanguage("fr")}
              className={`px-2 py-1 text-sm font-bold rounded-md ${
                language === "fr"
                  ? "bg-blue-600 text-white"
                  : "bg-gray-200 text-gray-700"
              }`}
            >
              FR
            </button>
          </div>
          <div className="flex items-center gap-4">
            <button
              onClick={onNavigateToDashboard}
              className="p-2 rounded-md bg-gray-200 text-gray-700 hover:bg-gray-300"
              title={t("back_to_dashboard")}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-6 w-6"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
                />
              </svg>
            </button>
            <button
              onClick={onLogout}
              className="p-2 rounded-md bg-red-500 text-white hover:bg-red-600"
              title={t("logout")}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-6 w-6"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
                />
              </svg>
            </button>
          </div>
        </div>
      </header>
      <main className="max-w-screen-xl mx-auto py-6 sm:px-4 lg:px-6">
        <div className="bg-white p-4 rounded-lg shadow-md mb-6">
          <FormMultiSwitch
            label={t("agreement_type")}
            name="agreementType"
            options={["Lease", "Rev. Share", "Event", "Genesis"]}
            value={agreementType}
            section=""
            onDataChange={(sec, name, val) => setAgreementType(val)}
          />
        </div>
        <div className="flex flex-col md:flex-row w-full gap-8">
          {/* Left Form */}
          <div className="md:w-1/2 w-full p-6 overflow-y-auto bg-white rounded-xl shadow-lg">
            <h2 className="text-2xl font-bold mb-4">{`${agreementTitle} Form`}</h2>

            {/* Document Details */}
            <div className="mb-6 bg-gray-50 border-l-4 border-gray-600 p-4 rounded">
              <h3 className="text-lg font-bold text-gray-700 mb-2">
                {t("document_details")}
              </h3>
              <div className="mb-3">
                <label className="block text-sm font-semibold mb-1">
                  {formatLabel(t("lease_agreement_version"))}
                </label>
                <input
                  type="text"
                  name="leaseAgreementVersion"
                  value={form.leaseAgreementVersion}
                  onChange={handleChange}
                  className="border w-full p-2 rounded-md focus:ring-2 focus:ring-gray-400"
                />
              </div>
            </div>

            {/* Proprietor Info */}
            <div className="mb-6 bg-blue-50 border-l-4 border-blue-600 p-4 rounded">
              <h3 className="text-lg font-bold text-blue-700 mb-2">
                {t("proprietor_information")}
              </h3>
              {["companyName", "contactName", "telephone", "email"].map((key) => (
                <div key={key} className="mb-3">
                  <label className="block text-sm font-semibold mb-1">
                    {formatLabel(t(key))}
                  </label>
                  <input
                    type="text"
                    name={key}
                    value={form[key]}
                    onChange={handleChange}
                    className="border w-full p-2 rounded-md focus:ring-2 focus:ring-blue-400"
                  />
                </div>
              ))}
              <div className="mb-3">
                <label className="block text-sm font-semibold mb-1">
                  {formatLabel(t("address"))}
                </label>
                <input
                  type="text"
                  name="proprietorAddress"
                  placeholder={t("street_address")}
                  value={form.proprietorAddress}
                  onChange={handleChange}
                  className="border w-full p-2 rounded-md focus:ring-2 focus:ring-blue-400"
                />
                <div className="grid grid-cols-3 gap-2 mt-2">
                  <input
                    type="text"
                    name="proprietorCity"
                    placeholder={t("city")}
                    value={form.proprietorCity}
                    onChange={handleChange}
                    className="border w-full p-2 rounded-md focus:ring-2 focus:ring-blue-400"
                  />
                  <input
                    type="text"
                    name="proprietorState"
                    placeholder={t("state")}
                    value={form.proprietorState}
                    onChange={handleChange}
                    className="border w-full p-2 rounded-md focus:ring-2 focus:ring-blue-400"
                  />
                  <input
                    type="text"
                    name="proprietorZip"
                    placeholder={t("zip")}
                    value={form.proprietorZip}
                    onChange={handleChange}
                    className="border w-full p-2 rounded-md focus:ring-2 focus:ring-blue-400"
                  />
                </div>
              </div>
            </div>

            {/* Location / Event Section */}
            {agreementType === "Event" || agreementType === "Genesis" ? (
              <div className="mb-6 bg-green-50 border-l-4 border-green-600 p-4 rounded">
                <h3 className="text-lg font-bold text-green-700 mb-2">
                  {formatLabel(t("event_details"))}
                </h3>
                <div className="mb-3">
                  <label className="block text-sm font-semibold mb-1">
                    {formatLabel(t("event_name"))}
                  </label>
                  <input
                    type="text"
                    name="locationName"
                    value={form.locationName}
                    onChange={handleChange}
                    className="border w-full p-2 rounded-md focus:ring-2 focus:ring-green-400"
                  />
                </div>
                <div className="mb-3">
                  <label className="block text-sm font-semibold mb-1">
                    {formatLabel(t("event_address"))}
                  </label>
                  <input
                    type="text"
                    name="eventAddress"
                    value={form.eventAddress}
                    onChange={handleChange}
                    className="border w-full p-2 rounded-md focus:ring-2 focus:ring-green-400"
                  />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-3">
                  <div>
                    <label className="block text-sm font-semibold mb-1">
                      {formatLabel(t("load_in_date"))}
                    </label>
                    <input
                      type="date"
                      name="loadInDate"
                      value={form.loadInDate}
                      onChange={handleChange}
                      className="border w-full p-2 rounded-md focus:ring-2 focus:ring-green-400"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold mb-1">
                      {formatLabel(t("event_dates"))}
                    </label>
                    <input
                      type="text"
                      name="eventDates"
                      value={form.eventDates}
                      onChange={handleChange}
                      className="border w-full p-2 rounded-md focus:ring-2 focus:ring-green-400"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold mb-1">
                      {formatLabel(t("load_out_date"))}
                    </label>
                    <input
                      type="date"
                      name="loadOutDate"
                      value={form.loadOutDate}
                      onChange={handleChange}
                      className="border w-full p-2 rounded-md focus:ring-2 focus:ring-green-400"
                    />
                  </div>
                </div>
              </div>
            ) : (
              <div className="mb-6 bg-green-50 border-l-4 border-green-600 p-4 rounded">
                <h3 className="text-lg font-bold text-green-700 mb-2">
                  {t("location_details")}
                </h3>
                <div className="mb-3">
                  <label className="block text-sm font-semibold mb-1">
                    {formatLabel(t("location_name"))}
                  </label>
                  <input
                    type="text"
                    name="locationName"
                    value={form.locationName}
                    onChange={handleChange}
                    className="border w-full p-2 rounded-md focus:ring-2 focus:ring-green-400"
                  />
                </div>
                <div className="mb-3">
                  <label className="block text-sm font-semibold mb-1">
                    {formatLabel(t("lease_start_date"))}
                  </label>
                  <input
                    type="date"
                    name="leaseStartDate"
                    value={form.leaseStartDate}
                    onChange={handleChange}
                    className="border w-full p-2 rounded-md focus:ring-2 focus:ring-green-400"
                  />
                </div>
                <div className="mb-3">
                  <label className="block text-sm font-semibold mb-1">
                    {formatLabel(t("installation_address"))}
                  </label>
                  <input
                    type="text"
                    name="installAddress"
                    value={form.installAddress}
                    onChange={handleChange}
                    className="border w-full p-2 rounded-md focus:ring-2 focus:ring-green-400"
                  />
                  <div className="flex items-center mt-2">
                    <input
                      type="checkbox"
                      id="sameAsProprietor"
                      name="sameAsProprietor"
                      checked={form.sameAsProprietor}
                      onChange={handleCheckbox}
                      className="mr-2"
                    />
                    <label htmlFor="sameAsProprietor" className="text-sm">
                      {t("same_as_proprietor_address")}
                    </label>
                  </div>
                </div>
              </div>
            )}

            {/* Charger Rental Details Section */}
            {agreementType !== "Rev. Share" && (
              <div className="mb-6 bg-purple-50 border-l-4 border-purple-600 p-4 rounded">
                <h3 className="text-lg font-bold text-purple-700 mb-2">
                  {formatLabel(t("charger_rental_details"))}
                </h3>
                {["freePeriod", "chargePerAdditionalPeriod", "feeIfNotReturned"].map(
                  (key) => (
                    <div key={key} className="mb-3">
                      <label className="block text-sm font-semibold mb-1">
                        {formatLabel(t(key))}
                      </label>
                      <input
                        type="text"
                        name={key}
                        value={form[key]}
                        onChange={handleChange}
                        className="border w-full p-2 rounded-md focus:ring-2 focus:ring-purple-400"
                      />
                    </div>
                  )
                )}
              </div>
            )}

            {/* Pricing / Terms Section */}
            {agreementType === "Event" || agreementType === "Genesis" ? (
              <div className="mb-6 bg-yellow-50 border-l-4 border-yellow-500 p-4 rounded">
                <h3 className="text-lg font-bold text-yellow-700 mb-2">
                  {formatLabel(t("quote_number"))}
                </h3>
                <div className="mb-3">
                  <label className="block text-sm font-semibold mb-1">
                    {formatLabel(t("quote_number"))}
                  </label>
                  <input
                    type="text"
                    name="quoteNumber"
                    value={form.quoteNumber}
                    onChange={handleChange}
                    className="border w-full p-2 rounded-md focus:ring-2 focus:ring-yellow-400"
                  />
                </div>
                <div className="mb-3">
                  <label className="block text-sm font-semibold mb-1">
                    {formatLabel(t("assets_deployed"))}
                  </label>
                  <textarea
                    name="assetsDeployed"
                    value={form.assetsDeployed}
                    onChange={handleChange}
                    className="border w-full p-2 rounded-md focus:ring-2 focus:ring-yellow-400"
                    rows="4"
                  ></textarea>
                </div>
              </div>
            ) : agreementType === "Rev. Share" ? (
              <>
                <div className="mb-6 bg-yellow-50 border-l-4 border-yellow-500 p-4 rounded">
                  <h3 className="text-lg font-bold text-yellow-700 mb-2">
                    {t("assets_deployed")}
                  </h3>
                  {["ct10", "ck20", "ck30", "ck50"].map((model) => (
                    <div key={model} className="grid grid-cols-1 gap-4 mb-3">
                      <div>
                        <label className="block text-sm font-semibold mb-1">
                          {formatLabel(t(`${model}_qty`))}
                        </label>
                        <input
                          type="text"
                          name={`${model}Qty`}
                          value={form[`${model}Qty`]}
                          onChange={handleChange}
                          className="border w-full p-2 rounded-md focus:ring-2 focus:ring-yellow-400"
                        />
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mb-6 bg-purple-50 border-l-4 border-purple-600 p-4 rounded">
                  <h3 className="text-lg font-bold text-purple-700 mb-2">
                    {formatLabel(t("charger_rental_details"))}
                  </h3>
                  {["freePeriod", "chargePerAdditionalPeriod", "feeIfNotReturned"].map(
                    (key) => (
                      <div key={key} className="mb-3">
                        <label
                          className="block text-sm font-semibold mb-1"
                          htmlFor={key}
                        >
                          {key === "freePeriod"
                            ? t("Rental period")
                            : key === "chargePerAdditionalPeriod"
                            ? t("Charge per rental period")
                            : formatLabel(t(key))}
                        </label>
                        <input
                          type="text"
                          name={key}
                          value={form[key]}
                          onChange={handleChange}
                          className="border w-full p-2 rounded-md focus:ring-2 focus:ring-purple-400"
                        />
                      </div>
                    )
                  )}
                </div>
                <div className="mb-6 bg-purple-50 border-l-4 border-purple-600 p-4 rounded">
                  <h3 className="text-lg font-bold text-purple-700 mb-2">
                    {formatLabel(t("revenue_share_terms"))}
                  </h3>
                  <div className="grid grid-cols-1 gap-4 mb-3">
                    <div>
                      <label className="block text-sm font-semibold mb-1">
                        {formatLabel(t("proprietor_percentage"))}
                      </label>
                      <input
                        type="number"
                        name="info.accountpercent"
                        value={form.info.accountpercent}
                        onChange={handleChange}
                        className="border w-full p-2 rounded-md focus:ring-2 focus:ring-yellow-400"
                        placeholder="e.g., 20"
                      />
                    </div>
                  </div>
                  <p className="text-xs text-gray-600 mt-2">
                    {t("rev_share_note")}
                  </p>
                </div>
              </>
            ) : (
              <div className="mb-6 bg-yellow-50 border-l-4 border-yellow-500 p-4 rounded">
                <h3 className="text-lg font-bold text-yellow-700 mb-2">
                  {t("pricing_and_totals")}
                </h3>
                {["ct10", "ck20", "ck30", "ck50"].map((model) => (
                  <div key={model} className="grid grid-cols-2 gap-4 mb-3">
                    <div>
                      <label className="block text-sm font-semibold mb-1">
                        {formatLabel(t(`${model.toLowerCase()}_qty`))}
                      </label>
                      <input
                        type="text"
                        name={`${model.toLowerCase()}Qty`}
                        value={form[`${model.toLowerCase()}Qty`]}
                        onChange={handleChange}
                        className="border w-full p-2 rounded-md focus:ring-2 focus:ring-yellow-400"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold mb-1">
                        {formatLabel(t(`${model.toLowerCase()}_price`))}
                      </label>
                      <input
                        type="text"
                        name={`${model.toLowerCase()}Price`}
                        value={form[`${model.toLowerCase()}Price`]}
                        onChange={handleChange}
                        className="border w-full p-2 rounded-md focus:ring-2 focus:ring-yellow-400"
                      />
                    </div>
                  </div>
                ))}
                <div className="mb-3">
                  <FormMultiSwitch
                    label={t("payment terms")}
                    name="paymentTerms"
                    options={["On Receipt", "10 Days", "30 Days"]}
                    value={form.paymentTerms}
                    section=""
                    onDataChange={(sec, name, val) =>
                      handleChange({ target: { name, value: val } })
                    }
                  />
                </div>
                {["duration", "taxRate", "totalPrice"].map((key) => (
                  <div key={key} className="mb-3">
                    <label className="block text-sm font-semibold mb-1">
                      {formatLabel(t(key))}
                    </label>
                    <input
                      type="text"
                      name={key}
                      value={form[key]}
                      onChange={handleChange}
                      className="border w-full p-2 rounded-md focus:ring-2 focus:ring-yellow-400"
                      disabled={key === "totalPrice"}
                    />
                  </div>
                ))}
              </div>
            )}

            <button
              onClick={generatePDF}
              className="mt-6 w-full bg-blue-700 text-white py-3 rounded-md font-semibold hover:bg-blue-800 shadow"
            >
              {`${agreementTitle} PDF`}
            </button>
          </div>

          {/* Right Preview */}
          <div
            id="pdf-preview-tables"
            className="md:w-1/2 w-full p-6 overflow-y-auto bg-white rounded-xl shadow-lg"
          >
            {/* Header for preview */}
            <div className="flex items-center justify-between pb-2 border-b">
              <img src="/logo.png" alt="Ocharge LLC Logo" className="h-16" />
              <div className="text-right">
                <h1 className="text-xl font-bold text-gray-800">
                  Ocharge LLC
                </h1>
                <h2 className="text-lg font-semibold text-gray-600">
                  {agreementTitle.toUpperCase()}
                </h2>
                <p className="text-xs text-gray-500 mt-1">
                  P.O. Box 570673, Tarzana, CA 91357 | P: 844.624.2743
                </p>
                <p className="text-xs text-gray-400 mt-1">
                  {form.leaseAgreementVersion}
                </p>
              </div>
            </div>

            {/* Proprietor Info Preview */}
            <div className="mt-2 border border-blue-600 rounded-lg overflow-hidden">
              <div className="bg-blue-50 px-3 py-1 text-sm font-semibold text-blue-700 border-b border-blue-600">
                {t("proprietor_information")}
              </div>
              <table className="w-full text-xs">
                <tbody>
                  <tr>
                    <td
                      className="px-2 py-1 font-semibold w-1/3"
                      style={{ verticalAlign: "top" }}
                    >
                      {formatLabel(t("company_name"))}
                    </td>
                    <td
                      className="px-2 py-1 border-l border-gray-300"
                      style={{ verticalAlign: "top" }}
                    >
                      {form.companyName}
                    </td>
                  </tr>
                  <tr className="bg-gray-50">
                    <td
                      className="px-2 py-1 font-semibold w-1/3"
                      style={{ verticalAlign: "top" }}
                    >
                      {formatLabel(t("address"))}
                    </td>
                    <td
                      className="px-2 py-1 border-l border-gray-300"
                      style={{ verticalAlign: "top" }}
                    >
                      {`${form.proprietorAddress} ${form.proprietorCity}, ${form.proprietorState} ${form.proprietorZip}`}
                    </td>
                  </tr>
                  <tr>
                    <td
                      className="px-2 py-1 font-semibold w-1/3"
                      style={{ verticalAlign: "top" }}
                    >
                      {formatLabel(t("contact_name"))}
                    </td>
                    <td
                      className="px-2 py-1 border-l border-gray-300"
                      style={{ verticalAlign: "top" }}
                    >
                      {form.contactName}
                    </td>
                  </tr>
                  <tr className="bg-gray-50">
                    <td
                      className="px-2 py-1 font-semibold w-1/3"
                      style={{ verticalAlign: "top" }}
                    >
                      {formatLabel(t("telephone"))}
                    </td>
                    <td
                      className="px-2 py-1 border-l border-gray-300"
                      style={{ verticalAlign: "top" }}
                    >
                      {form.telephone}
                    </td>
                  </tr>
                  <tr>
                    <td
                      className="px-2 py-1 font-semibold w-1/3"
                      style={{ verticalAlign: "top" }}
                    >
                      {formatLabel(t("email"))}
                    </td>
                    <td
                      className="px-2 py-1 border-l border-gray-300"
                      style={{ verticalAlign: "top" }}
                    >
                      {form.email}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Location / Event Preview */}
            {agreementType === "Event" || agreementType === "Genesis" ? (
              <div className="mt-2 border border-green-600 rounded-lg overflow-hidden">
                <div className="bg-green-50 px-3 py-1 text-sm font-semibold text-green-700 border-b border-green-600">
                  {t("event_details")}
                </div>
                <table className="w-full text-xs">
                  <tbody>
                    <tr>
                      <td
                        className="px-2 py-1 font-semibold w-1/3"
                        style={{ verticalAlign: "top" }}
                      >
                        {formatLabel(t("event_name"))}
                      </td>
                      <td
                        className="px-2 py-1 border-l border-gray-300"
                        style={{ verticalAlign: "top" }}
                      >
                        {form.locationName}
                      </td>
                    </tr>
                    <tr className="bg-gray-50">
                      <td
                        className="px-2 py-1 font-semibold w-1/3"
                        style={{ verticalAlign: "top" }}
                      >
                        {formatLabel(t("event_address"))}
                      </td>
                      <td
                        className="px-2 py-1 border-l border-gray-300"
                        style={{ verticalAlign: "top" }}
                      >
                        {form.eventAddress}
                      </td>
                    </tr>
                    <tr>
                      <td
                        className="px-2 py-1 font-semibold w-1/3"
                        style={{ verticalAlign: "top" }}
                      >
                        {formatLabel(t("load_in_date"))}
                      </td>
                      <td
                        className="px-2 py-1 border-l border-gray-300"
                        style={{ verticalAlign: "top" }}
                      >
                        {form.loadInDate
                          ? form.loadInDate.split("-").reverse().join("/")
                          : ""}
                      </td>
                    </tr>
                    <tr className="bg-gray-50">
                      <td
                        className="px-2 py-1 font-semibold w-1/3"
                        style={{ verticalAlign: "top" }}
                      >
                        {formatLabel(t("event_dates"))}
                      </td>
                      <td
                        className="px-2 py-1 border-l border-gray-300"
                        style={{ verticalAlign: "top" }}
                      >
                        {form.eventDates}
                      </td>
                    </tr>
                    <tr>
                      <td
                        className="px-2 py-1 font-semibold w-1/3"
                        style={{ verticalAlign: "top" }}
                      >
                        {formatLabel(t("load_out_date"))}
                      </td>
                      <td
                        className="px-2 py-1 border-l border-gray-300"
                        style={{ verticalAlign: "top" }}
                      >
                        {form.loadOutDate
                          ? form.loadOutDate.split("-").reverse().join("/")
                          : ""}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="mt-2 border border-green-600 rounded-lg overflow-hidden">
                <div className="bg-green-50 px-3 py-1 text-sm font-semibold text-green-700 border-b border-green-600">
                  {t("location_details")}
                </div>
                <table className="w-full text-xs">
                  <tbody>
                    <tr>
                      <td
                        className="px-2 py-1 font-semibold w-1/3"
                        style={{ verticalAlign: "top" }}
                      >
                        {formatLabel(t("location_name"))}
                      </td>
                      <td
                        className="px-2 py-1 border-l border-gray-300"
                        style={{ verticalAlign: "top" }}
                      >
                        {form.locationName}
                      </td>
                    </tr>
                    <tr className="bg-gray-50">
                      <td
                        className="px-2 py-1 font-semibold w-1/3"
                        style={{ verticalAlign: "top" }}
                      >
                        {formatLabel(t("lease_start_date"))}
                      </td>
                      <td
                        className="px-2 py-1 border-l border-gray-300"
                        style={{ verticalAlign: "top" }}
                      >
                        {form.leaseStartDate
                          ? form.leaseStartDate.split("-").reverse().join("/")
                          : ""}
                      </td>
                    </tr>
                    <tr>
                      <td
                        className="px-2 py-1 font-semibold w-1/3"
                        style={{ verticalAlign: "top" }}
                      >
                        {formatLabel(t("installation_address"))}
                      </td>
                      <td
                        className="px-2 py-1 border-l border-gray-300"
                        style={{ verticalAlign: "top" }}
                      >
                        {form.installAddress}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}

            {/* Charger Rental Details Preview */}
            {agreementType !== "Rev. Share" && (
              <div className="mt-2 border border-purple-600 rounded-lg overflow-hidden">
                <div className="bg-purple-50 px-3 py-1 text-sm font-semibold text-purple-700 border-b border-purple-600">
                  {t("charger_rental_details")}
                </div>
                <table className="w-full text-xs">
                  <tbody>
                    <tr>
                      <td
                        className="px-2 py-1 font-semibold w-1/3"
                        style={{ verticalAlign: "top" }}
                      >
                        {t("rental period")}
                      </td>
                      <td
                        className="px-2 py-1 border-l border-gray-300"
                        style={{ verticalAlign: "top" }}
                      >
                        {form.freePeriod ? `${form.freePeriod} hours` : ""}
                      </td>
                    </tr>
                    <tr className="bg-gray-50">
                      <td
                        className="px-2 py-1 font-semibold w-1/3"
                        style={{ verticalAlign: "top" }}
                      >
                        {t("Charge per rental period")}
                      </td>
                      <td
                        className="px-2 py-1 border-l border-gray-300"
                        style={{ verticalAlign: "top" }}
                      >
                        {form.chargePerAdditionalPeriod
                          ? `$${form.chargePerAdditionalPeriod}`
                          : ""}
                      </td>
                    </tr>
                    <tr>
                      <td
                        className="px-2 py-1 font-semibold w-1/3"
                        style={{ verticalAlign: "top" }}
                      >
                        {t("fee if not returned")}
                      </td>
                      <td
                        className="px-2 py-1 border-l border-gray-300"
                        style={{ verticalAlign: "top" }}
                      >
                        {form.feeIfNotReturned
                          ? `$${form.feeIfNotReturned}`
                          : ""}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}

            {/* Pricing Preview */}
            {agreementType === "Event" || agreementType === "Genesis" ? (
              <div className="mt-2 border border-yellow-500 rounded-lg overflow-hidden">
                <div className="bg-yellow-50 px-3 py-1 text-sm font-semibold text-yellow-700 border-b border-yellow-500">
                  {formatLabel(t("quote_number"))}
                </div>
                <table className="w-full text-xs">
                  <tbody className="text-[11px]">
                    <tr>
                      <td
                        className="px-2 py-1 font-semibold w-1/3"
                        style={{ verticalAlign: "top" }}
                      >
                        {formatLabel(t("quote_number"))}
                      </td>
                      <td
                        className="px-2 py-1 border-l border-gray-300"
                        style={{ verticalAlign: "top" }}
                      >
                        {form.quoteNumber ? `#${form.quoteNumber}` : ""}
                      </td>
                    </tr>
                    <tr className="bg-gray-50">
                      <td
                        className="px-2 py-1 font-semibold w-1/3"
                        style={{ verticalAlign: "top" }}
                      >
                        {formatLabel(t("assets_deployed"))}
                      </td>
                      <td
                        className="px-2 py-1 border-l border-gray-300 whitespace-pre-wrap"
                        style={{ verticalAlign: "top" }}
                      >
                        {form.assetsDeployed}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            ) : agreementType === "Rev. Share" ? (
              <>
                <div className="mt-2 border border-yellow-500 rounded-lg overflow-hidden">
                  <div className="bg-yellow-50 px-3 py-1 text-sm font-semibold text-yellow-700 border-b border-yellow-500">
                    {formatLabel(t("assets_deployed"))}
                  </div>
                  <table className="w-full text-xs">
                    <thead>
                      <tr
                        className="bg-yellow-100 text-left text-[11px]"
                        style={{ verticalAlign: "top" }}
                      >
                        <th
                          className="px-2 py-1 w-1/2"
                          style={{ verticalAlign: "top" }}
                        >
                          {t("model")}
                        </th>
                        <th
                          className="px-2 py-1 text-right w-1/2"
                          style={{ verticalAlign: "top" }}
                        >
                          {t("qty")}
                        </th>
                      </tr>
                    </thead>
                    <tbody className="text-[11px]">
                      <tr>
                        <td
                          className="px-2 py-1 font-semibold"
                          style={{ verticalAlign: "top" }}
                        >
                          CT10
                        </td>
                        <td
                          className="px-2 py-1 border-l border-gray-300 text-right"
                          style={{ verticalAlign: "top" }}
                        >
                          {form.ct10Qty}
                        </td>
                      </tr>
                      <tr className="bg-gray-50">
                        <td
                          className="px-2 py-1 font-semibold"
                          style={{ verticalAlign: "top" }}
                        >
                          CK20
                        </td>
                        <td
                          className="px-2 py-1 border-l border-gray-300 text-right"
                          style={{ verticalAlign: "top" }}
                        >
                          {form.ck20Qty}
                        </td>
                      </tr>
                      <tr>
                        <td
                          className="px-2 py-1 font-semibold"
                          style={{ verticalAlign: "top" }}
                        >
                          CK30
                        </td>
                        <td
                          className="px-2 py-1 border-l border-gray-300 text-right"
                          style={{ verticalAlign: "top" }}
                        >
                          {form.ck30Qty}
                        </td>
                      </tr>
                      <tr className="bg-gray-50">
                        <td
                          className="px-2 py-1 font-semibold"
                          style={{ verticalAlign: "top" }}
                        >
                          CK50
                        </td>
                        <td
                          className="px-2 py-1 border-l border-gray-300 text-right"
                          style={{ verticalAlign: "top" }}
                        >
                          {form.ck50Qty}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <div className="mt-2 border border-purple-600 rounded-lg overflow-hidden">
                  <div className="bg-purple-50 px-3 py-1 text-sm font-semibold text-purple-700 border-b border-purple-600">
                    {formatLabel(t("charger_rental_details"))}
                  </div>
                  <table className="w-full text-xs">
                    <tbody>
                      <tr>
                        <td className="px-2 py-1 font-semibold w-1/2">
                          {t("Rental period")}
                        </td>
                        <td className="px-2 py-1 border-l border-gray-300 text-right">
                          {form.freePeriod ? `${form.freePeriod} hours` : ""}
                        </td>
                      </tr>
                      <tr className="bg-gray-50">
                        <td className="px-2 py-1 font-semibold w-1/2">
                          {t("Charge per rental period")}
                        </td>
                        <td className="px-2 py-1 border-l border-gray-300 text-right">
                          {form.chargePerAdditionalPeriod
                            ? `$${form.chargePerAdditionalPeriod}`
                            : ""}
                        </td>
                      </tr>
                      <tr>
                        <td className="px-2 py-1 font-semibold w-1/2">
                          {t("fee if not returned")}
                        </td>
                        <td className="px-2 py-1 border-l border-gray-300 text-right">
                          {form.feeIfNotReturned
                            ? `$${form.feeIfNotReturned}`
                            : ""}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <div className="mt-2 border border-purple-600 rounded-lg overflow-hidden">
                  <div className="bg-purple-50 px-3 py-1 text-sm font-semibold text-purple-700 border-b border-purple-600">
                    {formatLabel(t("revenue_share_terms"))}
                  </div>
                  <table className="w-full text-xs">
                    <tbody>
                      <tr>
                        <td className="px-2 py-1 font-semibold w-1/2">
                          {formatLabel(t("proprietor_percentage"))}
                        </td>
                        <td className="px-2 py-1 border-l border-gray-300 text-right">
                          {form.info.accountpercent
                            ? `${form.info.accountpercent}%`
                            : ""}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <div className="mt-2 border border-yellow-500 rounded-lg overflow-hidden">
                <div className="bg-yellow-50 px-3 py-1 text-sm font-semibold text-yellow-700 border-b border-yellow-500">
                  {t("pricing_and_totals")}
                </div>
                <table className="w-full text-xs">
                  <thead>
                    <tr
                      className="bg-yellow-100 text-left text-[11px]"
                      style={{ verticalAlign: "top" }}
                    >
                      <th
                        className="px-2 py-1 w-1/3"
                        style={{ verticalAlign: "top" }}
                      >
                        {t("model")}
                      </th>
                      <th
                        className="px-2 py-1 text-center"
                        style={{ verticalAlign: "top" }}
                      >
                        {t("qty")}
                      </th>
                      <th
                        className="px-2 py-1 text-right"
                        style={{ verticalAlign: "top" }}
                      >
                        {t("rate")}
                      </th>
                      <th
                        className="px-2 py-1 text-right"
                        style={{ verticalAlign: "top" }}
                      >
                        {t("subtotal")}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="text-[11px]">
                    <tr>
                      <td
                        className="px-2 py-1 font-semibold"
                        style={{ verticalAlign: "top" }}
                      >
                        CT10
                      </td>
                      <td
                        className="px-2 py-1 border-l border-gray-300 text-center"
                        style={{ verticalAlign: "top" }}
                      >
                        {form.ct10Qty}
                      </td>
                      <td
                        className="px-2 py-1 border-l border-gray-300 text-right"
                        style={{ verticalAlign: "top" }}
                      >
                        {form.ct10Price ? `$${form.ct10Price}` : ""}
                      </td>
                      <td
                        className="px-2 py-1 border-l border-gray-300 text-right"
                        style={{ verticalAlign: "top" }}
                      >
                        {form.ct10Qty && form.ct10Price
                          ? `$${(form.ct10Qty * form.ct10Price).toFixed(2)}`
                          : ""}
                      </td>
                    </tr>
                    <tr className="bg-gray-50">
                      <td
                        className="px-2 py-1 font-semibold"
                        style={{ verticalAlign: "top" }}
                      >
                        CK20
                      </td>
                      <td
                        className="px-2 py-1 border-l border-gray-300 text-center"
                        style={{ verticalAlign: "top" }}
                      >
                        {form.ck20Qty}
                      </td>
                      <td
                        className="px-2 py-1 border-l border-gray-300 text-right"
                        style={{ verticalAlign: "top" }}
                      >
                        {form.ck20Price ? `$${form.ck20Price}` : ""}
                      </td>
                      <td
                        className="px-2 py-1 border-l border-gray-300 text-right"
                        style={{ verticalAlign: "top" }}
                      >
                        {form.ck20Qty && form.ck20Price
                          ? `$${(form.ck20Qty * form.ck20Price).toFixed(2)}`
                          : ""}
                      </td>
                    </tr>
                    <tr>
                      <td
                        className="px-2 py-1 font-semibold"
                        style={{ verticalAlign: "top" }}
                      >
                        CK30
                      </td>
                      <td
                        className="px-2 py-1 border-l border-gray-300 text-center"
                        style={{ verticalAlign: "top" }}
                      >
                        {form.ck30Qty}
                      </td>
                      <td
                        className="px-2 py-1 border-l border-gray-300 text-right"
                        style={{ verticalAlign: "top" }}
                      >
                        {form.ck30Price ? `$${form.ck30Price}` : ""}
                      </td>
                      <td
                        className="px-2 py-1 border-l border-gray-300 text-right"
                        style={{ verticalAlign: "top" }}
                      >
                        {form.ck30Qty && form.ck30Price
                          ? `$${(form.ck30Qty * form.ck30Price).toFixed(2)}`
                          : ""}
                      </td>
                    </tr>
                    <tr className="bg-gray-50">
                      <td
                        className="px-2 py-1 font-semibold"
                        style={{ verticalAlign: "top" }}
                      >
                        CK50
                      </td>
                      <td
                        className="px-2 py-1 border-l border-gray-300 text-center"
                        style={{ verticalAlign: "top" }}
                      >
                        {form.ck50Qty}
                      </td>
                      <td
                        className="px-2 py-1 border-l border-gray-300 text-right"
                        style={{ verticalAlign: "top" }}
                      >
                        {form.ck50Price ? `$${form.ck50Price}` : ""}
                      </td>
                      <td
                        className="px-2 py-1 border-l border-gray-300 text-right"
                        style={{ verticalAlign: "top" }}
                      >
                        {form.ck50Qty && form.ck50Price
                          ? `$${(form.ck50Qty * form.ck50Price).toFixed(2)}`
                          : ""}
                      </td>
                    </tr>
                    <tr className="bg-gray-50">
                      <td
                        className="px-2 py-1 font-semibold"
                        style={{ verticalAlign: "top" }}
                      >
                        {t("payment terms")}
                      </td>
                      <td
                        colSpan="3"
                        className="px-2 py-1 border-l border-gray-300 text-right"
                        style={{ verticalAlign: "top" }}
                      >
                        {t(form.paymentTerms)}
                      </td>
                    </tr>
                    <tr>
                      <td
                        className="px-2 py-1 font-semibold"
                        style={{ verticalAlign: "top" }}
                      >
                        {t("lease duration")}
                      </td>
                      <td
                        colSpan="3"
                        className="px-2 py-1 border-l border-gray-300 text-right"
                        style={{ verticalAlign: "top" }}
                      >
                        {form.duration ? `${form.duration} ${t("months")}` : ""}
                      </td>
                    </tr>
                    <tr className="bg-gray-50">
                      <td
                        className="px-2 py-1 font-semibold"
                        style={{ verticalAlign: "top" }}
                      >
                        {t("tax rate")}
                      </td>
                      <td
                        colSpan="3"
                        className="px-2 py-1 border-l border-gray-300 text-right"
                        style={{ verticalAlign: "top" }}
                      >
                        {form.taxRate ? `${form.taxRate}%` : ""}
                      </td>
                    </tr>
                    <tr className="bg-yellow-100 font-bold">
                      <td
                        className="px-2 py-1"
                        style={{ verticalAlign: "top" }}
                      >
                        {t("total price")}
                      </td>
                      <td
                        colSpan="3"
                        className="px-2 py-1 border-l border-gray-300 text-right"
                        style={{ verticalAlign: "top" }}
                      >
                        {form.totalPrice ? `$${form.totalPrice}` : ""}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}

            {/* Recitals for preview */}
            <div className="mt-12 pt-12 text-[10px] leading-tight text-gray-700 space-y-2">
              {agreementType === "Event" ? (
                <EventLegalText t={t} />
              ) : agreementType === "Genesis" ? (
                <GenesisLegalText t={t} />
              ) : agreementType === "Rev. Share" ? (
                <RevShareLegalText t={t} />
              ) : (
                <LeaseLegalText t={t} />
              )}
            </div>

            {/* Signature Section for preview */}
            <div className="mt-16 grid grid-cols-2 gap-16 text-xs">
              <div>
                <p className="font-bold">
                  {t("Proprietor")}: {form.companyName}
                </p>
                <div className="mt-16 border-t border-gray-400 pt-1">
                  <p>{t("signature")}</p>
                </div>
              </div>
              <div>
                <p className="font-bold">{t("Lessor")}: Ocharge LLC</p>
                <div className="mt-16 border-t border-gray-400 pt-1">
                  <p>{t("signature")}</p>
                </div>
              </div>
            </div>

            {/* Hidden content for PDF extraction */}
            <div id="legal-text-content" className="hidden">
              <div
                className="mt-12 pt-12 text-[10px] leading-tight text-gray-700 space-y-2"
                style={{ pageBreakBefore: "always" }}
              >
                {agreementType === "Event" ? (
                  <EventLegalText t={t} />
                ) : agreementType === "Genesis" ? (
                  <GenesisLegalText t={t} />
                ) : agreementType === "Rev. Share" ? (
                  <RevShareLegalText t={t} />
                ) : (
                  <LeaseLegalText t={t} />
                )}
              </div>

              {/* Signature Section inside hidden PDF content */}
              <div className="mt-16 grid grid-cols-2 gap-12 text-xs">
                <div>
                  <p className="font-bold">
                    {t("Proprietor")}: {form.companyName}
                  </p>
                  <div className="mt-12 border-t border-gray-400 pt-1">
                    <p>{t("signature")}</p>
                  </div>
                </div>
                <div>
                  <p className="font-bold">{t("Lessor")}: Ocharge LLC</p>
                  <div className="mt-12 border-t border-gray-400 pt-1">
                    <p>{t("signature")}</p>
                  </div>
                </div>
                <div className="self-end">
                  <div className="mt-12 border-t border-gray-400 pt-1">
                    <p>{t("date")}</p>
                  </div>
                </div>
                <div className="self-end">
                  <div className="mt-12 border-t border-gray-400 pt-1">
                    <p>{t("date")}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
          {/* End Right Preview */}
        </div>
      </main>
    </div>
  );
}
